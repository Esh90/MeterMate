# MeterMate — Maxio + Slack Integration Plan

> **A two-sided billing concierge: clients book/subscribe from the frontend, Maxio runs the billing, and a private Slack channel per transaction keeps the consultant and the client in the loop from start to finish.**
>
> A **client** submits an action from a web form (book a session, subscribe, report usage, change plan, pause/cancel). The backend holds that submission in a live in-memory session, drives the matching **Maxio Advanced Billing** operation, and — this is the heart of the model — **spins up a private Slack channel scoped to that one consultant↔client transaction**, invites both parties, and narrates the transaction there with **in-progress and completion** updates.
>
> **Stack:** TypeScript · Node + Express · React (SPA) · a Maxio Advanced Billing SDK · a Slack Web API SDK
>
> **SDK-agnostic by design:** this plan specifies *what* each operation must do
> (create a subscription, look up a user, create a private channel, post a
> message), never *which* SDK method or call shape. Any supported Maxio or Slack
> SDK satisfies it; the implementing agent maps each capability to its SDK.

---

## 1. Overview

### 1.1 What this is

MeterMate is an end-to-end billing concierge for a two-sided consulting marketplace. A client submits a billing action from the frontend; the backend drives the matching Maxio operation and narrates it live in a private Slack channel scoped to that one consultant↔client transaction.

The design at a glance:

| Layer | MeterMate |
| --- | --- |
| Actors | **Client** (self-serve) **+ Consultant/Admin** (hardcoded creds for now) |
| Input source | **React frontend** — explicit client & admin submissions |
| State | **in-memory session + transaction store** (live; DB-ready) |
| Billing engine | **Maxio Advanced Billing** — full subscription lifecycle |
| Notification | **a private Slack channel created per transaction**, both parties invited, live updates |
| Cadence | **in-progress + completion updates** posted into the transaction channel |

### 1.2 Two actors at the frontend

The lead confirmed both a self-subscribing **client** and a **consultant/admin** use the frontend.

- **Client** — fills in real forms (book session, subscribe, report usage, request plan change / cancellation). No login required to *act*; identified by email.
- **Consultant / Admin** — for now uses **hardcoded credentials** (a simple env-configured operator identity and a guard on admin-only routes). No real signup/login flow is built in this phase; the architecture leaves a clean seam to add OAuth/JWT later. Admins can issue invoices, approve plan changes, and view the activity digest.

### 1.3 The transaction-channel model (the core idea)

This replaces the single shared channel with a **channel-per-transaction** topology:

```
Consultant C1                        Consultant C2
   │                                    │
   ├─ Client A books C1  ─▶  #txn-c1-clienta-001   (C1 + A + bot)
   ├─ Client B books C1  ─▶  #txn-c1-clientb-002   (C1 + B + bot)
   │
   └─ (separate)        ─▶  Client D books C2 ─▶ #txn-c2-clientd-003 (C2 + D + bot)
```

Each booking/subscription creates **one private Slack channel** containing exactly the consultant for that transaction, the client, and the MeterMate bot. The bot posts every update about *that* transaction there — and nowhere else. Different client → different channel. Different consultant → their own channels. A consultant only ever sees the channels for transactions that involve them.

### 1.4 Why Maxio changes the use-case surface

