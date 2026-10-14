# Responsive and acceptance results — 2026-10-14

## Browser and display evidence

- Browser: Codex in-app Chromium, browser zoom 100%, `visualViewport.scale = 1`.
- CSS viewport overrides tested at 390, 768, 1024, 1366, 1920, 2560 and 3840 px. Height used 844 px for 390, 900 px for 768/1024, and 16:9 from 1366 upward (the 1366 case was 1366×768).
- `devicePixelRatio` reported `1.00000003` at all tested widths. The tool only exposed a viewport override; it did not change Windows display scaling or device pixel ratio. Thus 3840×2160 is a simulated CSS viewport, not evidence from a physical 4K monitor.
- For a 3840×2160 physical display, the matching CSS viewport widths are approximately 3840 at 100%, 2560 at 150%, and 1920 at 200% OS scale. Those CSS widths were measured independently. No claim is made that the browser emulated the corresponding Windows scale setting.
- The before and after page screenshots were captured in the browser during this run and are shown inline in the Codex conversation. The browser screenshot interface returned display images rather than file paths, so there are no fabricated local screenshot files. `catalog-rarity-sample.png` is the saved five-tier artwork contact sheet.

## Measured layout causes and changes

| Area | Before at 3840 CSS px | After at 3840 CSS px |
|---|---|---|
| Learning hall | `.page-wrap` capped at 1550 px, leaving very large side gutters; 13 px root type and small mission metadata | centered 2800 px content bound, 15 px root type, four flexible mission columns; no horizontal overflow |
| Today schedule | schedule content capped at 1120 px | schedule bounded at 1600 px; readable body size and retained whitespace |
| Task workspace | lesson card capped at 1120 px | lesson remains bounded at 1440 px, 17 px body text; code block keeps horizontal overflow inside its own region |
| Review | nested review layout was limited by the 1550 px parent | review reading area bounded at 1800 px |
| Warehouse | six fixed columns, 10 px names, 103 px artwork strip, 310 px detail rail; cards and details had poor balance | warehouse shell capped at 2880 px; 8 columns at 3840 with cards about 256 px, artwork 190 px, 440 px detail rail and 14 px names; thumbnails for grid and full-size images for details |
| Shop | full-width shell yielded two product cards about 1797 px each | 2880 px shell, product region capped at 2280 px, cards about 1124 px; modal widened and typography enlarged |
| Challenges | 1080 px entry area aligned left at 3840, leaving excessive unused area | centered entry area capped at 1780 px, three readable tiers |
| Profile | shell, season cards and archive stretched almost full width; season cards stacked at 3594 px each | shell capped at 2880 px, archive uses two columns with cards about 1336 px; metrics regrouped into three columns |

Across the five main-app views (today, course overview, workspace, archive, review), plus profile, warehouse, shop and challenges, tested widths 390/768/1024/1366/1920/2560/3840 had no positive horizontal document overflow. Negative 15 px values indicate the browser's vertical scrollbar gutter, not clipped content. At 768 px, warehouse cards were initially 137 px wide in a five-column grid; the tablet-specific grid now uses a 158 px minimum, yielding four columns. Workspace prose is capped at 78 characters while its code block may use the wider card and scroll on its own.

## Browser interactions

- Navigated through Today, Course Overview, Workspace, Review, Warehouse, Shop, Challenges and Profile. The task row for “校准仪表：读懂 shape 与 axis” was clicked and the workspace showed its lesson and code block.
- Switched from NumPy to “情报归档行动”, confirmed the current-season banner and task outline changed, then switched back to NumPy.
- Opened the warehouse, switched to the full catalog, selected “小红” in the rarity filter and observed 35 matching items. Opened a held-item detail and verified it requests the full-size `/assets/catalog/items/...webp` image.
- At 390×844, opened the mobile menu, observed its nine links wrap into three rows with 42 px heights and no horizontal overflow, then used “今日节目表” to navigate from the menu.
- Shop and challenge test account had zero balance. Purchase/join controls were disabled, so no purchase confirmation dialog could be opened without changing fixture funds or transacting. No transaction was attempted. The database suite separately exercises transaction and idempotency behavior.
- Empty states observed in review and profile/challenge history. A deliberate network/API failure state was not injected into the browser.
- No real physical 4K device was available. Screenshot evidence is browser viewport capture only, with CSS width, DPR and browser zoom recorded above.

## Local verification

- `npm run typecheck`: passed.
- `npm run build`: passed (Vite emitted existing dependency annotation notices from Zod; output completed).
- `npm test -- --run`: 17 files, 174 tests passed.
- `npm run test:postgres`: passed against a fresh isolated native PostgreSQL instance. The runner reported repeatable migrations, season selection/revisions and stale-conflict/recovery behavior, account isolation, draft recovery and limits, reward/claim deduplication, purchase/open/sale/settlement idempotency, concurrent inventory and balances, collectible restrictions, PostgreSQL restart persistence, and isolated `pg_dump`/`pg_restore` with attachment hash/count checks. The external AI evaluator in this suite is explicitly mocked; this is not real DeepSeek acceptance.

## Artwork audit

- Visually inspected one generated item from each rarity tier in `catalog-rarity-sample.png`. The silhouettes and materials were distinct across five tiers, image mappings matched their tier keys, and the five samples were sharp at the contact-sheet display size.
- Verified the catalog has 155 full images and 155 thumbnails. Warehouse cards now load thumbnails; detail uses the full image. This reduced unnecessarily large artwork downloads in catalog grids and prevents a small thumbnail from being enlarged in a detail view.
- No duplicate-composition or mapping defect was found in the sampled tier set; changed artwork count: 0. Changed rendering paths: cards and details now choose the appropriate existing size.

## Conditional external checks

- No safe local `DEEPSEEK_API_KEY` configuration was present. Real NumPy and IELTS model generation/evaluation was not run. The exact missing configuration name is `DEEPSEEK_API_KEY`; set it only through the existing secret store or an untracked local environment setting, never in chat or Git.
- Ubuntu read-only check connected to `192.144.160.196`. Host reported 6.3 GB available disk, 1.5 GiB available memory, and 1.2 GiB swap in use. Ports 80, 8000, 8080, 8081 and 8787 already listen; 8787 belongs to `novel-agent-ser`. `/opt` contains several existing projects. No Nginx site names were available from `/etc/nginx/sites-enabled`, Docker returned no running names, and no independent NineGrid domain/test-site configuration was identified. No server files, services, databases, ports or volumes were changed.
- Need the existing non-secret test-site hostname/domain (or site configuration name) before an isolated HTTPS deployment can be planned. Production cookie, login, shared-account behavior and remote persistence/backup were not tested. Do not send credentials in chat.
