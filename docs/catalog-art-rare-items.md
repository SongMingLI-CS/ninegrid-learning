# Rare catalog art generation record

Scope: large-gold-07..15, small-red-07..35, large-red-07..25 (57 independent objects). Built-in image_gen only; one separate generation call per ID. Source PNGs remain outside repository. Existing first-six assets, source, mappings, UI and production server are outside this task.

## Exact shared prompt prefix

```text
Use case: product-mockup. Asset type: unique tactical salvage catalog photograph. Photorealistic real object, square image. Elevated three-quarter camera view, centered single complete object occupying about 75% of frame with comfortable margins on a seamless dark neutral charcoal background. Soft studio lighting and restrained contact shadow, realistic materials and subtle field wear. No logo, no readable text, no letters or numbers, no watermark, no border or frame, no collage, no other props.
```

Each exact prompt is the prefix above followed by `Catalog name: <name>. Subject: <subject>` using the name and subject below. transparent_background=false; no reference inputs or variants.

## Per-ID records

Resumed after second user interruption with 10/57 objects imported (large-gold-07..15 and small-red-08), 20 WebP outputs, 581,374 bytes. small-red-07 first attempt failed with `image generation failed: connection failed: error sending request`; no source or output was produced for that attempt. It will be retried on resume. small-red-08 finished during interruption and was inspected from its saved PNG. Per-ID status below is authoritative for subsequent progress.

### large-gold-07 — 高能密封电池

Subject: A sealed high-energy battery: broad armored graphite rectangular pack, recessed copper terminal pair, ceramic isolation collars, ribbed heat sinks and weathered rubber corner guards.

Status: imported; inspected: realistic battery, complete framing, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-fbc287a6-30ad-4ced-a806-e459a383bd4f.png`.

Outputs: `public/assets/catalog/items/large-gold-07.webp` (768×768), `public/assets/catalog/thumbs/large-gold-07.webp` (220×220) — imported.

### large-gold-08 — 精密惯性平台

Subject: A precision inertial platform: open nested three-axis brass and titanium gimbal rings supporting a dense gyroscope on a low hexagonal machined base, visible bearings and calibration adjusters.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-935844cc-b752-439d-baf1-21f3755af7a9.png`.

Outputs: `public/assets/catalog/items/large-gold-08.webp` (768×768), `public/assets/catalog/thumbs/large-gold-08.webp` (220×220) — imported.

### large-gold-09 — 军用卫星中继器

Subject: A military satellite relay: rugged olive drab rectangular field unit with a folded small parabolic dish integrated above it, silver waveguide and protected coaxial ports.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-19abf1dc-3e6f-4cc2-baed-0780ce30f476.png`.

Outputs: `public/assets/catalog/items/large-gold-09.webp` (768×768), `public/assets/catalog/thumbs/large-gold-09.webp` (220×220) — imported.

### large-gold-10 — 三维地质扫描仪

Subject: A 3D geological scanner: upright ochre rugged scanning instrument with a circular black optical scanner head, two chunky grips and folded support feet, mineral-dust wear.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-237d64b6-d1af-43a7-8c4b-18f467e9b6f2.png`.

Outputs: `public/assets/catalog/items/large-gold-10.webp` (768×768), `public/assets/catalog/thumbs/large-gold-10.webp` (220×220) — imported.

### large-gold-11 — 稀有同位素样本

Subject: A rare isotope sample: one squat cylindrical tungsten containment capsule with thick knurled lid, bronze locking ring and a small deep sapphire observation window; all contained and sealed.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-2fa4134c-253c-4614-a65d-3bc3b9b441af.png`.

Outputs: `public/assets/catalog/items/large-gold-11.webp` (768×768), `public/assets/catalog/thumbs/large-gold-11.webp` (220×220) — imported.

### large-gold-12 — 零点校准台

Subject: A zero-reference calibration stage: compact rectangular granite metrology slab mounted on three brass leveling feet, polished steel linear stage and a small ceramic gauge centered on the assembly.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-7b645a7c-595a-401d-ba37-190de076aea0.png`.