Maxio (formerly Chargify) is a B2B SaaS **recurring-billing platform**: Customers, Products/Families, Subscriptions (create/pause/resume/cancel/reactivate), Components (metered/quantity/prepaid/**event-based usage**), Usage records, Invoices (create/send/refund/void/credit notes), Coupons, Billing Portal, Offers, Webhooks, Insights reporting. That breadth is where the rich use-case surface comes from. We choose **depth over breadth**: five core use cases, each fully specified end-to-end.

### 1.5 The core loop (every use case follows this shape)

```
  React form (client or admin)
        │  POST /api/<usecase>   (+ sessionId)
        ▼
  Express route + Zod validation + (admin guard if needed)
        │
        ▼
  sessionStore.put / transactionStore.put         ← live memory, TTL-swept
        │
        ├─▶ slackService.ensureTxnChannel(txn)     ← create private channel +
        │        (create → invite consultant +         invite both parties (once)
        │         client → post "started")
        │
        ▼
  maxioService.<operation>(submission)            ← billing operation via the Maxio SDK
        │     │
        │     ├─ in-progress ─▶ slackService.postProgress(txnChannel, step)
        │     │
        │     ├─ success ─────▶ slackService.postCompletion(txnChannel, result)
        │     └─ failure ─────▶ slackService.postFailure(txnChannel, error)
        ▼
  JSON response back to React  { status, txnId, channelId, ...result }
```

### 1.6 Pricing model (seeded, global)

A deliberately small model: a **flat monthly retainer plan + metered usage**,
priced **globally** (the same rates for every consultant — the consultant is a
label on the transaction, not a rate). All four items are created by the Phase 1
seed with explicit price points, so nothing relies on Maxio defaults.

| Item | Maxio type | Handle | Price | Scheme |
| --- | --- | --- | --- | --- |
| Basic plan | Product (recurring monthly) | `basic` | **$99 / month** | flat recurring |
| Pro plan | Product (recurring monthly) | `pro` | **$299 / month** | flat recurring |
| Consulting time | Metered component | `consulting-minutes` | **$2.00 / minute** | per-unit |
| API calls | Event-based component | `api-calls` | **$0.01 / event** | per-unit |

- **A subscription = one plan.** UC1 enrolls the client on `basic` or `pro`; that
  recurring fee is the MRR shown in Slack.
- **Consultations bill as usage on top.** UC2 reports minutes against
  `consulting-minutes` (rated per-unit, accrued to the next invoice); `api-calls`
  covers per-event charges recorded as usage events.
- **Plan change** (UC3) moves `basic` ↔ `pro` with proration on the delta.
- **Out of scope / future:** per-consultant rates would require per-consultant
  products or custom price points; this phase keeps one global price point per
  item for a one-line seed.

---

## 2. Use Cases

Five core use cases plus a cross-cutting reporting digest. Each maps to a React
form, an Express route, a `maxioService` operation, a transaction record, and a
sequence of Slack messages **inside that transaction's private channel**.

> **Channel lifecycle, shared by all UCs:** the first action of a *new*
> consultant↔client pairing creates the private channel and invites both parties;
> subsequent actions for the same pairing **reuse** that channel (looked up in the
> transaction store). Every UC posts a "started" message, optional progress
> messages, and a "completed"/"failed" message into that channel.

---

### UC1 — Book & Subscribe (Client → Customer + Subscription)

A client books a session with a named consultant and is enrolled on a plan.

**Actor:** Client.
**Frontend fields:** client first/last name, client email, consultant (dropdown of consultants), product handle (plan), payment collection method (`automatic` | `remittance`), optional coupon.

**Flow:**
1. React posts to `POST /api/book`.
2. Backend validates, creates a **transaction record** `{ txnId, consultantId, clientEmail, type: 'subscription', state: 'started' }`, caches it under the session.
3. `slackService.ensureTxnChannel()` creates the private channel `#txn-<consultant>-<client>-<n>`, invites the consultant + client, posts **":hourglass_flowing_sand: Booking started — creating your subscription…"**.
4. `maxioService.createSubscription()` **creates a subscription** for the client against the chosen plan, creating the customer inline from the submitted name/email (or reusing an existing customer matched by an email reference). The collection method and optional coupon are passed through.
5. On success: transaction → `completed`; post **":tada: Subscription active"** with plan, MRR, state, next assessment date, and a "View in Maxio" button.
6. On failure: post **":warning: Booking failed"** with the Maxio error summary; transaction → `failed`.

**Capability required:** create a subscription (with inline customer creation, an email-based customer reference for idempotency, a payment collection method, and an optional coupon) and read back plan, MRR, state, and next assessment date.

---

### UC2 — Report Session Usage (Metered / Event-Based Components)

A consultant (or client) reports consumption — e.g. consulting minutes or API
calls — against a metered component. Maxio rates and accrues it to the next
invoice.

**Actor:** Client or Admin (both allowed).
**Frontend fields:** transaction reference (or consultant+client), component handle, quantity, optional memo, optional timestamp.

**Flow:**
1. `POST /api/usage` → validate → resolve the existing transaction + its channel.
2. Post **":bar_chart: Recording usage…"** to the channel.
3. `maxioService.recordUsage()` **records usage** against the component: for a metered/quantity component, record a usage quantity (with optional memo); for an event-based component, record a usage event (with the optional timestamp). The service dispatches on the cached component type.
4. Post **":white_check_mark: Usage recorded"** with quantity, the running period total (read back from the provider's usage history), and "accrues to next invoice."

**Capability required:** record metered usage (quantity + memo) for a component, record a usage event (timestamp) for an event-based component, and list a component's recorded usage for the current period.

---

### UC3 — Plan Change (Upgrade / Downgrade with Proration Preview)

A client requests a plan change; the channel shows the prorated delta before it
commits.

**Actor:** Client requests; Admin can approve (configurable).
**Frontend fields:** transaction reference, target product handle, timing (`prorate` | `at-renewal`).

**Flow:**
1. `POST /api/plan-change/preview` → **preview the prorated cost** of moving the subscription to the target plan → returns the prorated amount to the UI **and** posts **":mag: Previewing plan change…"** + the computed delta to the channel.
2. On confirm: `POST /api/plan-change` → **apply the plan change**. For `prorate` timing, change the plan **now with proration** (the preview and the commit use the same prorated mechanism). For `at-renewal` timing, schedule a **non-prorated** plan change that takes effect at the next renewal.
3. Post **":arrows_counterclockwise: Plan changed"** old → new, proration, effective date.

> **Proration is a capability requirement, not a default.** "Prorate now" must use
> a mechanism that computes and charges the prorated delta immediately *and* can
> be previewed beforehand (the preview must reflect the same proration the commit
> will apply). "At renewal" must change the plan without proration, effective next
> period. The agent selects whichever SDK operations provide these two behaviours;
> a plain attribute update that defers billing to the next period does **not**
> satisfy the "prorate now" path.

---

### UC4 — Lifecycle Control (Pause / Resume / Cancel / Reactivate)

One form, four lifecycle actions through Maxio's subscription lifecycle operations.

**Actor:** Client (pause/cancel own); Admin (all).
**Frontend fields:** transaction reference, action (`pause` | `resume` | `cancel` | `reactivate`), cancel type (`immediate` | `end-of-period`), optional reason code.

**Flow:**
1. `POST /api/lifecycle` → validate → resolve transaction/channel.
2. Post **":vertical_traffic_light: <Action> in progress…"**.
3. Dispatch to the matching lifecycle operation; read back the new `state`.
4. Post **":vertical_traffic_light: <state-transition>"** (e.g. `active → canceled`) with reason and effective date.

**Capability required** — map each action to the provider's matching lifecycle operation:
- `pause` → place the subscription on hold.
- `resume` → resume the on-hold subscription.
- `cancel` + `immediate` → cancel the subscription now.
- `cancel` + `end-of-period` → schedule cancellation at end of the current period (delayed cancellation).
- `reactivate` → reactivate a canceled subscription.

---

### UC5 — Invoice Issue + Send (On-Demand Billing)

For remittance subscriptions, an **admin** issues and emails a real, itemized,
Maxio-hosted invoice with a hosted public payment URL.

**Actor:** Admin only (guarded route).
**Frontend fields:** transaction reference, optional line items / memo, "send email" toggle.

**Flow:**
1. `POST /api/invoices` (admin) → resolve transaction/channel.
2. Post **":receipt: Issuing invoice…"**.
3. **Create** the invoice (from line items / memo) → **issue** it → **optionally email** it to the client; read back the hosted public payment URL.
4. Post **":receipt: Invoice issued"** with amount due, due date, and a **"Pay Invoice"** button linking to the hosted invoice URL.

**Capability required:** create an ad-hoc invoice for the subscription, issue it, optionally email it to the customer, and read the issued invoice's amount due, due date, and hosted public payment URL.

---

### UC6 (cross-cutting) — Billing Activity Digest

A summary posted to a **consultant's own digest channel** (and available on a
manual `POST /api/digest`), built from Maxio's live data. Per-consultant, not
per-transaction.

**Flow:**
1. Manual trigger (primary) or scheduled cron (behind a flag) → `maxioService.buildDigest(consultantId)`.
2. Aggregate from the provider's subscription list, invoice list, and event/activity data (active count, MRR, new signups, churn, overdue invoices) scoped to that consultant.
3. Post **":chart_with_upwards_trend: Billing digest"** to the consultant's digest channel.

> **Constraint, mirrored from Maxio docs:** reporting data is for
> reconciliation, not real-time confirmation; counts may lag live state slightly.
> The digest message says so.

**Capability required:** list subscriptions, list invoices (with status), and read recent site events/activity, each filterable to a consultant's scope.

---

## 3. The Slack transaction-channel mechanism

This is the load-bearing new piece, so it is specified precisely — as
**capabilities and scopes**, not SDK calls. All operations below are standard
**bot-token** Web API capabilities — **no Enterprise/admin token required** for
the core path. Each maps to one method in any supported Slack SDK; the agent
supplies the call shape and token-passing convention its SDK requires (see §4.4).

### 3.1 Slack capabilities used

| Step | Capability | Scope | Notes |
| --- | --- | --- | --- |
| Resolve party → user ID | Look up a user by email | `users:read.email` | Reports "user not found" if the person isn't in the workspace |
| Create private channel | Create a channel, private | `groups:write` | Name ≤ 80 chars, `[a-z0-9-_]`; store both `id` and `name` |
| Invite both parties | Invite user(s) to the channel | `groups:write` | **Only accepts user IDs of existing workspace members**; the bot must be in the channel (it is, as creator) |
| Post messages | Post a message with rich blocks (Block Kit) | `chat:write` | The bot posts every update; builders return a blocks array the SDK serializes |
| (optional) topic/purpose | Set the channel topic | `groups:write` | Sets a human-readable transaction summary |
| Health check (boot) | Verify auth / identity | — | Confirms the bot token works at startup |

### 3.2 The hard constraint, and how we handle it honestly

**Inviting a user to a channel can only add people who already exist in the Slack
workspace.** Looking up a user by email is how we turn an email into a user ID,
and it reports "user not found" when the client isn't a workspace member. A
consultant's external clients usually **aren't** in the consultant's workspace,
and there is no supported way to add a non-member to a private channel — so
inviting arbitrary external clients is explicitly out of scope here (see §10).

The plan does **not** pretend the happy path always works. `ensureTxnChannel`
uses a **two-tier strategy**, decided per party at runtime:

1. **Party is a workspace member** (lookup succeeds) → invite directly. This is
   the clean demo path: seed the demo client + consultant as real workspace
   members (or single-channel guests) so invites succeed.
2. **Party can't be added** → the channel is still created with the consultant +
   bot; the client gets their updates and the hosted invoice/pay link **by email**
   (Maxio already emails them when an invoice is sent), and the channel notes
   *"client notified by email."* Nothing in the flow breaks.

This keeps the channel-per-transaction model real and demoable while being
upfront that inviting arbitrary external clients into a private channel is a
genuine Slack limitation, not a coding detail.

### 3.3 Channel naming & reuse

- Name: `txn-<consultantSlug>-<clientSlug>-<seq>` (lowercased, sanitized, ≤ 80).
- The **transaction store** maps `(consultantId, clientEmail)` → `channelId`.
  The first action creates + invites; later actions for the same pair **reuse**
  the channel. Re-creating a channel with an existing name reports "name taken",
  which we treat as "look it up and reuse."
- Both `channelId` and `channelName` are stored (Slack docs explicitly recommend
  storing both; private-channel IDs can change if later shared).

### 3.4 Update cadence (in-progress + completion)

Every UC posts a **started** message immediately, optional **progress** messages
on multi-step operations (UC3 preview, UC5 create→issue→send), and a terminal
**completed** or **failed** message. The consultant and client watch the
transaction unfold live in their private channel — the "be creative" brief,
realized as a play-by-play rather than a single receipt.

---

## 4. Architecture

### 4.1 Repository structure

```
metermate/
├── README.md
├── package.json                     # npm workspaces: server + web
├── tsconfig.json
├── .env.example
├── .gitignore
│
├── server/                          # Express + TypeScript backend
│   ├── src/
│   │   ├── index.ts                 # bootstrap, route mounting, cron, static SPA
│   │   ├── config.ts                # typed env loader, constants
│   │   ├── auth.ts                  # hardcoded admin creds + adminGuard middleware
│   │   ├── stores/
│   │   │   ├── sessionStore.ts      # Map<sessionId, SessionData>, TTL sweep
│   │   │   └── transactionStore.ts  # Map<txnId,...> + (consultant,client)->channel
│   │   ├── maxioClient.ts           # singleton billing SDK client (whichever Maxio SDK)
│   │   ├── routes/
│   │   │   ├── book.ts              # UC1
│   │   │   ├── usage.ts             # UC2
│   │   │   ├── planChange.ts        # UC3 (+ /preview)
│   │   │   ├── lifecycle.ts         # UC4
│   │   │   ├── invoices.ts          # UC5 (adminGuard)
│   │   │   ├── digest.ts            # UC6
│   │   │   └── meta.ts              # /health, /products, /consultants
│   │   ├── services/
│   │   │   ├── maxioService.ts      # one fn per UC; no Express/Slack imports
│   │   │   └── slackService.ts      # ensureTxnChannel + message builders + Slack SDK
│   │   ├── schemas/                 # Zod request schemas per route
│   │   └── types.ts                 # shared domain types
│   └── tests/
│       ├── unit/                    # services, stores, builders, schemas
│       ├── integration/             # route -> service wiring, externals mocked
│       └── system/                  # supertest over HTTP, full flow
│
├── web/                             # React SPA (Vite + TypeScript)
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                  # role switch (Client | Admin) + routing
│       ├── api.ts                   # typed fetch wrappers
│       ├── session.ts               # client-side sessionId handling
│       └── components/
│           ├── client/
│           │   ├── BookForm.tsx     # UC1
│           │   ├── UsageForm.tsx    # UC2
│           │   ├── PlanChangeForm.tsx  # UC3 (+ preview panel)
│           │   └── LifecycleForm.tsx   # UC4
│           └── admin/
│               ├── AdminLogin.tsx   # hardcoded-cred gate (simple)
│               ├── InvoiceForm.tsx  # UC5
│               └── ActivityPanel.tsx# UC6 + transaction list
│
└── docs/
    ├── SETUP.md                     # Maxio + Slack credentials, scopes, seeding
    ├── ARCHITECTURE.md              # this section expanded + diagrams
    ├── SLACK_CHANNELS.md            # transaction-channel mechanism + constraints
    ├── SERVICES.md                  # per-service contracts
    ├── API.md                       # REST endpoint reference
    ├── TESTING.md                   # test layers + AC coverage map
    └── USECASES.md                  # UC1–UC6 walkthroughs
```

### 4.2 Component responsibilities

| Component | Responsibility |
| --- | --- |
| `web/` (React) | Two roles (Client / Admin) selectable in the shell; one form per UC; sends `sessionId`; renders results, previews, and the resulting channel name. |
| `auth.ts` | Hardcoded admin identity from env; `adminGuard` middleware on UC5/UC6 and approvals. Clean seam for real auth later. |
| `sessionStore` | Live submission + last result per `sessionId`; TTL sweep. |
| `transactionStore` | Transaction records + the `(consultant,client) → channelId` map that powers channel reuse. |
| `maxioClient` | One billing SDK client configured with HTTP Basic auth + site + environment. |
| `maxioService` | One fn per UC; wraps the billing SDK, normalizes results, throws typed errors. No Express/Slack imports (unit-testable). |
| `slackService` | `ensureTxnChannel` (lookup→create→invite, two-tier fallback), pure message builders, message posting. |
| `schemas/` | Zod; invalid input → `400` before any Maxio/Slack call. |

### 4.3 State & memory model

- **In-memory, session + transaction scoped** (`Map`s), exactly as the lead
  framed it ("in memory until session exists; DB later").
- `sessionStore` holds the current submission + last Maxio result so multi-step
  flows (UC3 preview → confirm) work without re-sending everything.
- `transactionStore` holds transaction state and the **channel reuse map**, so the
  second action for a consultant↔client pair reuses the existing private channel.
- **TTL sweep** clears idle sessions (default 30 min) so memory doesn't grow
  unbounded.
- **Idempotency:** customer `reference` = email; a per-submission key guards
  double-submits so a retried form doesn't create a duplicate subscription.
- **DB-ready:** both stores expose `get/put/delete/sweep`; swapping to Redis/
  Postgres is a per-file change. Nothing else imports the `Map`s.

### 4.4 Authentication

- **Maxio:** HTTP Basic (API key as username, `x` as password), scoped to a
  **site subdomain**, **US**/**EU** environment. From `MAXIO_API_KEY`,
  `MAXIO_SITE_SUBDOMAIN`, `MAXIO_ENVIRONMENT`. All testing against a **Maxio test
  site** (test mode), never live.
- **Slack:** a Slack **app** with a **bot token** (`xoxb-…`) and scopes
  `chat:write`, `groups:write`, `users:read.email` (+ `groups:read` for reuse
  lookups). A bot token is required (not an incoming webhook) because the app must
  *create private channels and invite users* — a webhook can only post to one
  preconfigured channel.
  - **Token wiring is SDK-dependent** and abstracted behind `slackService`. Some
    SDKs accept the bot token directly on the client; others require additional
    client credentials (e.g. OAuth client id/secret) and take the token per call.
    The implementing agent configures whatever its chosen SDK needs; the bot token
    always comes from `SLACK_BOT_TOKEN`, and SETUP.md documents the exact client
    config for the SDK in use. Nothing outside `slackService` depends on it.
- **App (admin):** hardcoded operator credentials from env (`ADMIN_USER`,
  `ADMIN_PASSWORD`) checked by `adminGuard`. Explicitly a placeholder for real
  auth.

### 4.5 Frontend ↔ backend contract

```
POST /api/book                 { sessionId, firstName, lastName, email, consultantId, productHandle, collectionMethod, couponCode? }
POST /api/usage                { sessionId, txnRef, componentHandle, quantity, memo?, timestamp? }
POST /api/plan-change/preview  { sessionId, txnRef, targetHandle, timing }
POST /api/plan-change          { sessionId, txnRef, targetHandle, timing }
POST /api/lifecycle            { sessionId, txnRef, action, cancelType?, reasonCode? }
POST /api/invoices             { sessionId, txnRef, lineItems?, memo?, sendEmail }   (adminGuard)
POST /api/digest               { sessionId, consultantId, windowDays? }              (adminGuard)
GET  /api/health               -> { status, sessions, transactions, maxioSite, slackOk }
GET  /api/products             -> plan dropdown (cached at boot)
GET  /api/consultants          -> consultant dropdown (seeded)
```

Every mutating response: `{ status: 'ok' | 'maxio_failed' | 'invalid' | 'session_expired', txnId, channelId?, channelName?, ...payload }` — a `status`-discriminated shape that always reports which channel was created or reused.

---

## 5. Slack message design (Block Kit)

Every message lands **in the transaction's private channel** (UC6 digest is the
exception — consultant digest channel). Pattern: header + context (who/when) +
fields grid (billing facts) + button where relevant.

