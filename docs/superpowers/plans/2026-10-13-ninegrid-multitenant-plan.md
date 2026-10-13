# 九格行动多用户学习赛季实施计划

> **For agentic workers:** Execute each task in this session with test-first checkpoints. Keep the branch runnable after every task.

**Goal:** Extend the current learning campaign into a secure multi-user, PostgreSQL-backed tactical learning app with verified resources and a complete learning/reward loop.

**Architecture:** Keep the existing React/Express application and shared Zod contracts. Add repository/service boundaries for PostgreSQL, server-side sessions, YouTube metadata retrieval, DeepSeek text/vision requests, and private attachment storage. Preserve local/demo mode for tests; production startup fails closed when required secrets or database configuration are absent.

**Tech Stack:** React 19, TypeScript, Express 5, Zod 4, Vitest, PostgreSQL (`pg`), Argon2id, server-side sessions, YouTube Data API v3, DeepSeek Chat Completions multimodal content blocks, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-13-ninegrid-multitenant-design.md`

## Global Constraints

- Preserve existing learning progress, task rewards, idempotency, multi-season isolation, and local archive migration.
- Server is authoritative for authenticated production data and virtual reward balances.
- Never persist provider keys in browser storage, exports, or logs.
- Never invent verified videos, timestamps, image analysis, or successful external API calls.
- All cross-user data routes enforce ownership; attachments are private and out of static roots.
- Mainline gates progression; optional branches never silently block it.
- Verify tests/build/UI before committing or pushing; push only `codex/learning-loop-fixes`, never merge `main`.

---

### Task 1: Learning/review correctness

**Files:** `src/App.tsx`, `src/lib/engine.ts`, `src/shared` or `shared/schema.ts`, `src/components/TodaySchedule.tsx`, existing tests.

**Interfaces:** pass explicit review task ID to one submit path; bind AI evaluation to evidence fingerprint; persist diagnostic record; expose a real objective update callback.

- [ ] Add regression tests for opening the second due review item and verifying only its history changes; evidence mutation invalidates AI verification while original self-evidence remains; objective toggle updates state; diagnosis pass/fail persists and cannot issue AI/high-tier reward; switching target/task clears transient state.
- [ ] Run focused Vitest and confirm failures reproduce each issue.
- [ ] Implement minimal shared reducers/guards and explicit selected task routing.
- [ ] Run focused tests, then full suite.

### Task 2: PostgreSQL ownership, accounts, and migration

**Files:** `server/auth.ts`, `server/db.ts`, `server/repositories/*`, `server/migrations/*.sql`, `server/app.ts`, `server/index.ts`, `shared/schema.ts`, `tests/auth.test.ts`, `tests/ownership.test.ts`, `tests/migration.test.ts`, `.env.example`.

**Interfaces:** `createApp({ pool, sessionStore, fetchImpl, ... })`; authenticated `/api/auth/{register,login,logout,me}`; versioned season CRUD; explicit local archive preview/import endpoint; wallet/reward records returned separately from client season JSON.

- [ ] Test password/session lifecycle, owner scoping, stale revision conflict, migration idempotency/summary, and reward ledger uniqueness using an injected test database or isolated Postgres fixture.
- [ ] Add SQL migrations with FK constraints and unique reward idempotency key.
- [ ] Implement Argon2id auth, server sessions, CSRF, rate limits, parameterized repository SQL and owner filters.
- [ ] Keep client legacy archive until server confirmation matches digest; resolve concurrent writes with 409.
- [ ] Run migrations against isolated PostgreSQL and test restart persistence.

### Task 3: Verified YouTube resources and deterministic diagrams

**Files:** `server/resources/youtube.ts`, `server/routes/resources.ts`, `shared/schema.ts`, `src/components/ResourceCard.tsx`, `src/components/TeachingDiagram.tsx`, tests.

**Interfaces:** `searchTaskResources(task, profile, budget, fetchImpl)` returns `verifiedMetadata` only after search + videos.list validation, otherwise `searchFallback` with a real YouTube search URL and transparent status.

- [ ] Test API disabled/error fallback, unavailable candidate rejection, canonical video URL validation, metadata verification timestamp, budget filtering and cached repeat search.
- [ ] Implement server-only key use, compact cache and a maximum of three matched results; use model only to rank/explain actual candidates.
- [ ] Render external links with safe rel attributes, no autoplay, duration and explicit verification boundary.
- [ ] Add accessible SVG diagrams generated from exact NumPy/array data.
- [ ] Run resource and component tests.

### Task 4: Private uploads and actual multimodal analysis

**Files:** `server/routes/attachments.ts`, `server/vision.ts`, `server/storage/privateFiles.ts`, migrations, `src/components/ImageEvidence.tsx`, tests.

**Interfaces:** authenticated attachment upload returns opaque attachment metadata, never data URL; authorized attachment retrieval checks owner+season. `analyzeImage` sends a verified image data URL block to configured DeepSeek vision model and returns recognized text plus uncertainty markers.

- [ ] Test size/MIME/magic/dimension rejection, private disk persistence, cross-owner 404, actual outbound `image_url` block, failed vision preserving text evidence, stale request not writing to switched season.
- [ ] Implement bounded in-memory upload, image decode/re-encode, random private filename, Postgres ownership record, and image content block request.
- [ ] Show OCR/recognition confirmation before task analysis; include image as evidence but require textual/operational proof for mastery.
- [ ] Run attachment and multimodal tests; mark real API unverified unless live credentials are available.

### Task 5: Campaign layout, schedule and inventory

**Files:** `src/App.tsx`, `src/styles.css`, `src/components/*`, `src/lib/engine.ts`, `shared/schema.ts`, flow tests.

**Interfaces:** explicit stage/branch/task chain view, lock explanations, next-task selector; itemized schedule with due review and verified video duration; settlement reads persisted ledger and wallet.

- [ ] Add flow tests for main/branch unlocks, review entry, task resources, image confirmation, reward settlement/history, season switching.
- [ ] Implement the reference's left phase rail + central quest list + right detail/reward composition with responsive stacked mobile layout and readable 16px work area.
- [ ] Build user-level wallet/inventory UI with source season/task, rarity and history filters; keep nine-grid capability records separate.
- [ ] Verify 1366×768, 1920×1080, and mobile using browser screenshots; inspect for layout overflow and clickable control behavior.

### Task 6: Ubuntu deployment and delivery

**Files:** `Dockerfile`, `compose.yml`, `.dockerignore`, `scripts/backup-db.sh`, `scripts/restore-db.sh` or documented safe command, `README.md`, `.env.example`, CI workflow.

- [ ] Test Compose config when Docker Compose is available; production config requires Postgres, server-side keys, trusted proxy and secure cookies.
- [ ] Run migrations, full tests, typecheck, build, git diff check; exercise app with mock providers and isolated Postgres.
- [ ] Generate and inspect final screenshots and deployment instructions; explicitly list live-provider checks not performed.
- [ ] Commit the verified work, push only `codex/learning-loop-fixes`, and compare remote SHA to local HEAD.