Outputs: `public/assets/catalog/items/large-gold-12.webp` (768×768), `public/assets/catalog/thumbs/large-gold-12.webp` (220×220) — imported.

### large-gold-13 — 钨铼合金转子

Subject: A tungsten-rhenium alloy rotor: heavy metallic radial turbine wheel with closely spaced swept blades and long tapered central spindle, realistic heat-tinted silver metal.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-ee7409b0-058a-4869-bb4d-2edce373e4e8.png`.

Outputs: `public/assets/catalog/items/large-gold-13.webp` (768×768), `public/assets/catalog/thumbs/large-gold-13.webp` (220×220) — imported.

### large-gold-14 — 低温超导电缆

Subject: A cryogenic superconducting cable: one thick silver braided cryogenic hose coiled into a compact oval, its integrated ceramic and stainless coupling ends visible, insulated corrugated sheath.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-9565250f-a6c5-45f7-ad0c-1042065f4e47.png`.

Outputs: `public/assets/catalog/items/large-gold-14.webp` (768×768), `public/assets/catalog/thumbs/large-gold-14.webp` (220×220) — imported.

### large-gold-15 — 多源情报存储柜

Subject: A multi-source intelligence storage cabinet: squat dark steel portable cabinet with three differently sized sealed media drawers, recessed brass latch and side carry handles, heavy practical hardware.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-cca4c49f-4f84-4b68-bd77-95ed1b2c2cc3.png`.

Outputs: `public/assets/catalog/items/large-gold-15.webp` (768×768), `public/assets/catalog/thumbs/large-gold-15.webp` (220×220) — imported.

### small-red-07 — 边境电台录音

Subject: A border radio recording: a compact aged wire-recorder spool in an open attached Bakelite clamshell housing, fine steel recording wire and central brass spindle visible.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-e162c5aa-4755-4603-bf68-6578b4831569.png`.

Outputs: `public/assets/catalog/items/small-red-07.webp` (768×768), `public/assets/catalog/thumbs/small-red-07.webp` (220×220) — imported.

### small-red-08 — 封存指挥令

Subject: A sealed command order: stiff ivory folded command paper inside a narrow oatmeal linen document sleeve, a plain dark oxblood wax seal crossing its flap, no writing.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-c31f7da6-b2f4-4db8-af43-49e8a71a9165.png`.

Outputs: `public/assets/catalog/items/small-red-08.webp` (768×768), `public/assets/catalog/thumbs/small-red-08.webp` (220×220) — imported.

### small-red-09 — 褪色识别章

Subject: A faded identification insignia: single oval embroidered field identification patch with a worn abstract chevron symbol, muted khaki and rust threads, fraying edge and faded cloth.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-e704082b-cd01-432a-942c-fffee555510a.png`.

Outputs: `public/assets/catalog/items/small-red-09.webp` (768×768), `public/assets/catalog/thumbs/small-red-09.webp` (220×220) — imported.

### small-red-10 — 未寄出的家书

Subject: An unsent letter home: one pale blue airmail envelope with folded corner and open tuck showing a single cream letter sheet, delicate red-blue edging, aged paper, blank surfaces.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-b17a71db-1ff4-402e-99a4-a7dfb6b88783.png`.

Outputs: `public/assets/catalog/items/small-red-10.webp` (768×768), `public/assets/catalog/thumbs/small-red-10.webp` (220×220) — imported.

### small-red-11 — 侦察员素描册

Subject: A scout sketchbook: small landscape olive canvas sketchbook opened partly to a graphite sketch of a rocky ridgeline, stitched binding and bent dog-eared thick ivory page, drawings only.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-1ef5e06f-fa4c-4e88-ac0c-6619031b86de.png`.