| Moment | Header | Key fields | Button |
| --- | --- | --- | --- |
| Channel opened | `:wave: Transaction started` | consultant, client, type | — |
| UC1 progress | `:hourglass_flowing_sand: Creating subscription…` | plan | — |
| UC1 done | `:tada: Subscription active` | customer, plan, MRR, state, next bill | View in Maxio |
| UC2 done | `:bar_chart: Usage recorded` | component, qty, period total | — |
| UC3 preview | `:mag: Plan change preview` | old → new, proration | — |
| UC3 done | `:arrows_counterclockwise: Plan changed` | old → new, effective | View in Maxio |
| UC4 done | `:vertical_traffic_light: <transition>` | state, reason, date | — |
| UC5 done | `:receipt: Invoice issued` | amount due, due date | Pay Invoice |
| UC6 digest | `:chart_with_upwards_trend: Billing digest` | active, MRR, new, churn, overdue | — |
| any failure | `:warning: <UC> failed` | what failed, Maxio error | — |

Builders are pure functions returning the blocks array, so they are unit-testable
without touching Slack.

---

## 6. Failure isolation

| Failure point | Behaviour |
| --- | --- |
| Zod validation fails | `400`; no Maxio/Slack; nothing created |
| User lookup → not found | Fall to tier 2 (email-only); channel still created with consultant + bot |
| Channel create → name already taken | Reuse the existing channel (look up via store / channel listing) |
| Channel invite fails for one party | `:warning:` note in channel ("client notified by email"); flow continues |
| Maxio call fails | No completion block; failure block in channel; typed error → form |
| Message post fails | Logged; HTTP response still `ok` (billing is source of truth) |
| Session/transaction expired | `409` asking the client to restart the flow |

