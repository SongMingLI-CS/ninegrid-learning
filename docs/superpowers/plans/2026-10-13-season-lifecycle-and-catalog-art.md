# Season Lifecycle and Complete Catalog Art Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task. Each behavioral change starts with a failing test and ends with a targeted verification.

**Goal:** Make server-owned season selection/lifecycle reliable across tabs and reloads, verify the learning loop with isolated PostgreSQL/browser tests, and provide distinct mapped WebP assets for every catalog item.

**Architecture:** PostgreSQL transactions own season status, current-season pointer, and selection revision. Client requests use per-account/per-season epochs and server revisions so stale responses cannot replace newer state. Catalog artwork is keyed by stable catalog IDs, generated as independent images only for missing IDs, converted into detail/thumbnail WebP pairs, and validated by a manifest checker.

**Tech Stack:** React, Express, TypeScript, PostgreSQL, Vitest, Playwright, built-in ImageGen, WebP conversion tooling already available in the workspace.

**Spec:** User request in the active Codex task (season lifecycle, account isolation, browser acceptance, 155-item art catalog).

## Global Constraints

- Work only on `codex/learning-loop-fixes`; do not merge `main` or alter production service configuration.
- Keep the existing untracked `output/playwright` screenshots; never stage them unless they are newly created acceptance evidence requested for delivery.
- Use isolated PostgreSQL/browser test accounts for lifecycle verification.
- A paused or archived season cannot accept evidence writes, assessments, reviews, or settlement; archive is permanently read-only.
- Every catalog item uses its stable ID and its own original generated artwork; never reuse a rarity sheet as a finished item image.
- Real-model validation must be reported separately from local/mock validation.

---

### Task 1: Characterize lifecycle migration and transaction behavior

**Files:**
- Test: `scripts/verify-postgres.ts`
- Modify: `server/archive.ts`
- Modify: `server/migrations/008_season_lifecycle.sql`

**Interfaces:**
- Existing HTTP contracts: `GET /api/seasons/current`, `PUT /api/seasons/current`, `PATCH /api/seasons/:id/lifecycle`.
- Preserve response `selectionRevision` and each season's `revision` as separate concurrency tokens.

- [ ] Add isolated PostgreSQL checks that apply migration 008 twice, create two owner-isolated seasons, select/activate/pause/archive them, and assert the pointer and both revisions after every transition.
- [ ] Run `npm run test:postgres`; confirm failures specifically expose missing transition/revision/transaction guarantees.
- [ ] Implement one transaction boundary for season creation plus current-selection update, and for current-season archive plus active fallback selection.
- [ ] Define fallback as the most recently updated eligible active season; if none exists, set pointer null and return selection revision so the client can create/select a new active season.
- [ ] Reject stale season revision and stale selection revision with HTTP 409 without partial writes.
- [ ] Rerun the PostgreSQL script, including an injected rollback case and cross-user season IDs.

### Task 2: Enforce lifecycle write policy on all season-owned routes

**Files:**
- Test: `scripts/verify-postgres.ts`
- Modify: `server/archive.ts`
- Modify: `server/app.ts`

**Interfaces:**
- All mutation routes must resolve `(owner_user_id, season_id)` from the session and lock the season row before changing state.
- Keep the established 409 error style; return a stable `SEASON_PAUSED` or `SEASON_ARCHIVED` error.

- [ ] Add real-database cases proving paused and archived seasons reject archive writes, settlement, review settlement, evaluation persistence, and challenge start while GET remains owner-scoped.
- [ ] Run the focused PostgreSQL integration before production edits and record expected failing assertions.
- [ ] Add a shared lifecycle guard inside the same transaction/row lock as each mutation; never trust only the UI disabled state.
- [ ] Ensure AI evaluation cannot persist a result against a paused/archived season and rewards remain unchanged on rejection.
- [ ] Verify active/resumed season writes succeed, archived seasons cannot be reactivated, and repeated settlement remains idempotent.

### Task 3: Prevent stale browser selection and preserve route/task state

**Files:**
- Test: `tests/app-flow.test.tsx`
- Test: new `tests/season-lifecycle.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/ProfileScreen.tsx`

**Interfaces:**
- Centralize season activation through one async function carrying both `season.revision` and `selectionRevision`.
- Route parsing must accept `/`, `/profile`, `/inventory`, `/shop`, and `/challenges`; `popstate` updates tab state.

- [ ] Add a deferred-response test where selection A starts, B starts, B resolves first, then A resolves; only B may remain selected.
- [ ] Add tests for direct `/profile`, browser back/forward, last-task continuation, and two seasons retaining separate answers, lessons, evaluations, reviews, and drafts after reload.
- [ ] Run the new focused UI tests and confirm they fail on stale response or route restoration.
- [ ] Add a monotonically increasing selection request epoch and check user ID, season ID, and epoch before applying each response; aborting remains an optimization only.
- [ ] Make create/select/lifecycle responses refresh the authoritative selection revision before allowing another switch; show conflict and retry/reload actions on 409.
- [ ] Verify the UI handles a null current pointer, creates a season, and selects it without selecting a paused season by default.

