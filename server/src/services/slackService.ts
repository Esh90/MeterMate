import { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/web-api';
import { config } from '../config.js';
import { buildChannelName, formatCents } from '../util.js';
import type { ChannelInfo, SubscriptionResult } from '../types.js';

/**
 * Slack Web API integration (plan §3). Uses bot-token capabilities only:
 *   users.lookupByEmail  (users:read.email) — resolve party → user id
 *   conversations.create (groups:write)     — create the private channel
 *   conversations.list   (groups:read)      — reuse on name_taken
 *   conversations.invite (groups:write)     — invite workspace members
 *   chat.postMessage     (chat:write)       — narrate the transaction
 *   auth.test                               — boot health check
 *
 * Principle: Slack is notification, never the source of truth. Channel/invite/
 * message failures are caught and logged; they never throw into a route.
 */

let web: WebClient | null = null;

function getWeb(): WebClient {
  if (!web) {
    if (!config.SLACK_BOT_TOKEN) {
      throw new Error('SLACK_BOT_TOKEN is not set.');
    }
    web = new WebClient(config.SLACK_BOT_TOKEN);
  }
  return web;
}

/** Extract a Slack API error code (e.g. "users_not_found") from a thrown error. */
function slackErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: { error?: unknown } }).data;
    if (data && typeof data.error === 'string') return data.error;
  }
  return null;
}

export interface SlackAuthStatus {
  ok: boolean;
  error?: string;
}

/** Boot health check — confirms the bot token works (plan §3.1). */
export async function verifyAuth(): Promise<SlackAuthStatus> {
  if (!config.SLACK_BOT_TOKEN) return { ok: false, error: 'no_token' };
  try {
    const res = await getWeb().auth.test();
    return { ok: Boolean(res.ok) };
  } catch (err) {
    return { ok: false, error: slackErrorCode(err) ?? 'auth_failed' };
  }
}

/** Resolve an email to a workspace user id, or null if not a member. */
export async function lookupUserByEmail(email: string): Promise<string | null> {
  try {
    const res = await getWeb().users.lookupByEmail({ email });
    return res.user?.id ?? null;
  } catch (err) {
    const code = slackErrorCode(err);
    if (code === 'users_not_found') return null;
    console.warn(`[slack] users.lookupByEmail(${email}) failed: ${code ?? String(err)}`);
    return null;
  }
}