**Principle:** the billing action is the source of truth; Slack
(channel creation, invites, messages) is notification — its failures never roll
back billing or block the HTTP response.

---

## 7. Environment variables

```env
# Maxio Advanced Billing
MAXIO_API_KEY=
MAXIO_SITE_SUBDOMAIN=your-test-site
MAXIO_ENVIRONMENT=US                 # US | EU
MAXIO_DEFAULT_PRODUCT_FAMILY=

# Slack (bot-token app)
SLACK_BOT_TOKEN=xoxb-...             # the app's bot token (used by slackService)
SLACK_DIGEST_CHANNEL=C0XXXXXXX       # fallback/consultant digest channel
# Plus any client credentials the chosen Slack SDK requires (e.g. OAuth client
# id/secret). Add them here per SETUP.md; only slackService reads them.

# Admin (placeholder auth)
ADMIN_USER=admin
ADMIN_PASSWORD=changeme

# App
PORT=4000
SESSION_TTL_MINUTES=30
DEMO_MODE=true                       # seeds demo products/components/consultants
DIGEST_CRON=0 9 * * 1                # ignored unless enabled
```

---

## 8. Implementation plan (phased)

### Phase 0 — Scaffold
- npm workspaces: `server/` (Express + TS + tsx) and `web/` (Vite + React + TS); lint/format; `.env.example`; `config.ts`; `GET /api/health` green.
- **Verify:** `npm run dev` serves API on `:4000` + Vite on `:5173`; health returns `{ status: "ok" }`.