Outputs: `public/assets/catalog/items/small-red-11.webp` (768×768), `public/assets/catalog/thumbs/small-red-11.webp` (220×220) — imported.

### small-red-12 — 行动路线胶片

Subject: An operational route film: one translucent amber acetate strip curved into a loose arc with perforated edges and thin map-like route tracings without labels, single integrated film object.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-2428bb32-1236-46fc-baf9-3fa6ae75e95f.png`.

Outputs: `public/assets/catalog/items/small-red-12.webp` (768×768), `public/assets/catalog/thumbs/small-red-12.webp` (220×220) — imported.

### small-red-13 — 旧基地钥匙牌

Subject: An old base key tag: one elongated worn brass key fob with a rectangular blank enamel inset, attached split metal ring, dents and oxidized edges, no symbols.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-3e68a636-25b3-49f1-9f54-76f144f25a03.png`.

Outputs: `public/assets/catalog/items/small-red-13.webp` (768×768), `public/assets/catalog/thumbs/small-red-13.webp` (220×220) — imported.

### small-red-14 — 加密坐标卡

Subject: An encrypted coordinate card: one stiff matte black punched cipher card with a distinctive asymmetrical grid of perforations, nickel reinforcement on one corner and small tactile embossed dots, no text.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-7cf73f8f-b8a4-4376-a7ec-e6b60ad3028f.png`.

Outputs: `public/assets/catalog/items/small-red-14.webp` (768×768), `public/assets/catalog/thumbs/small-red-14.webp` (220×220) — imported.

### small-red-15 — 最后一班列车票

Subject: A last train ticket: one narrow ochre vintage cardboard rail ticket, clipped corner, punched circular cancellation holes and a faded abstract band across its blank face, no writing or numerals.

Status: imported; visually inspected: distinct recognizable object, realistic materials, complete framing, charcoal background, no readable text.

Source PNG: `C:\Users\Lenovo\.codex\generated_images\01a135d6-4bbe-7fa1-bb05-921a74802fa9\exec-ee31c33f-58a2-4787-b33e-befd422a04b3.png`.

Outputs: `public/assets/catalog/items/small-red-15.webp` (768×768), `public/assets/catalog/thumbs/small-red-15.webp` (220×220) — imported.

### small-red-16 — 无人机航迹带

Subject: A drone flight track tape: compact transparent polycarbonate data-tape cartridge with one integrated exposed loop of pale green plotting tape, line traces only, machined aluminium hub.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-16.webp` (768×768), `public/assets/catalog/thumbs/small-red-16.webp` (220×220) — pending.

### small-red-17 — 撤离清单原件

Subject: An original evacuation checklist: one worn thin aluminium clipboard holding curled cream sheets, rusted spring clip and visible rows of empty boxes with faint abstract nonletter strokes.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-17.webp` (768×768), `public/assets/catalog/thumbs/small-red-17.webp` (220×220) — pending.

### small-red-18 — 潮湿电文副本

Subject: A damp telegram copy: one irregular folded sheet of translucent onion-skin paper, water stains and tide marks, blue carbon-transfer smudges as indistinct lines without legible glyphs, no envelope.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-18.webp` (768×768), `public/assets/catalog/thumbs/small-red-18.webp` (220×220) — pending.

### small-red-19 — 手工绘制地形图

Subject: A hand-drawn terrain map: one irregular folded vellum map opened enough to show hand-drawn sepia contour lines, river bends and small mountain hatching, unlabelled, cloth reinforcement at creases.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-19.webp` (768×768), `public/assets/catalog/thumbs/small-red-19.webp` (220×220) — pending.

### small-red-20 — 封存语音芯片

Subject: A sealed voice chip: single small ceramic memory chip enclosed within a transparent smoked resin security capsule, copper pins and a plain red tamper loop integrated into the enclosure.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-20.webp` (768×768), `public/assets/catalog/thumbs/small-red-20.webp` (220×220) — pending.