/** Find an existing private channel by exact name (used on name_taken). */
async function findChannelByName(name: string): Promise<ChannelInfo | null> {
  try {
    let cursor: string | undefined;
    do {
      const res = await getWeb().conversations.list({
        types: 'private_channel',
        exclude_archived: true,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const match = res.channels?.find((c) => c.name === name);
      if (match?.id) return { id: match.id, name: match.name ?? name };
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch (err) {
    console.warn(`[slack] conversations.list failed: ${slackErrorCode(err) ?? String(err)}`);
  }
  return null;
}

/** Invite a single user; treats "already in channel" as success. */
async function inviteUser(channelId: string, userId: string): Promise<boolean> {
  try {
    await getWeb().conversations.invite({ channel: channelId, users: userId });
    return true;
  } catch (err) {
    const code = slackErrorCode(err);
    if (code === 'already_in_channel') return true;
    console.warn(`[slack] conversations.invite(${channelId}, ${userId}) failed: ${code ?? String(err)}`);
    return false;
  }
}

export interface EnsureChannelParams {
  consultantSlug: string;
  consultantSlackEmail: string | null;
  clientEmail: string;
  clientSlug: string;
  channelSeq: number;
  /** Existing channel for this pair, if any — reused without re-inviting. */
  existing: ChannelInfo | null;
}

export interface EnsureChannelResult {
  channel: ChannelInfo | null;
  reused: boolean;
  consultantInvited: boolean;
  clientInvited: boolean;
  clientNotifiedByEmail: boolean;
  notes: string[];
}

/**
 * Create (or reuse) the private channel for a (consultant, client) pair and
 * invite both parties using the two-tier strategy (plan §3.2): a party that is a
 * workspace member is invited directly; a party that cannot be added falls back
 * to email-only notification. Never throws — billing must proceed regardless.
 */
export async function ensureTxnChannel(
  params: EnsureChannelParams,
): Promise<EnsureChannelResult> {
  const notes: string[] = [];

  // Reuse path: a channel already exists for this pair.
  if (params.existing) {
    return {
      channel: params.existing,
      reused: true,
      consultantInvited: true,
      clientInvited: true,
      clientNotifiedByEmail: false,
      notes: ['Reused existing transaction channel.'],
    };
  }

  const name = buildChannelName(params.consultantSlug, params.clientSlug, params.channelSeq);

  let channel: ChannelInfo | null = null;
  try {
    const res = await getWeb().conversations.create({ name, is_private: true });
    if (res.channel?.id) {
      channel = { id: res.channel.id, name: res.channel.name ?? name };
    }
  } catch (err) {
    const code = slackErrorCode(err);
    if (code === 'name_taken') {
      channel = await findChannelByName(name);
      if (channel) notes.push('Channel name already existed — reused it.');
    }
    if (!channel) {
      console.warn(`[slack] conversations.create(${name}) failed: ${code ?? String(err)}`);
      notes.push(`Channel could not be created (${code ?? 'error'}); updates not posted to Slack.`);
    }
  }

  let consultantInvited = false;
  let clientInvited = false;
  let clientNotifiedByEmail = false;

  if (channel) {
    // Tier 1 — consultant (if a workspace email is configured).
    if (params.consultantSlackEmail) {
      const consultantId = await lookupUserByEmail(params.consultantSlackEmail);
      if (consultantId) {
        consultantInvited = await inviteUser(channel.id, consultantId);
      }
      if (!consultantInvited) notes.push('Consultant not invited (not a workspace member).');
    } else {
      notes.push('No consultant Slack email configured — consultant not invited.');
    }

    // Tier 1 → Tier 2 — client.
    const clientId = await lookupUserByEmail(params.clientEmail);
    if (clientId) {
      clientInvited = await inviteUser(channel.id, clientId);
    }
    if (!clientInvited) {
      clientNotifiedByEmail = true;
      notes.push('Client not a workspace member — notified by email instead.');
    }
  }

  return { channel, reused: false, consultantInvited, clientInvited, clientNotifiedByEmail, notes };
}

/** Post a message; never throws (failure isolation). Returns success. */
export async function postMessage(
  channelId: string | null,
  text: string,
  blocks: KnownBlock[],
): Promise<boolean> {
  if (!channelId) return false;
  try {
    await getWeb().chat.postMessage({ channel: channelId, text, blocks });
    return true;
  } catch (err) {
    console.warn(`[slack] chat.postMessage(${channelId}) failed: ${slackErrorCode(err) ?? String(err)}`);
    return false;
  }
}

// --- Pure Block Kit builders (plan §5) — unit-testable without touching Slack ---

export function buildTxnStartedBlocks(input: {
  consultantName: string;
  clientEmail: string;
  type: string;
}): KnownBlock[] {
  return [
    { type: 'header', text: { type: 'plain_text', text: ':wave: Transaction started', emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Consultant:*\n${input.consultantName}` },
        { type: 'mrkdwn', text: `*Client:*\n${input.clientEmail}` },
        { type: 'mrkdwn', text: `*Type:*\n${input.type}` },
      ],
    },
  ];
}

export function buildBookingStartedBlocks(productHandle: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:hourglass_flowing_sand: *Booking started* — creating your subscription on *${productHandle}*…`,
      },
    },
  ];
}

export function buildSubscriptionActiveBlocks(input: {
  result: SubscriptionResult;
  customerName: string;
  maxioUrl: string;
}): KnownBlock[] {
  const { result } = input;
  const fields: { type: 'mrkdwn'; text: string }[] = [
    { type: 'mrkdwn', text: `*Customer:*\n${input.customerName}` },
    { type: 'mrkdwn', text: `*Plan:*\n${result.productName} (\`${result.productHandle}\`)` },
    { type: 'mrkdwn', text: `*MRR:*\n${formatCents(result.mrrInCents, result.currency)} / month` },
    { type: 'mrkdwn', text: `*State:*\n${result.state}` },
  ];
  if (result.nextAssessmentAt) {
    fields.push({ type: 'mrkdwn', text: `*Next bill:*\n${result.nextAssessmentAt}` });
  }
  return [
    { type: 'header', text: { type: 'plain_text', text: ':tada: Subscription active', emoji: true } },
    { type: 'section', fields },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View in Maxio', emoji: true },
          url: input.maxioUrl,
          action_id: 'view_in_maxio',
        },
      ],
    },
  ];
}

export function buildUsageStartedBlocks(componentName: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `:bar_chart: *Recording usage* — ${componentName}…` },
    },
  ];
}

export function buildUsageRecordedBlocks(input: {
  componentName: string;
  quantity: number;
  unitName: string;
  periodTotal: number | null;
  recordedAs: 'metered' | 'event';
}): KnownBlock[] {
  const unit = input.quantity === 1 ? input.unitName : `${input.unitName}s`;
  const fields: { type: 'mrkdwn'; text: string }[] = [
    { type: 'mrkdwn', text: `*Component:*\n${input.componentName}` },
    { type: 'mrkdwn', text: `*Recorded:*\n${input.quantity} ${unit}` },
  ];
  if (input.periodTotal != null) {
    fields.push({ type: 'mrkdwn', text: `*Period total:*\n${input.periodTotal} ${input.unitName}s` });
  }
  return [
    { type: 'header', text: { type: 'plain_text', text: ':white_check_mark: Usage recorded', emoji: true } },
    { type: 'section', fields },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text:
            input.recordedAs === 'event'
              ? ':information_source: Recorded as a usage event — accrues to the next invoice.'
              : ':information_source: Accrues to the next invoice.',
        },
      ],
    },
  ];
}

