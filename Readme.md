# MeterMate

> A two-sided billing concierge: clients book and subscribe from the frontend, Maxio runs the billing, and a private Slack channel per transaction keeps the consultant and the client in the loop from start to finish.

---

## What It Does

MeterMate is an end-to-end billing concierge for a two-sided consulting marketplace. A client submits a billing action from a web form; the backend drives the matching Maxio Advanced Billing operation and narrates it live in a **private Slack channel scoped to that one consultant↔client transaction**.

Every transaction gets its own private Slack channel. The consultant, the client, and the MeterMate bot are the only members. The bot posts every update — booking started, subscription active, usage recorded, invoice issued — as a live play-by-play inside that channel.

---

## Core Use Cases

| # | Use Case | Actor | What Happens |
|---|---|---|---|
| UC1 | Book & Subscribe | Client | Creates a Maxio customer + subscription; spins up the private Slack channel |
| UC2 | Report Session Usage | Client or Admin | Records metered or event-based usage against a component; accrues to next invoice |
| UC3 | Plan Change | Client / Admin | Previews proration, then upgrades or downgrades the plan immediately or at renewal |
| UC4 | Lifecycle Control | Client / Admin | Pause, resume, cancel (immediate or end-of-period), or reactivate a subscription |
| UC5 | Invoice Issue + Send | Admin only | Creates and issues an itemized Maxio invoice; posts a Pay Invoice button to Slack |
| UC6 | Billing Activity Digest | Admin | Aggregates active subscriptions, MRR, churn, and overdue invoices into a Slack digest |

---

## The Transaction-Channel Model

```
Consultant C1                        Consultant C2
   │                                    │
   ├─ Client A books C1  ─▶  #txn-c1-clienta-001   (C1 + A + bot)
   ├─ Client B books C1  ─▶  #txn-c1-clientb-002   (C1 + B + bot)
   │
   └─ (separate)        ─▶  Client D books C2 ─▶ #txn-c2-clientd-003 (C2 + D + bot)
```

- Each consultant↔client pairing gets exactly **one** private channel, created on first action and reused for all subsequent actions.
- A consultant only ever sees channels for their own transactions.
- If a client is not a Slack workspace member, the channel is created with the consultant + bot and the client is notified by email instead.

---

## Pricing Model (Seeded)

| Item | Type | Handle | Price |
|---|---|---|---|
| Basic plan | Product — monthly | `basic` | $99 / month |
| Pro plan | Product — monthly | `pro` | $299 / month |
| Consulting time | Metered component | `consulting-minutes` | $2.00 / minute |
| API calls | Event-based component | `api-calls` | $0.01 / event |

---

## Stack

- **Backend:** Node.js · Express · TypeScript · Zod
- **Frontend:** React · Vite · TypeScript
- **Billing:** Maxio Advanced Billing (`@maxio-com/advanced-billing-sdk`)
- **Notifications:** Slack Web API (`@slack/web-api`) · Block Kit
- **Testing:** Vitest · Supertest (unit · integration · system)

---

## Project Structure

```
metermate/
├── server/                  # Express + TypeScript backend
│   └── src/
│       ├── index.ts         # Bootstrap, route mounting
│       ├── config.ts        # Typed env loader
│       ├── auth.ts          # Admin guard middleware
│       ├── stores/          # In-memory session + transaction stores
│       ├── routes/          # One route file per use case
│       ├── services/
│       │   ├── maxioService.ts   # All billing operations
│       │   └── slackService.ts   # Channel creation, invites, messages
│       └── schemas/         # Zod validation schemas
│
├── web/                     # React SPA (Vite)
│   └── src/
│       ├── components/
│       │   ├── client/      # UC1–UC4 forms
│       │   └── admin/       # UC5–UC6 forms + activity panel
│       ├── api.ts           # Typed fetch wrappers
│       └── session.ts       # Client-side sessionId handling
│
└── docs/                    # Setup guides, architecture, API reference
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```env
# Maxio Advanced Billing
MAXIO_API_KEY=
MAXIO_SITE_SUBDOMAIN=your-test-site
MAXIO_ENVIRONMENT=US

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_DIGEST_CHANNEL=C0XXXXXXX

# Admin (placeholder)
ADMIN_USER=admin
ADMIN_PASSWORD=changeme

# App
PORT=4000
SESSION_TTL_MINUTES=30
DEMO_MODE=true
```

---

## Getting Started

```bash
# Install all dependencies (root + server + web)
npm install

# Start both servers in development
npm run dev
# API →  http://localhost:4000
# UI  →  http://localhost:5173

# Seed Maxio test site with products and demo consultants
npm run seed

# Run all tests
npm test
```

---

## Required Slack App Scopes

| Scope | Purpose |
|---|---|
| `chat:write` | Post messages to transaction channels |
| `groups:write` | Create private channels and invite members |
| `groups:read` | Look up existing channels for reuse |
| `users:read.email` | Resolve a party's email to their Slack user ID |

---

## Implementation Phases

| Phase | Branch | Covers |
|---|---|---|
| 0 (scaffold) | `feat/uc1-book-subscribe` | Workspaces, Express, Vite, `/api/health` |
| 1 — UC1 | `feat/uc1-book-subscribe` | Maxio client, seed script, Book & Subscribe |
| 2 — UC2 | `feat/uc2-usage` | Report Session Usage |
| 3 — UC3 | `feat/uc3-plan-change` | Plan Change with proration preview |
| 4 — UC4 | `feat/uc4-lifecycle` | Pause / Resume / Cancel / Reactivate |
| 5 — UC5 | `feat/uc5-invoices` | Invoice Issue + Send (admin) |
| 6 — UC6 | `feat/uc6-digest` | Billing Activity Digest + cron |
| 7 — finish | `feat/uc7-tests-docs` | System tests, all docs |

---

## Key Design Decisions

- **In-memory state, DB-ready interfaces** — both stores expose `get/put/delete/sweep`; swapping to Redis or Postgres is a per-file change.
- **Billing is the source of truth** — Slack failures (channel creation, invites, messages) never roll back a billing operation or block the HTTP response.
- **Two-tier invite strategy** — if a client is a workspace member, they are invited directly; if not, the channel is created without them and they are notified by email via Maxio.
- **Admin is hardcoded credentials for now** — a clean seam exists for OAuth/JWT later; UC5 and UC6 routes are already guarded.
- **All testing is offline** — no live Maxio or Slack calls in CI; a separate live smoke script handles manual end-to-end verification against the test site.

---

## Documentation

Full documentation is in `docs/` and is written as part of the final phase:

- `SETUP.md` — Maxio + Slack credentials, scopes, seeding steps
- `ARCHITECTURE.md` — component diagram, data flow, state model
- `SLACK_CHANNELS.md` — transaction-channel mechanism and constraints
- `API.md` — REST endpoint reference
- `TESTING.md` — test layers and acceptance criteria map
- `USECASES.md` — UC1–UC6 end-to-end walkthroughs