### small-red-21 — 医疗站值班簿

Subject: A medical-station duty ledger: thick burgundy buckram ledger with rounded corners, stitched spine and fabric index tabs, slightly ajar cream ruled pages with no writing.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-21.webp` (768×768), `public/assets/catalog/thumbs/small-red-21.webp` (220×220) — pending.

### small-red-22 — 损坏的摄影机

Subject: A damaged camera: one battered compact black 16mm field movie camera, dented top housing, cracked rubber eyecup and scuffed chrome lens mount, recognizable mechanical camera silhouette.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-22.webp` (768×768), `public/assets/catalog/thumbs/small-red-22.webp` (220×220) — pending.

### small-red-23 — 空白身份卡

Subject: A blank identity card: one ivory laminated identification card with absolutely blank portrait recess and two blank inset areas, delaminating transparent edge, discreet blue edge stripe.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-23.webp` (768×768), `public/assets/catalog/thumbs/small-red-23.webp` (220×220) — pending.

### small-red-24 — 实验室门禁片

Subject: A laboratory access token: one translucent ice-green hexagonal resin access wafer with a copper RFID spiral embedded inside, small reinforced lanyard hole and worn frosted edges.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-24.webp` (768×768), `public/assets/catalog/thumbs/small-red-24.webp` (220×220) — pending.

### small-red-25 — 旧磁带录音

Subject: An old tape recording: a single smoke-gray compact audio cassette, two ivory reel hubs visible through narrow windows, chipped plastic corners and an entirely blank cream label panel.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-25.webp` (768×768), `public/assets/catalog/thumbs/small-red-25.webp` (220×220) — pending.

### small-red-26 — 行动纪念章

Subject: An operation commemorative medal: one aged bronze circular medal embossed with an abstract mountain and rising sun relief, short folded charcoal-and-ochre ribbon attached, no words.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-26.webp` (768×768), `public/assets/catalog/thumbs/small-red-26.webp` (220×220) — pending.

### small-red-27 — 遗失的罗盘盘面

Subject: A lost compass dial: single round detached ivory compass face inside a thin tarnished brass rim, black cardinal tick marks without letters or numbers, red needle and cracked glass.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-27.webp` (768×768), `public/assets/catalog/thumbs/small-red-27.webp` (220×220) — pending.

### small-red-28 — 抄录的频率表

Subject: A copied frequency table: one accordion-fold field reference card, cream paper with pale blue column lines and charcoal abstract dash marks instead of characters, a single steel paperclip attached.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-28.webp` (768×768), `public/assets/catalog/thumbs/small-red-28.webp` (220×220) — pending.

### small-red-29 — 现场粉笔拓片

Subject: A field chalk rubbing: one rolled-back charcoal-gray rag paper sheet showing a pale chalk impression of a rough geometric relief, powdery pigment and rough torn fiber edges, no writing.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-29.webp` (768×768), `public/assets/catalog/thumbs/small-red-29.webp` (220×220) — pending.

### small-red-30 — 纸质情报卷宗

Subject: A paper intelligence dossier: one thick kraft gusset folder packed with uneven ivory sheets, string-and-button closure integrated into the flap, worn paper folds, entirely blank cover.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-30.webp` (768×768), `public/assets/catalog/thumbs/small-red-30.webp` (220×220) — pending.

### small-red-31 — 封条残片

Subject: A seal remnant: single torn scarlet security tape fragment with a small attached crumbling plain wax lump, exposed cloth adhesive fibers and ragged folds, no stamps or letters.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-31.webp` (768×768), `public/assets/catalog/thumbs/small-red-31.webp` (220×220) — pending.

### small-red-32 — 信号旗样本

Subject: A signal flag sample: one folded woven cotton signal flag in geometric navy, ivory and mustard blocks, stitched hem and a single brass eyelet, tactile cloth with field fading.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-32.webp` (768×768), `public/assets/catalog/thumbs/small-red-32.webp` (220×220) — pending.