### Phase 1 — Maxio client + test-site seeding
- `maxioClient.ts` (the billing SDK client); a `seed` script creating the Product Family and the four §1.6 priced items — products `basic` ($99/mo) and `pro` ($299/mo), a metered `consulting-minutes` ($2.00/min, per-unit) and an event-based `api-calls` ($0.01/event) component — plus demo consultants. Each gets an explicit price point so no Maxio default is assumed.
- **Verify:** seed prints handles + prices; the product list and `/api/consultants` return them.

### Phase 2 — `slackService.ensureTxnChannel` + tiered invite + unit tests
- Implement lookup → create → invite with the two-tier (member-invite → email-only) fallback; channel reuse via store.
- **Verify (unit):** mocked Slack client — channel created, both parties invited on tier 1; a user-not-found lookup falls through to email-only without throwing; a name-already-taken result reuses the channel.

### Phase 3 — `maxioService` (one fn per UC) + unit tests
- One function per UC — subscribe, record usage, preview + change plan, lifecycle, issue + send invoice, build digest; billing SDK mocked; happy + error path each.
- **Verify:** `npm test -- unit` green; ≥2 tests per fn.

### Phase 4 — Block Kit builders + unit tests
- Pure builders per Section 5 (started/progress/completion/failure/digest).
- **Verify:** builder tests assert required fields + button URLs.