export function buildPlanPreviewBlocks(input: {
  fromName: string;
  toName: string;
  proratedAdjustmentInCents: number;
  chargeInCents: number;
  creditAppliedInCents: number;
  paymentDueInCents: number;
}): KnownBlock[] {
  return [
    { type: 'header', text: { type: 'plain_text', text: ':mag: Plan change preview', emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Change:*\n${input.fromName} → ${input.toName}` },
        { type: 'mrkdwn', text: `*Prorated charge:*\n${formatCents(input.chargeInCents)}` },
        { type: 'mrkdwn', text: `*Credit applied:*\n${formatCents(input.creditAppliedInCents)}` },
        { type: 'mrkdwn', text: `*Due now:*\n${formatCents(input.paymentDueInCents)}` },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: ':information_source: Preview only — not yet applied.' }],
    },
  ];
}

export function buildPlanChangedBlocks(input: {
  fromName: string;
  toName: string;
  timing: 'prorate' | 'at-renewal';
  effectiveAt: string | null;
  maxioUrl: string;
}): KnownBlock[] {
  const effective =
    input.timing === 'prorate'
      ? 'immediately (prorated)'
      : `at next renewal${input.effectiveAt ? ` (${input.effectiveAt})` : ''}`;
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':arrows_counterclockwise: Plan changed', emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*From → To:*\n${input.fromName} → ${input.toName}` },
        { type: 'mrkdwn', text: `*Effective:*\n${effective}` },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View in Maxio', emoji: true },
          url: input.maxioUrl,
          action_id: 'view_in_maxio_plan',
        },
      ],
    },
  ];
}

export function buildLifecycleStartedBlocks(action: string): KnownBlock[] {
  const label = action.charAt(0).toUpperCase() + action.slice(1);
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `:vertical_traffic_light: *${label} in progress…*` },
    },
  ];
}

export function buildLifecycleDoneBlocks(input: {
  action: string;
  previousState: string;
  newState: string;
  effectiveAt: string | null;
  reasonCode: string | null;
  note: string | null;
}): KnownBlock[] {
  const fields: { type: 'mrkdwn'; text: string }[] = [
    { type: 'mrkdwn', text: `*Transition:*\n${input.previousState} → ${input.newState}` },
    { type: 'mrkdwn', text: `*Action:*\n${input.action}` },
  ];
  if (input.effectiveAt) {
    fields.push({ type: 'mrkdwn', text: `*Effective:*\n${input.effectiveAt}` });
  }
  if (input.reasonCode) {
    fields.push({ type: 'mrkdwn', text: `*Reason:*\n${input.reasonCode}` });
  }
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `:vertical_traffic_light: ${input.previousState} → ${input.newState}`, emoji: true },
    },
    { type: 'section', fields },
  ];
  if (input.note) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `:information_source: ${input.note}` }] });
  }
  return blocks;
}

export function buildInvoiceStartedBlocks(): KnownBlock[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: ':receipt: *Issuing invoice…*' } },
  ];
}

export function buildInvoiceIssuedBlocks(input: {
  number: string | null;
  totalAmount: string | null;
  dueAmount: string | null;
  dueDate: string | null;
  publicUrl: string | null;
  emailed: boolean;
}): KnownBlock[] {
  const fields: { type: 'mrkdwn'; text: string }[] = [
    { type: 'mrkdwn', text: `*Invoice:*\n${input.number ?? '—'}` },
    { type: 'mrkdwn', text: `*Amount due:*\n$${input.dueAmount ?? input.totalAmount ?? '0.00'}` },
  ];
  if (input.dueDate) fields.push({ type: 'mrkdwn', text: `*Due date:*\n${input.dueDate}` });
  fields.push({
    type: 'mrkdwn',
    text: `*Emailed:*\n${input.emailed ? 'yes' : 'no'}`,
  });

  const blocks: KnownBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: ':receipt: Invoice issued', emoji: true } },
    { type: 'section', fields },
  ];
  if (input.publicUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Pay Invoice', emoji: true },
          url: input.publicUrl,
          action_id: 'pay_invoice',
          style: 'primary',
        },
      ],
    });
  }
  return blocks;
}

export function buildFailureBlocks(useCase: string, error: string): KnownBlock[] {
  return [
    { type: 'header', text: { type: 'plain_text', text: `:warning: ${useCase} failed`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Error:*\n${error}` } },
  ];
}

export function buildEmailFallbackNoteBlocks(): KnownBlock[] {
  return [
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: ':email: The client is not a workspace member and will be notified by email.',
        },
      ],
    },
  ];
}
