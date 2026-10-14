# Challenge Evidence and Long Course Validation

## Goal

Keep independent challenges task-aligned, prevent answer disclosure from being mistaken for independent mastery, bind evaluations to the lesson version and assistance used, validate 28 days at 60 minutes/day with the real provider, and complete all browser actions allowed by the computer-use rules. Finish with database, build, branch, and read-only server-resource evidence.

## Work map

- `shared/types.ts`, `shared/schema.ts`: separate learner-visible rubric, answer key, and challenge attempt metadata.
- `server/app.ts`: derive the independent task from its campaign task; reveal reference material explicitly; bind evaluation to the challenge version/evidence; reject stale or assisted evidence for independent mastery.
- `src/components/LessonWorkspace.tsx`, `src/App.tsx`: show rubric before attempting, reveal answer only on request, save hint/reveal state, and request a fresh transfer item where disclosure prevents an independent claim.
- `src/lib/engine.ts`: preserve evidence and attempts by lesson revision and prevent an old assessment from being reused after lesson regeneration.
- `tests/api.test.ts`, `tests/app-flow.test.tsx`, `tests/engine.test.ts`, `tests/archive.test.ts`: add failing regressions before implementation.
- `docs/superpowers/acceptance/2026-10-14-learning-loop.md`: record model, database, browser, and remote-resource evidence separately.

## Sequence

1. Reproduce the IELTS answer leak and task/challenge mismatch from the current API and workspace data flow.
2. Add failing tests for pre-answer visibility, explicit reveal tracking, staged hints, copied-answer non-mastery, challenge/task alignment, versioned evidence, and invalidation after regeneration.
3. Implement split challenge fields, an explicit reveal action, task-linked independent acceptance, server-side evaluation metadata, and a transfer challenge after answer exposure.
4. Run focused tests, typecheck, full test suite, build, and fresh isolated PostgreSQL regression.
5. Use a bounded real DeepSeek budget for NumPy, IELTS, and a 28-day/60-minute campaign. Inspect generation calls, timings, budget, dependencies, material use, finalization, activation, recovery, and samples across phases.
6. Resume the isolated browser at the purchase review, leave policy-prohibited transaction confirmation to the user, and verify only allowed read-only state. Do not claim that the transaction loop completed.
7. Recheck the Ubuntu host read-only, assess image/build-cache candidates and app/database peak footprint, and avoid touching existing services or data.
8. Write the evidence report, review the diff, commit, push the current branch, and confirm it matches the upstream.

## Limits

- No `main` merge and no formal-service changes.
- No production database, real-user balance, or arbitrary recharge path.
- At most 55 real DeepSeek requests across retries: 37 for the 28-day course plus six IELTS outline/detail/lesson/answer checks, twelve phase samples included in the 37, six requests already consumed (four malformed outputs, one valid outline, one truncated outline), and six requests reserved for recovery. No secret in repository, browser storage, generated report, or logs.
- Browser policy handoff applies to the final buy/sell and prize-based open actions even when the account uses only virtual test coins.
- Remote queries are read-only; no image/cache pruning or service stop.