### Phase 5 — Routes + stores + Zod + adminGuard
- `sessionStore`, `transactionStore` (with channel-reuse map); one route per UC wiring validate → store → ensureChannel → maxio → slack; `adminGuard` on UC5/UC6.
- **Verify (integration):** each route with Maxio + Slack mocked; assert order (started → maxio → completion), channel reuse on second action for same pair, failure isolation, admin guard blocks non-admins.

### Phase 6 — React SPA (Client + Admin)
- Role switch; client forms (UC1–UC4) and admin forms (UC5–UC6); preview panel; shows resulting channel name; typed `api.ts`; `sessionId` handling.
- **Verify:** manual click-through both roles against the test site; a private channel appears per transaction with live updates.

### Phase 7 — Digest cron + system tests + docs
- `node-cron` digest (flagged); `supertest` system tests over HTTP; write all `docs/*.md` including `SLACK_CHANNELS.md`.
- **Verify:** `npm test` (all layers) green; docs complete.

---

## 9. Testing strategy

Three layers — unit, integration, and system — all offline in CI (no live
Maxio/Slack).

- **Unit** — `maxioService` (SDK mocked); `slackService.ensureTxnChannel` tiers +
  builders; `sessionStore`/`transactionStore` TTL, idempotency, channel reuse;
  Zod schemas. One file per module.
