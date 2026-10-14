# Responsive Layout and Acceptance Plan

> **For agentic workers:** Execute this plan inline against the requested development branch. Keep changes isolated from `main` and all production services.

**Goal:** Improve the app across phone, tablet, desktop, and 4K CSS viewports, then freshly verify the latest database and all externally available acceptance paths.

**Architecture:** Measure browser CSS viewports and DPR independently from screenshot resolution and OS scaling. Keep the existing React/CSS architecture and dark tactical visual language, adjust shared layout tokens and page-specific responsive grids, then use isolated local Postgres/browser fixtures and inspect remote deployment configuration before any remote mutation.

**Tech Stack:** React 19, TypeScript, Vite, CSS, Vitest, embedded PostgreSQL 18, Playwright/browser automation, SSH.

**Spec:** User request dated 2026-10-14 in this conversation.

## Global Constraints

- Preserve existing course, economy, and asset rules.
- Do not merge `main`, replace production, use production databases for destructive tests, or prune unrelated server resources.
- Compare the CSS viewports corresponding to 3840×2160 at 100%, 150%, and 200% OS scale (3840, 2560, and 1920 CSS px). Record the actual browser DPR separately; never infer OS scaling from the viewport override.
- Do not expose or persist DeepSeek, database, or SSH credentials in source, logs, browser storage, or Git.
- Run fresh verification on current HEAD and push only the requested development branch.

---

### Task 1: Measure the existing responsive behavior

**Files:** `src/styles.css`, `src/App.tsx`, page component CSS/TSX, `scripts/browser-fixture.ts`, `output/playwright/`.

- [x] Map the requested screens and measure baseline container widths and type sizes.
- [x] Start an isolated authenticated browser fixture. Test CSS widths 390, 768, 1024, 1366, 1920, 2560, 3840 at DPR 1; the 3840×2160 physical display was not available.
- [x] Record browser zoom, viewport, DPR, overflow, container widths, type sizes and captured screenshots in `docs/superpowers/acceptance/responsive-and-acceptance-2026-10-14.md`.

### Task 2: Fix shared and page-specific wide-screen layouts

**Files:** `src/styles.css`, `src/components/WarehouseScreen.css`, `src/components/EconomyScreens.css`, `src/components/ProfileScreen.tsx`, `src/components/LessonWorkspace.tsx`, relevant screen CSS.

- [x] Use measured failures to choose shared container bounds, spacing, and type scales.
- [x] Keep lesson prose bounded and code scrolling within its block.
- [x] Expand warehouse card capacity while using thumbnails in grids and full-size artwork in details.
- [x] Improve schedule, reviews, seasons, shop/challenges, profile and dialog sizing at wide and tablet widths.
- [x] Retest the seven CSS widths and interact with navigation, season switching, task selection, warehouse filters and catalog details. The shop confirmation could not be opened because the isolated account had no balance and its purchase button was disabled; no purchase was made.

### Task 3: Fresh local verification

**Files:** `scripts/verify-postgres.ts`, browser fixture, relevant tests.

- [x] Run fresh PostgreSQL migration/idempotency, archive/season, economy, concurrency, collectible, persistence, and isolated backup/restore checks.
- [x] Run typecheck, production build, and the full local Vitest suite.
- [x] Audit catalog artwork across all five rarity tiers and fix the card/detail image-size mapping.

### Task 4: Conditional real-provider and Ubuntu acceptance

**Files:** existing safe configuration and isolated remote test site only.

- [x] Check safe local configuration. No `DEEPSEEK_API_KEY` was present; report real-provider flows as unverified.
- [x] Inspect Ubuntu read-only. Existing ports/services and projects occupy the host; no isolated NineGrid domain/test-site configuration was identified, so make no remote changes.
- [x] Record the missing non-secret test hostname/configuration needed before an independent HTTPS test deployment.

### Task 5: Commit and push

- [x] Review the full diff and verification evidence.
- [x] Commit all intended changes on `codex/learning-loop-fixes` and push that branch.
- [x] Verify the resulting SHA, upstream equality, and clean worktree.
