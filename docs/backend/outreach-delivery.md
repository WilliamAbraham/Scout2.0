# Outreach delivery interface (Cursor → Claude)

Cursor owns sender, outbox, and turns. Claude owns `outreach/worker.ts`, `pipeline/postgresStore.ts`, inbox routing, and worker startup. This is the contract Claude should call rather than adding a second send queue.

## Sender

- `OutreachPorts['sendMail']` is the only send entry point.
- Live mode: `createLiveSendMail` / `createAuthorizedLiveSendMail` in `backend/src/outreach/delivery.ts`.
- Dry-run mode: `createOutreachPorts({mode: 'dry-run'})` composes and returns `{messageId: 'dry-run'}` with **zero** Gmail API calls.
- Live mode without a real sender throws. Silent stub IDs are gone.
- Every live Gmail send is redirected to `williamja100@gmail.com` unless `OUTREACH_ALLOW_REAL_RECIPIENTS=1` (not used in this milestone). Intended broker addresses stay on the outbox row and the turn action.

## Outbox

Table `outreach_outbox` (migration `0004_black_falcon.sql`). RLS enabled, **no policies** — worker-only, same as `processed_messages`.

Action identity: `(user_id, pursuit_id, action_key)`

| `action_key` | Meaning |
|---|---|
| `open` | First opening email |
| `follow_up:N` | Nth follow-up |
| `reply:<inboundId>` | Reply to that inbound message |

States: `intended` → `claimed` → `sent` | `failed` | `uncertain` | `cancelled`.

`PostgresOutbox` methods Claude should call:

- `intend` / `claim` / `markSent` / `markFailed` / `markUncertain` — already used inside `dispatchOutboxSend`.
- `get` — inspect a row after a crash.
- `cancelFollowUps(userId, pursuitId)` — call when a broker reply is persisted or a pursuit closes.

Uncertain means Gmail may have accepted the message (timeout / connection drop). **Do not retry.** Reconcile by searching the mailbox or leave the row visible.

## Persistence

`runTurn` still invokes `sendMail` before `persistTurn`. The outbox records the intended action first, so a crash after Gmail accepts cannot send a second opening email.

`persistTurn` should:

1. Keep writing `draft_composed` in dry-run and `email_sent` after a real send.
2. Advance the pursuit only when the outbox row is `sent` (or dry-run draft).
3. Not invent another delivery table.
4. Pass `mailboxEmail` and the full persisted thread into `loadTurnInput` so self-sent mail is ignored and replies keep context.

## Authorization

Existing `token.json` is read-only. Sending needs a deliberate re-consent:

```bash
npm run outreach:reconsent
npm run outreach:send-test
npm run worker -- --once --live
```

`--live` fails until `gmail.send` is granted. This does **not** authorize emailing real brokers.

## Budget

Pass Codex's shared spend API as `createOutreachPorts({reserveModelSpend})`. Cursor does not keep a second budget counter. If the port is omitted, drafting proceeds.

## Not wired here

Calendar booking and document release stay disabled. `book_tour` / `send_packet` escalate instead of claiming success.