- **Integration** — each Express route through to its service with the Maxio +
  Slack SDKs mocked; asserts validate → ensureChannel → Maxio → Slack ordering,
  channel **reuse** on the second action for a pair, admin guard, and that a Slack
  failure does not fail the HTTP response.
- **System (e2e)** — `supertest` against the app: real routing + stores, mocked
  externals; verifies the `status`-discriminated shape, the UC3 preview→confirm
  two-step, channel-per-transaction creation vs reuse, and session expiry.
- **Live smoke** — a non-CI script that runs one real call per UC against the
  Maxio **test site** and a scratch Slack workspace (creating a real private
  channel and inviting a seeded member), for manual end-to-end verification.

### Acceptance criteria

| ID | Criterion | UC | Priority |
| --- | --- | --- | --- |
| AC-01 | Valid booking creates customer + subscription, returns state | UC1 | must |
| AC-02 | A new consultant↔client pair creates exactly one private channel | UC1 | must |
| AC-03 | Both parties (when workspace members) are invited to the channel | UC1 | must |
| AC-04 | User-not-found lookup falls back gracefully; flow still completes | UC1 | must |
| AC-05 | Second action for the same pair reuses the existing channel | any | must |
| AC-06 | Invalid product handle → `maxio_failed`, failure block posted | UC1 | must |
| AC-07 | Duplicate booking (same email) is idempotent | UC1 | should |
| AC-08 | Metered usage records + accrues; event-based usage recorded as an event | UC2 | must |
| AC-09 | Plan-change preview returns proration before commit | UC3 | must |
| AC-10 | Plan change posts old→new to the transaction channel | UC3 | must |
| AC-11 | Each lifecycle action maps to the correct lifecycle operation | UC4 | must |
| AC-12 | End-of-period cancel uses delayed cancellation | UC4 | should |
| AC-13 | Invoice created→issued→(sent); hosted URL on Pay button | UC5 | must |
| AC-14 | UC5/UC6 routes reject non-admin callers (adminGuard) | UC5/6 | must |
| AC-15 | Started → completion messages post in order to the channel | all | must |
| AC-16 | Slack failure never blocks the HTTP response | all | must |
| AC-17 | Session/transaction expiry returns `409` | all | should |
| AC-18 | Every mutating route validates input before any external call | all | must |

