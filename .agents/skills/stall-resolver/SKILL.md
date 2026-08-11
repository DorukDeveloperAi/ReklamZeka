---
name: stall-resolver
description: Resolve an execution stall when an agent has a concrete error, failed gate, migration issue, test failure, or unavailable verification result. Use before declaring a task blocked; diagnose, apply safe in-scope repairs, verify, and escalate only for genuine authority or irreversible-state boundaries.
---

# Stall Resolver

Use this skill when progress is stalled by a concrete failure. The caller may simply say: **"Bunu çöz; çözümü söyleme."**

## Operating contract

1. Capture the first authoritative failure: command exit code, error text, query plan, test trace, or reproducible UI state.
2. Classify it:
   - safe local/code/test/config repair;
   - pending forward migration repair;
   - external-state/permission/irreversible boundary.
3. For the first two, make the narrowest in-scope repair immediately. Do not replace action with a status report.
4. If the same class appears twice, inspect the complete adjacent surface and fix the class systematically (for example, scan all pending migrations for the same FK prerequisite ordering), then add a regression gate.
5. Re-run the exact failing command, then proportionate targeted checks. Report evidence, not intent.
6. Escalate only when completion requires an explicit user choice, an applied-history rewrite, destructive recovery, production action, secret, external coordination, or three repeated attempts with no safe next action.

## Non-negotiable safety

- Never edit applied migration history or fabricate migration ledger rows.
- Prefer normal forward migrations and existing cleanup/tombstone services.
- Never weaken RLS, authorization, invalidation, or fail-closed behavior merely to turn a check green.
- Do not invent fixture data that bypasses lifecycle/materializer contracts.

## Output

Keep status short: `cause → repair → proof → remaining boundary`.
Do not say "blocked" while a safe diagnostic or repair exists.
