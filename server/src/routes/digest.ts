import { Router, type Request, type Response } from 'express';
import { adminGuard } from '../auth.js';
import { config } from '../config.js';
import { digestSchema } from '../schemas/digest.js';
import { findConsultant } from '../constants.js';
import { sessionStore } from '../stores/sessionStore.js';
import { buildDigest, MaxioServiceError } from '../services/maxioService.js';
import { postMessage, buildDigestBlocks } from '../services/slackService.js';
import type { DigestResult } from '../types.js';

export const digestRouter = Router();

/**
 * Build a consultant's digest and post it to the configured digest channel
 * (plan §7 SLACK_DIGEST_CHANNEL). Returns the digest data and whether it was
 * posted. Shared by the manual route and the (flagged) cron.
 */
export async function postDigest(
  consultantId: string,
  windowDays: number,
): Promise<{ digest: DigestResult; posted: boolean; channelId: string | null }> {
  const digest = await buildDigest(consultantId, windowDays);
  const channelId = config.SLACK_DIGEST_CHANNEL || null;
  let posted = false;
  if (channelId) {
    posted = await postMessage(
      channelId,
      `Billing digest — ${digest.consultantName}`,
      buildDigestBlocks(digest),
    );
  }
  return { digest, posted, channelId };
}

/**
 * UC6 — Billing Activity Digest (admin only). Manual trigger (primary). Builds a
 * per-consultant summary from live Maxio data and posts it to the consultant
 * digest channel.
 */
digestRouter.post('/digest', adminGuard, async (req: Request, res: Response) => {
  const parsed = digestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;

  if (!findConsultant(input.consultantId)) {
    return res.status(400).json({
      status: 'invalid',
      errors: [{ path: 'consultantId', message: `unknown consultant '${input.consultantId}'` }],
    });
  }

  const session = sessionStore.ensure(input.sessionId);
  session.lastSubmission = input;
  sessionStore.put(session);

  try {
    const { digest, posted, channelId } = await postDigest(input.consultantId, input.windowDays);
    session.lastResult = digest;
    sessionStore.put(session);
    return res.json({ status: 'ok', digest, posted, channelId });
  } catch (err) {
    const message = err instanceof MaxioServiceError ? err.message : `UC6 failed: ${String(err)}`;
    return res.status(200).json({ status: 'maxio_failed', error: message });
  }
});
