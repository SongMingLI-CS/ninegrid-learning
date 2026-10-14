# Real browser and provider follow-up — 2026-10-14

## Scope and isolation

- Started from `codex/learning-loop-fixes` at `150a309dccfe29a35e4984474cdf857999b7c125`; local branch and upstream matched before this follow-up.
- Browser fixture: `http://127.0.0.1:10606/`, isolated temporary PostgreSQL and test users. The fixture was seeded with 500,000 learning coins using a test-only environment setting; a real completed lesson then added 78,000. No production balance or database was touched.
- `DEEPSEEK_API_KEY` was read only in the fixture process. It was not written to the repository, browser storage, response captures, or logs. The fixture has a 14-call cap; 12 calls were used here (16 including four earlier diagnosis calls).
- The test fixture uses HTTP and `secureCookie: false`; this does not verify production HTTPS cookies. Its current browser tab is left open at the small-cache purchase confirmation for user handoff. No purchase, opening, lock, or sale has yet been executed in the browser.

## Browser and real DeepSeek results

- Generated and activated a NumPy season from the test goal and supplied NumPy excerpt. It had five dependent tasks totalling 60 minutes within a 3-day, 24-minute/day budget; its prerequisite level and final script matched the input.
- Opened the second NumPy task. DeepSeek produced a worked explanation, masks, runnable code, expected output, an `and`/`or` array error, and practice grounded in the supplied excerpt.
- Submitted one correct answer, one clearly incorrect answer, and one deliberately uncertain answer to the actual browser assessment flow. The first passed at 78 and issued +12 XP and +78,000 coins; the other two failed at 15. The incorrect response identified reversed conditions and invalid `and`; the uncertain response identified missing code, outputs, and unsupported guesses. Feedback differed appropriately by evidence, though both non-passing answers received the same numeric score.
- Generated and activated an IELTS reading season from a separate goal and original practice excerpt. It contained five prerequisite-linked tasks (10, 12, 12, 14, 12 minutes), targeted True/False/Not Given and paraphrase matching, and fit 60 minutes into the 72-minute total budget. The generated outline included useful prior-skill review and a concrete evidence-based final answer record.
- The first IELTS lesson response was truncated JSON despite HTTP 200 and was rejected by the app. The existing retry action recovered with a valid lesson. The recovered example, guided practice, and four answer explanations cited the exact supplied sentences; the result survived changing seasons and a page reload.
- The completed NumPy reward, task progress, both seasons, and the 578,000 balance survived a browser refresh. The fresh PostgreSQL suite separately verified settlement deduplication and idempotent wallet/ledger writes.
- Browser purchase review shows one small cache at 200,000 coins, probability distribution, and 378,000 projected balance. A visible confirmation dialog is ready, but its final purchase action requires the user to click it. Open-box, item lock, sale, failure/retry and post-transaction ledger checks remain pending that handoff.
- An earlier isolated browser fixture canceled a stage request and then resumed generation successfully. In this run, the UI exposed its persisted partial/complete draft states while generating the IELTS plan.

## Bugs fixed during real-provider use

- Stage prompts now constrain task kinds to the accepted four values and specify absolute `{title,url}` resources. This follows real generation failures and is covered by `tests/api.test.ts`.
- Lesson prompts now explicitly request the complete JSON shape. A first real lesson failure exposed that JSON mode alone was insufficient; the retry then succeeded and produced material-linked content.
- Adaptation prompts now explicitly say to return JSON with the four required fields. A real incorrect-answer follow-up received DeepSeek HTTP 400 because the old prompt omitted the word “json”; the route correction is covered by a prompt assertion. The running browser fixture loaded the pre-fix server module, so the changed adaptation prompt itself has only been verified by the API regression test, not by another live provider call.

## Verification

- `npm test -- --run`: 17 files, 174 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; Vite reported existing removable annotation notices in Zod dependencies.
- `npx vitest run tests/api.test.ts`: 33 tests passed after prompt changes.
- `npm run test:postgres`: fresh isolated native PostgreSQL run passed, including repeatable migrations, stale-season conflicts/recovery, account isolation, draft recovery and limits, reward deduplication, purchase/open/sale idempotency, concurrent inventory and balances, restricted collectibles, restart persistence, and an independent `pg_dump`/`pg_restore` plus attachment hash/count checks. The AI assessment inside this database suite is mocked.
- Captured browser screenshots are emitted by the in-app browser as images; this environment did not expose a supported local screenshot file path. Simulated 4K CSS viewport testing from the previous follow-up remains separate from physical Windows display-scaling validation.

## Ubuntu and disk findings

- The Ubuntu host was inspected read-only. `/` is 40 GB total, about 32 GB used and 6.3 GB available. Available memory was about 1.5 GiB, with about 1.2 GiB swap in use. Ports 80, 8000, 8080, 8081, and 8787 are already occupied; 8787 belongs to another project. No independent NineGrid HTTPS test site was configured, so no deployment, service restart, database, volume, or cleanup was performed.
- The largest identified disk consumer is containerd/Docker data from multiple existing projects: overlay snapshots about 20 GB and image blobs about 3.3 GB. Docker metadata reported 23.18 GB logical image size and 18.42 GB logical build-cache size (12.89 GB marked reclaimable); these figures overlap/shared-layer accounting and must not be added to estimate physical disk use. Another project's IELTS checkout/backups are about 896 MB, `/var/log` about 375 MB (system journal about 326 MB), apt cache about 212 MB, and `/tmp` about 368 MB. Nothing was removed.
- Remote production cookies/login, cross-device synchronization, and remote persistence/backup were not tested. A non-secret test hostname or proxy/site configuration is still required for isolated HTTPS testing.

## Branch result

- The pending changes contain prompt corrections and isolated browser-fixture controls only. They do not add shop or collection types.
- Commit and push this follow-up to `codex/learning-loop-fixes`; do not merge `main`.