### small-red-33 — 深夜巡逻记录

Subject: A late-night patrol record: slim black oilcloth pocket logbook with a top spiral binding, pale gray slightly fanned pages and a faint unlabelled sketched path, no readable writing.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-33.webp` (768×768), `public/assets/catalog/thumbs/small-red-33.webp` (220×220) — pending.

### small-red-34 — 观察哨望远镜盖

Subject: An observation-post telescope cap: one round worn leather-covered metal objective lens cap with short integrated retaining strap, brass edge bead and embossed concentric rings, no text.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-34.webp` (768×768), `public/assets/catalog/thumbs/small-red-34.webp` (220×220) — pending.

### small-red-35 — 手写密码索引

Subject: A handwritten cipher index: one fan of small aged cream index cards held together by a single brass binder ring, staggered clipped tabs and tiny indistinct charcoal strokes with no readable glyphs.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/small-red-35.webp` (768×768), `public/assets/catalog/thumbs/small-red-35.webp` (220×220) — pending.

### large-red-07 — 绝密通信主机

Subject: A top-secret communications mainframe: heavy portable black secure radio chassis with guarded rotary controls, blank dark display, braided carry handle and several capped connector ports, no antenna props.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-07.webp` (768×768), `public/assets/catalog/thumbs/large-red-07.webp` (220×220) — pending.

### large-red-08 — 行动组原始胶片

Subject: An action-team original film: single large aluminium archival film reel containing dark photographic celluloid, six broad spoke openings and a short attached unspooling leader, faint unlabelled landscape frames.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-08.webp` (768×768), `public/assets/catalog/thumbs/large-red-08.webp` (220×220) — pending.

### large-red-09 — 封存样本核心

Subject: A sealed sample core: tall hexagonal titanium containment vessel with amber reinforced-glass center revealing a dark cylindrical mineral core, heavy end caps and four locking rods integrated.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-09.webp` (768×768), `public/assets/catalog/thumbs/large-red-09.webp` (220×220) — pending.

### large-red-10 — 旧世界导航图

Subject: An old-world navigation chart: large thick cloth-backed nautical chart loosely rolled with one end spread into a curl, pale parchment with compass rose and unlabelled coastlines, sewn dark border.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-10.webp` (768×768), `public/assets/catalog/thumbs/large-red-10.webp` (220×220) — pending.

### large-red-11 — 极地站最后日志

Subject: A polar station final log: heavy pale blue weatherproof field journal with frost-scuffed canvas cover, copper corner guards, thick swollen paper block and a frayed white elastic closure.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-11.webp` (768×768), `public/assets/catalog/thumbs/large-red-11.webp` (220×220) — pending.

### large-red-12 — 未解码卫星碎片

Subject: An undecoded satellite fragment: a single jagged curved aerospace panel with honeycomb aluminium fracture edge, attached broken cobalt solar cells and visible gold foil insulation, realistic recovered debris.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-12.webp` (768×768), `public/assets/catalog/thumbs/large-red-12.webp` (220×220) — pending.

### large-red-13 — 原型机控制晶片

Subject: A prototype control chip: large octagonal ceramic integrated-circuit carrier with an exposed iridescent silicon die under a clear window, dense gold contact pins and dark titanium support frame.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-13.webp` (768×768), `public/assets/catalog/thumbs/large-red-13.webp` (220×220) — pending.

### large-red-14 — 边境撤离母带

Subject: A border evacuation master tape: one wide professional magnetic-tape spool with dark steel three-spoke reel and dense brown tape winding, heavy hub and short curled attached leader.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-14.webp` (768×768), `public/assets/catalog/thumbs/large-red-14.webp` (220×220) — pending.

### large-red-15 — 完整观测站数据

Subject: Complete observatory data: a rugged rectangular archival disk pack in a cream composite protective caddy, removable smoked inspection lid partly slid back showing stacked metal platters, one coherent assembly.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-15.webp` (768×768), `public/assets/catalog/thumbs/large-red-15.webp` (220×220) — pending.