---

## 10. Out of scope (mention, don't build)

- **Real auth** — admin is hardcoded creds now; OAuth/JWT is a clean later swap.
- **Cross-org / external-client invites** — there is no supported way to add a
  non-member to a private channel, so cross-org/external-client invites are out
  of scope entirely. The two-tier `ensureTxnChannel` (member-invite → email-only)
  covers external clients via email instead.
- **Interactive Slack buttons / slash commands** — bot-token choice leaves this
  open; needs a public events endpoint; pitch point only.
- **Real payment-method capture** — Chargify.js / hosted Billing Portal in
  production; demo uses test-mode tokens.
- **Persistent DB** — both stores are DB-ready interfaces; Redis/Postgres later.
- **Maxio → app webhooks** — would make UC6 real-time instead of polled; natural
  follow-up.
- **Channel archival on transaction close** — archiving a channel could tidy
  completed transactions; noted, not built.

---

## 11. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| External client not in Slack workspace → can't invite | Two-tier `ensureTxnChannel`: invite if member, else email-only; channel still created |
| Channel name collisions (name already taken) | Deterministic sanitized names + reuse map; treat a name-taken result as reuse |
| Private-channel ID changes if later shared | Store both `id` and `name`; re-resolve by name when needed (per Slack docs) |
| Slack rate limits when creating many channels | One channel per pair (reused); create only on first action; backoff on rate-limit responses |
| Maxio test-site rate limits | Seed once at boot; cache product/consultant lists |
| Component type mismatch (metered vs event) | Cache component types at startup; usage recording dispatches on type |
| Proration surprises on plan change | Always run preview (UC3) and show delta before commit |
| Missing Slack scopes (`groups:write`, `users:read.email`) | SETUP.md lists exact scopes; `/health` runs a Slack auth check at boot |
| Session lost on restart mid-demo | Short deterministic flows; idempotent re-submit by email reference |
| SDK drift | Pin the chosen Maxio and Slack SDK versions exactly |

---

## 12. Resolved decisions (from the lead)

1. **Two actors:** client (self-serve forms) + admin/consultant (**hardcoded
   creds**, no signup/login flow this phase).
2. **Channel topology:** **private channel per consultant↔client transaction**,
   both parties invited, reused for subsequent actions of the same pair — not one
   shared channel.
3. **Cadence:** **in-progress *and* completion** updates posted into the
   transaction channel (play-by-play), not a passive manual-only digest. UC6
   digest remains a per-consultant summary, manual-trigger primary with optional
   cron.

> **One honesty note carried into the build:** inviting an *external* client into
> a private Slack channel only works if they're already a workspace member. The
> two-tier fallback in §3.2 keeps the model working regardless; the clean demo
> path is to seed the demo client + consultant as workspace members.

---

_Industry: B2B SaaS recurring billing — a two-sided billing concierge, every transaction narrated in its own private Slack room._
