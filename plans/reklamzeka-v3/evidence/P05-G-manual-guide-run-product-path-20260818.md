# P05-G — Manual Guide run product path (2026-08-18)

## Outcome

An owner/admin can start an idempotent analysis run for the exact current active Guide revision from the canonical Guide lifecycle panel. The browser supplies only `guideId`, `revisionId`, and a bounded command reference. Workspace identity, request identity, clock, lease token, lease expiry, frozen scope, current data health, agents, action staging, limited-autonomy admission, and P01 projection are server-owned.

The path remains default-off unless all of `META_READ_ENABLED=true`, `GUIDE_SCHEDULER_ENABLED=true`, and `REKLAMZEKA_GUIDE_RUN_CODEX_ENABLED=true` are present with a valid local Codex adapter. It exposes no approval, execution, raw Meta, or Meta-write capability.

## Boundaries

- Cookie-only local session with dedicated `guide_run:manual` scope.
- Owner/admin workspace authorization; analyst/viewer fail closed.
- Same-origin POST with exact `guide-run-manual` intent; bearer, workspace override, cross-origin, extra keys, and oversized bodies reject before worker access.
- Active workspace + non-tombstoned Guide + exact current active revision are re-read server-side.
- Manual idempotency is derived from tenant, Guide, revision, and command reference; schedule cursor is untouched.
- Completed replay only reconciles the immutable P01 projection; it does not call agents again.
- Current data health is derived from the persisted run/frozen scope and canonical Meta mirror inside one repeatable-read/read-only transaction.
- Human candidates use the canonical action binding; limited-autonomy candidates use the canonical quota admission. Neither route executes Meta.

## Verification

- Focused manual/worker/health/UI/session/security suite: 6 files / 29 tests passed.
- Full repository gate: 559 files / 2706 tests passed.
- `npm run build`: passed; `/api/guide-runs/manual` is in the production route manifest.
- `npm run db:check`: passed.
- `npm run check:security-boundaries`: passed (10 tests).
- `git diff --check`: passed.

## Explicitly open

- Authenticated browser acceptance requires the user's action-time local-session capability confirmation.
- A live local-Codex run remains gated and was not launched in this tranche.
- Meta write and all P06 execution workers remain outside this path and default-off.