### Task 4: Make profile lifecycle and showcase updates concurrency-safe

**Files:**
- Test: `tests/api.test.ts`
- Test: `tests/warehouse-screen.test.tsx`
- Modify: `server/archive.ts`
- Modify: `src/components/ProfileScreen.tsx`

**Interfaces:**
- `/api/profile` supplies server-derived progress, verification counts, current pointer, and at most four owned showcase items ordered by `showcase_order`.
- Lifecycle mutations must submit the profile season's actual `revision` and current `selectionRevision` when they can change the active pointer.

- [ ] Test that incorrect/missing season and selection revisions return 409 and never mutate the pointer or showcase.
- [ ] Test showcase replacement, stable ordering, maximum four, and rejection of unowned item IDs using real SQL/route integration.
- [ ] Correct profile season revision types and have refresh return the authoritative revision after transitions.
- [ ] Make showcase updates replace the four ordered slots transactionally rather than partially upserting only the submitted rows.
- [ ] Verify stats are derived from persisted season JSON and server reward rows, with no browser-computed totals trusted by the API.

### Task 5: Exercise the complete authenticated flow in an isolated browser

**Files:**
- Test: browser acceptance script under `scripts/` or existing Playwright test location
- Evidence: `output/playwright/season-lifecycle-*.png`

**Interfaces:**
- Browser base URL points only to an isolated local test server backed by the dedicated PostgreSQL test database.
- Two generated test users and two generated seasons are disposable test fixtures; never reuse production credentials/data.

- [ ] Launch the app against isolated PostgreSQL and create two isolated accounts/seasons through the UI/API.
- [ ] Enter answer A, wait for confirmed server save, switch to B, save answer B, switch back, reload, and continue the saved last task.
- [ ] Verify saving failure retains draft and displays unsynced status; retry succeeds without replacing the newer server revision.
- [ ] Verify rapid switching, pause/resume/archive/fallback, conflict recovery, profile showcase replacement/order, and user A cannot read or mutate user B data.
- [ ] Capture 390px, 1366px, and 1920px evidence screenshots for the working route and profile state; inspect the images before reporting.

### Task 6: Inventory and map the 155-item catalog to independent artwork

**Files:**
- Modify: `shared/catalog.ts`
- Create: `scripts/verify-catalog-art.mjs`
- Modify: `scripts/import-generated-collection-art.mjs`
- Add: `public/assets/catalog/items/<stable-id>.webp`
- Add: `public/assets/catalog/thumbs/<stable-id>.webp`

**Interfaces:**
- Each catalog `imageKey` resolves to a unique detail file and thumbnail file; generated IDs are explicit, not inferred from rarity.
- Stable item definitions remain unchanged except for their unique `imageKey` mapping.

- [ ] Enumerate all 155 stable IDs, current generic mappings, and generated detail/thumb files; classify the 30 existing unique IDs and list the exact 125 missing IDs.
- [ ] Add a verifier that fails on missing detail/thumb, duplicate mappings, unexpected extra asset, invalid WebP, dimension/size limit, or unstable ID mismatch; run it against current files to capture expected missing-item failures.
- [ ] For every missing catalog ID, issue one independent ImageGen call using that item's object/category-specific prompt and the approved shared studio-photo constraints; do not create contact sheets or color variants.
- [ ] Inspect generated outputs, copy only accepted source files temporarily outside tracked assets, and create a unique detail WebP and smaller thumbnail WebP for each ID.
- [ ] Change the catalog image resolver and warehouse/profile UI to use the item's unique image key and lazy-load thumbnail/detail appropriately.
- [ ] Run the verifier across all 155 IDs and report image count, aggregate bytes, largest files, and any rejected/missing IDs.

### Task 7: Final verification and current-branch delivery

**Files:**
- Tests/build/docs touched in Tasks 1–6.

**Interfaces:**
- No `main` merge; push only `codex/learning-loop-fixes`.

- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:postgres` against final code.
- [ ] Confirm the isolated browser acceptance tests and screenshots are current and AI calls are labeled mock unless real credentials were safely configured and actually exercised.
- [ ] Run `git diff --check`, inspect staged files, preserve unrelated untracked screenshots and all production data.
- [ ] Commit and push the current branch; compare `git rev-parse HEAD` with `git ls-remote origin refs/heads/codex/learning-loop-fixes`.
- [ ] Report lifecycle fixes, database/browser evidence, generated image count, total asset size, and remaining blockers without claiming incomplete assets are done.