### large-red-16 — 指挥部手写底稿

Subject: A headquarters manuscript draft: one thick folio of rag paper on a weathered wooden writing board, heavy black steel clip, curled pages bearing indistinct ink strokes and erased smudges, no legible characters.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-16.webp` (768×768), `public/assets/catalog/thumbs/large-red-16.webp` (220×220) — pending.

### large-red-17 — 未知合金核心

Subject: An unknown alloy core: dense dodecahedral metallic core with dark pewter surfaces, irregular crystalline seams and naturally iridescent fracture facets, mounted in an integrated three-prong ceramic cradle.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-17.webp` (768×768), `public/assets/catalog/thumbs/large-red-17.webp` (220×220) — pending.

### large-red-18 — 深海信标记录器

Subject: A deep-sea beacon recorder: a weathered yellow pressure cylinder with a titanium domed end, crusted marine wear, protected acoustic transducer and chunky integrated mounting lugs.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-18.webp` (768×768), `public/assets/catalog/thumbs/large-red-18.webp` (220×220) — pending.

### large-red-19 — 远征队纪念怀表

Subject: An expedition commemorative pocket watch: large antique silver pocket watch with lid open to show intricate mechanical movement under glass, attached short chain, engraved abstract mountain relief on lid, no dial numerals.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-19.webp` (768×768), `public/assets/catalog/thumbs/large-red-19.webp` (220×220) — pending.

### large-red-20 — 初代侦察徽章

Subject: A first-generation reconnaissance badge: large antique silver wing-shaped scout badge with a central enamel falcon silhouette, blackened recesses, thick metal relief and an aged pin clasp visible at edge, no lettering.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-20.webp` (768×768), `public/assets/catalog/thumbs/large-red-20.webp` (220×220) — pending.

### large-red-21 — 最后一份样本

Subject: The last remaining sample: one sealed clear quartz ampoule containing a fragile dark burgundy botanical specimen, mounted inside a compact open cream ceramic protective cradle with attached hinged lid.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-21.webp` (768×768), `public/assets/catalog/thumbs/large-red-21.webp` (220×220) — pending.

### large-red-22 — 失踪航班黑匣子

Subject: A missing-flight black box: one battered international-orange crash recorder with a squat rectangular armored housing and integrated cylindrical underwater locator beacon, scratched paint and bolt flanges, blank exterior.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-22.webp` (768×768), `public/assets/catalog/thumbs/large-red-22.webp` (220×220) — pending.

### large-red-23 — 封存实验母盘

Subject: A sealed experimental master disk: one oversized iridescent optical glass data disk held within a clear square tamper-sealed cassette with brushed aluminium corner locks, visible concentric microgrooves.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-23.webp` (768×768), `public/assets/catalog/thumbs/large-red-23.webp` (220×220) — pending.

### large-red-24 — 地下城入口钥匙

Subject: An underground-city entrance key: one oversized intricate steel mechanical key with a triangular open-work bow, bronze center pin and unusually deep asymmetric ward cuts, oily wear and authentic mass.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-24.webp` (768×768), `public/assets/catalog/thumbs/large-red-24.webp` (220×220) — pending.

### large-red-25 — 行动档案总汇

Subject: An operation archive compendium: one large dark olive accordion archive binder with two aged leather straps, thick staggered paper sections and riveted metal spine, blank canvas cover, rich tactile archival materials.

Status: pending.

Source PNG: not yet generated.

Outputs: `public/assets/catalog/items/large-red-25.webp` (768×768), `public/assets/catalog/thumbs/large-red-25.webp` (220×220) — pending.
