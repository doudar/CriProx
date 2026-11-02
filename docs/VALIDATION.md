# Software validation — September 20, 2026

## Design-only MCP server — November 1, 2026

- The local HTTP server and bundled-Node stdio relay expose a closed catalogue of 18 design tools.
  Regression coverage checks authentication, Host/Origin restrictions, main-frame/owner guards,
  unknown print/cut/IPC commands, editable hero cards, atomic layer edits, project Undo, vector limits,
  local-only relay targets, and protection against a second app replacing an active connection.
- A hidden renderer test exercised the actual design engine through MCP HTTP. It created a 182-layer
  Alpine landscape and a 16-layer original hero card, rendered both PNG previews, transformed sticker
  copies, exported native project files and rejected a cancelled mutation without changing the project.
  Neither printer nor cutter services were instantiated by that test.
- An isolated browser used the actual built React app with simulated native IPC and a real MCP HTTP
  server. Both projects loaded into the live workspaces, Undo/Redo and layer edits worked, the existing
  nesting worker arranged stickers, and both drafts retained their layers after reload. The shared
  card designer saved editable artwork and handled Ctrl+Z without undoing the surrounding card project.
  Settings start/stop and disabled configuration copying while stopped were checked in the UI.
- Full app suite: 353 passed, 2 skipped (355 total). Production build, all 17 website tests and the offline documentation build passed.
  Packaged stdio and archive smoke checks verify protocol initialization, all 18 tools, a design call,
  rejection of a cut call, SDK loading from app.asar, and clean relay shutdown. The Windows preview is
  `release/mcp-design-preview/win-unpacked/CriProx.exe`.
- No printer job, cutter connection, machine movement, registration scan or physical cut was performed
  for MCP validation. macOS/Linux packaging and external AI-client configuration remain to be tested.

## Automatic connection from the cut page — November 1, 2026

- Full app suite: 346 tests, 344 passed and 2 skipped. New coverage verifies one saved-key attempt,
  missing/rejected-key setup, cleanup before connection, active-connection guards, saved-only worker
  requests, and key availability without exposing key bytes or launching the native worker.
- Isolated browser checks used a simulated cutter service with the real built UI. Home and sticker
  editing made no connection attempt. Opening the card or sticker cut page connected once with a
  saved key. Disconnect stayed disconnected; missing-key setup opened the simulated Design Space
  action and allowed an explicitly authorized session connection. No hardware or account session was used.
- Production build and unpacked Windows package passed at
  `release/auto-connect-preview/win-unpacked/CriProx.exe`. Archived renderer and cutter files match
  the current build; the temporary simulated-service fixtures are absent from the package.
- Website dependency installation, all 17 website tests, and the offline documentation build passed.
  Automatic reconnection with the physical cutter remains to be checked.

## Windows-protected cutter key — November 1, 2026

- All 37 cutter/installation tests passed, including saved-key reuse without session lookup,
  ciphertext persistence, corrupt/foreign-user storage, consent, version scope, private worker IPC,
  and removal before retry after failed authentication. The final controller deletion guard also
  passed the 12 key/controller tests.
- `npm run build` passed (with the existing large-chunk advisory).
- A hidden Electron smoke check used actual Windows safeStorage with a synthetic key. A separate
  Electron process decrypted the saved ciphertext and removed it successfully. No Cricut credentials
  or hardware were used in this check.
- The real cutter component was rendered with a disconnected test API: connection required consent,
  Forget saved key displayed its result, and there was no horizontal overflow. The updated panel
  screenshot is included in the print workflow guide.
- The next successful connection in the updated app will save the user's actual machine key.
  Its lifetime across cutter power cycles, expired Cricut sessions, and long periods remains unverified.

## Native pressure/pass implementation — October 31, 2026

- Real Bifrost 36.0.0 offline builder verified 24 combinations: two fine-point materials, three
  pressure presets, and 1/2/3/10 passes. Compiled paths contain exactly the requested pass count
  and force values. No hardware connection is made by `scripts/cutter-pressure-probe.cjs`.
- Native test-square execution now uses those settings. Unit tests cover idle/readiness/tool guards,
  native start, completion versus failure, callback cleanup, cancellation, command allowlisting,
  pressure/pass validation, and rejection of raw force/path overrides.
- Explore 5 firmware 4.8.2 completed a USB test with the white sticker paper profile, fine-point
  blade, Medium (80 g), and **one pass only**, as requested by the user. The requested 12.7 mm square
  cut cleanly according to the user; exact physical dimensions were not measured. Native completion,
  unloaded/idle status, and disconnection were confirmed. Multiple passes and other forces/materials
  have only been checked in software. Full-sheet optical registration remains untested.
- Hardware testing exposed and fixed two job-flow requirements: asynchronous event callbacks and
  explicit app-side resume at measurement/start barriers. An earlier waiting job was cancelled
  through the native API and disconnected. The app start command cannot repeat a test cut.
- Root suite: 286 tests, 284 passed and 2 skipped. Production build and unpacked Windows packaging
  pass. Both workspace screenshots show the shared material/pressure/pass controls. Website tests
  pass (17); offline build verifies 12 pages and 21 releases.

## Shared cut settings — October 31, 2026

- Cards and Stickers use one pressure/pass editor in sheet setup and the print-then-cut workflow.
  Tests cover local project round-trips for all three presets and pass-count boundaries, migration of
  older projects to Medium/one pass, and rejection of malformed presets and non-integer/out-of-range passes.
- Changing pressure/passes retains captured print geometry. Generated card and sticker jobs preserve
  the chosen preset and passes; ZIP instructions include them. Presets are not calibrated force values
  and are not sent to the cutter. No hardware movement or cutting was attempted for this change.
- Root suite: 281 tests, 279 passed and 2 skipped. Production build passes.
- Desktop visual review confirmed the shared controls in both editors; documentation screenshots
  now show the current layout. Rebuilt the unpacked Windows preview executable.

## Registration inset correction — October 31, 2026

- Removed the generated-frame adjustment that moved dense layouts toward the page edge. Eight cards
  on Letter previously moved the top/bottom marks to about 3.85 mm from the edge; oversized sticker
  layout limits could reduce that to 1 mm. Generated marks now remain 12.7 mm from every edge.
- Compared the locally inspected machine-family metrics and composition frame clamp with the
  implementation. Preview marks, PDF vectors, keep-out guides, and saved cut-job geometry share
  the corrected frame. Captured-template placement is unchanged.
- Rendered PDF checks cover Letter/A4 and all four optical machine choices, sampling white margins
  along all four edges. Oversized sticker layout limits do not alter the frame. Eight full-size cards
  on Letter are rejected for overlap; the same cards generate on A4 without scaling. The 54-label
  Letter preset still generates, with all original contour dimensions and positions preserved.
- Root suite: 277 tests, 275 passed and 2 skipped. Production build and Windows unpacked packaging
  pass. These are software/file checks; physical sensor acquisition and cutting remain unvalidated.

## Sticker workspace validation — October 17, 2026

- Imported the supplied 54-label grouped SVG through the running app. The resulting project contains
  54 separate embedded designs on one sheet. Saved and reopened its portable local file successfully.
- Compared all exported X/Y positions and dimensions against the supplied position CSV: all 54 match.
  The regression fixture is `tests/fixtures/sticker-54-positions.csv`; its dimensions are 42.5 × 14.5 mm,
  with 2 mm gaps in a 176 × 245.5 mm tapered arrangement.
- Exported the real label sheet as a PNG/SVG/CSV ZIP and visually checked the rendered artwork.
- Tested measured capture and registered PDF generation in the browser using an explicitly synthetic
  PDF fixture. Rendered the generated PDF independently and verified that all four marks in the
  tapered corner spaces remain black and unused template slots are cleared. These fixture marks
  are not Cricut sensor marks and do not validate physical registration.
- Tests cover mixed/repeated filling, over-100-slot grids, rotated placement and non-overlap, portable
  file validation, capture invalidation, transparent artwork, SVG restrictions, partial-sheet occupied
  dimensions, and Windows installation discovery. The installed Design Space 43.2.0 and native device
  bridge were found through read-only checks.
- Reviewed the new interface at narrow and desktop widths. Updated the main studio and sticker
  workspace screenshots. No Explore 5 connection, scan, pressure setting, or physical cut was tested.

See [the integration investigation](EXPLORE-5-INTEGRATION.md) for the remaining direct-control work.

## Native cutter investigation — October 17, 2026

- Loaded the hash-verified Bifrost 35.1.0 engine from the local Design Space 43.2.0 installation.
  Instantiated its Gandalf (Explore 5) device with an in-memory transport, captured emitted bytes,
  confirmed the expected request timeout and unencrypted status, and disconnected.
- Ran `node scripts/cutter-probe.cjs --usb --bluetooth` against the actual installed DeviceIO process.
  USB enumeration returned 13 descriptors and no recognized cutter. Bluetooth reported ready;
  the bounded scan returned no descriptors. All owned adapters were destroyed and the process exited.
  No device connection, pairing, movement, calibration, activation, or cut was attempted.
- Automated discovery tests cover fragmented/coalesced framing, malformed lengths/fields, adapter
  response routing amid logs/notifications, USB descriptors, BLE ready/not-ready behavior, scan
  stop and cleanup, timeouts, unsupported versions, and unexpected native process exits.
- Traced the installed job configuration, registration scan parameters, lifecycle events, and
  connected cancel versus disconnected abort. These interfaces have not been hardware-validated.

## Passed

- TypeScript strict type-check and production Vite build.
- Automated tests covering deck syntax and quantity limits, pagination, mixed and uniform rotated placement, non-overlap across supported settings, raster rounding tolerance, PNG density metadata, imported-project validation, and captured-template recognition.
- Find Card preview caching was checked on October 6, 2026 with the browser HTTP cache disabled:
  all 21 previews in a token set downloaded once, then sorting and a full page reload displayed
  them without another image request. Repeat downloads were blocked during the reload check.
  A 175-result set gallery initially requested only 12 nearby previews. Automated cache tests cover
  shared downloads, persistence, eviction limits, unavailable storage, failed-image retries, and
  download concurrency; the full application suite passes 132 tests.
- Live variant lookup (136 Sol Ring printings), printing selection, and restoration after reload.
- Double-faced card import and selection of Insectile Aberration.
- Multi-sheet ZIP download, exact PNG pixel dimensions, opaque card interiors, transparent gaps/corners, and SVG shape counts/dimensions.
- Local artwork import, including an image with a transparent interior hole. The exported card remains opaque inside its outer cut silhouette.
- 600 DPI rotated local-artwork export: expected 4228 × 3047 pixels for the tested layout, correct rotation direction, and transparent gaps.
- Empty-project export disabled; project JSON backup opens and restores card quantities and selected printings.
- Visual review at desktop and 390 px mobile widths, with no horizontal page overflow at mobile width.
- Unsigned macOS arm64 package builds. Packaged app launches with context isolation, renderer sandboxing, and no renderer Node access. Native size-check and local-artwork exports succeed with no renderer exceptions.
- npm dependency audit reports zero known vulnerabilities for the installed dependency set.
- Experimental seven-card geometry: the 189.2 × 214.2 mm 2–3–2 template paginates at seven cards, preserves fixed slot positions, and is restricted to 63 × 88 mm cards, 0.1 mm spacing, US Letter output, and Maker/Explore targets.
- Experimental eight-card geometry: the 177 × 255 mm 2×4 template paginates at eight horizontal cards, preserves fixed slot positions, and is restricted to 63 × 88 mm cards, 1 mm spacing, US Letter or A4 output, and Maker/Explore targets. The A4 extension was validated on October 5, 2026 with fit-clearance checks, matching front/back PDF dimensions, preview translation, project validation, and browser checks of layout filtering and paper changes.
- Manual nine-card geometry: the 191 × 266 mm 3×3 template paginates at nine cards, preserves all
  slot coordinates on partial pages, and is restricted to 63 × 88 mm cards, 1 mm spacing, and
  2.5 mm corners. Front and mirrored back placement use the same tested 6.35 mm nominal page inset;
  signed X/Y cut corrections preserve back mirroring while shifting only printed artwork.
- Browser generation of a 2256 × 3142 px transparent Basic Cut PNG at 300 DPI, with nine opaque
  rounded silhouettes and transparent gutters, plus a matching one-page Letter PDF preview.
- Manual calibration and production card PDFs share the same raster sheet, bleed padding, PDF image
  bounds, and first-slot trim origin. A 600 DPI rendered placement proof located the production trim
  origin within one raster pixel of the nominal 6.35 mm page coordinate.
- A user-supplied Design Space capture was confirmed as a single, unrotated 612 × 792 point US Letter PDF. Its rendered magenta 2–3–2 pattern passed the production detector at 300 DPI with all four surrounding marks present.
- A user-supplied eight-card Design Space capture of the earlier 0.1 mm-gap layout was confirmed as a single, unrotated 792 × 1224 point Tabloid PDF. The production pattern and mark checks passed at 300 DPI. Its 7.63 × 10.63 in printed footprint was translated at actual size into a 612 × 792 point Letter output proof with all visible content intact and at least 0.19 in clearance vertically. The revised 1 mm-gap layout needs a new capture and fit check.

Browser checks caught a local-image bug: fetching a data URL was blocked by the renderer CSP. The final export code directly decodes embedded artwork without making a fetch request. The fixed browser export was validated at pixel level.

## Local update validation

Use `npm run desktop:updates` to test the real desktop update bridge with an isolated profile
and an 8 MB fixture download. See [the simulation instructions](INSTALLATION.md#simulate-an-update-locally)
for all scenarios. No GitHub release needs to be published.

1. Open **Review update** and check the website-style changelog, category icons, lists, and links.
2. Start a download, close Settings, reopen **Settings → Updates**, and confirm progress continues.
3. Cancel and retry. A complete download should become **Download verified and ready to install**.
4. Choose **Test installer handoff**. Expect a confirmation dialog, no real installation, and
   CriProx to remain open. On macOS, check **Copy command** and **Open Terminal**; these are real
   desktop actions, but the command runs only when you paste and execute it yourself.
5. Run the checksum-failure and network-failure scenarios. Confirm the first attempt fails and
   the retry succeeds; run the up-to-date scenario to check the no-update state.
6. Choose **Remind me later** and confirm the notice disappears and a small **Update available**
   button appears beside the donation button in the bottom bar. Click it to reopen Updates;
   after a verified download it should read **Update ready**. The temporary profile resets on
   the next simulation launch.

Automated checks compare desktop note cleanup and release headlines with the website for every
existing changelog release, check Markdown sanitization and allowed links, and exercise each
simulation through the production update manager. Handoff tests cover cancellation, launch
failures, the quit callback, executable AppImage copies, and macOS-only help actions. This does not certify operating-system
installer behavior, signing, or notarization.

## Still requires external validation

- Actual Cricut sensor acquisition, Design Space contour tracing, physical scale, alignment, and repeatability.
- Acceptance of the experimental six-card layout on each model/paper configuration, including the Tabloid setup for Letter and A4 output.
- Seven-card sensor acquisition, physical dimensions, edge alignment, 12 × 24 in mat behavior, and repeatability after the Tabloid-to-Letter print workaround.
- Eight-card printer imageable-area fit, sensor acquisition, physical dimensions, edge alignment, mat behavior, and repeatability after Tabloid capture and Letter or A4 export.
- A first nine-card Basic Cut trial completed with matching scale and a small, consistent-looking
  up/left translation. Exact correction and repeatability across multiple page placements and mat
  loads still require measurement.
- Windows and Linux installer builds and runtime checks.
- macOS signing/notarization for distribution.

Follow [the physical acceptance procedure](CRICUT-WORKFLOW.md) before producing a full deck. No software test here certifies perfect machine alignment or certifies sensor compatibility.

Local screenshots and test export artifacts are in `output/playwright/` (ignored from source control). The desktop build is in `release/mac-arm64/CriProx.app`.

## Explore 5 connection investigation (October 31, 2026)

A physical Explore 5 answered a BLE firmware query with 4.8.2. Later BLE scans did not rediscover
it. Initial USB queries and handshakes failed with negative acknowledgments; after a user power
cycle and an explicitly authorized machine-key request using the existing Cricut session, USB
handshake, encrypted status, firmware read, and repeated authenticated sessions succeeded.

With the blade removed, the user authorized a motion test. The probe entered active state, sent
SDK homing, waited for completion, verified idle with zero queued moves, and returned to idle before
disconnecting. **The user confirmed physical movement.** This validates one homing operation;
arbitrary positioning, registration scans, cutting, cancel/recovery, and production accuracy remain
unverified. Runtime warnings about stale notifications and default communication timeouts remain.

Design Space 10.8.81 / Bifrost 36.0.0 passes the offline engine probe. Transport and homing tests
cover routing, notifications, serialized writes, creation parameters, timeouts, cleanup, busy-state
rejection, completion checks, and error propagation. No credential or machine-key values are
included in source or output artifacts. See the [investigation](EXPLORE-5-INTEGRATION.md).

## Workspace and desktop controller validation — October 31, 2026

- Root suite: 275 tests, 273 passed and 2 skipped. Coverage includes sticker rotation/alpha-bound export
  dimensions, clipboard artwork/transforms, cut/undo restoration, history branching/reset, shortcut handling,
  machine-specific capture keys, and paper/keep-out planning guides. Build passes.
- Generated-print tests rasterize PDFs to verify all four corner marks and the arrow on Letter/A4 across
  the four optical machine choices. They also cover the 54-label layout, rotated stickers, multi-page cards,
  partial-page cut contours, card backs/duplex, artwork collision rejection, and eight-card Letter framing.
  A 54-label generated PDF was rendered and visually inspected. These are file-based checks, not hardware scan validation.
- The existing 54-label file opens in the main-window Sticker workspace. Desktop review checks workspace
  switching, individual selection and editing, fit-to-view, and the paper/mark overlays.
- The packaged Windows app's isolated controller authenticated to the USB Explore 5, read firmware 4.8.2
  and idle status, then disconnected cleanly using the refreshed existing Design Space session. This check
  did not move the cutter. The earlier user-confirmed blade-free homing result remains the motion evidence.
- Registration scanning and production cutting remain unverified. Published maximum extents are not proof
  of a usable rectangular region; generated mark geometry is shared with PDF output, but physical sensor acquisition still needs testing.
- Local preview executable: `release/workspace-preview/win-unpacked/CriProx.exe`. Keep its supporting
  files together. This is an unpacked development build, not a newly published or signed installer.
- Delete shortcut routing preserves text-field deletion and supports undo in both workspaces. Rendered
  sticker-PDF regression checks confirm captured corner marks survive export. Generated-PDF tests cover local marks without a capture; artwork-only exports remain an explicitly separate Design Space route.
- Desktop automation was stopped by the user before final Delete-key UI checks and refreshed documentation
  screenshots. Existing screenshots predate the final workspace dropdown and machine-guide presentation.

## Direct printing and registered sheet controller — October 31, 2026

- Root tests: 294 total, 292 passed, 2 skipped. The production build passes. New coverage includes printer geometry, sequential page submission, owner isolation, cancellation and cleanup, registered-sheet validation, native inner-frame coordinates, selected-sheet handling, scan failures, duplicate start events, and pause/resume guards.
- The installed Bifrost 36.0.0 runtime built a 54-contour registered job and all 24 tested pressure/pass combinations offline. No hardware was connected by that probe.
- A real hidden Electron window decoded and paginated two 300 DPI print pages into exactly two 612 × 792 pt Letter pages. Raster checks confirmed all four test marks remained at their expected positions. This probe did not submit a printer job.
- Desktop inspection confirmed the Windows system print dialog opened from the 54-label project. The user submitted that print; CriProx reported printer acceptance. Physical paper scale and quality still need inspection.
- The updated PDF preview was inspected at 150% with small label text; rendering now follows display pixels and zoom. The current workflow screenshot is in `docs/assets/criprox-print-cut.png`.
- The square-test UI and command were removed. The new Cut sheet controller is implemented, but optical sensor acquisition, full-sheet placement, actual cut alignment, multi-pass behavior, and pause/resume still need physical validation. The earlier clean one-pass square remains the only cutting result confirmed by the user.
- Website checks passed: 17 tests and offline build of 12 pages / 21 releases. No installer or release was published.
- The final unpacked Windows build completed successfully at `release/print-cut-preview/win-unpacked/CriProx.exe`. The existing `workspace-preview` session was left open so the user's printing and cutter connection were not interrupted. Keep each executable with its own supporting files; do not run both copies concurrently against the same local draft.

## Registered sheet success and automatic sticker placement — October 31, 2026

The user confirmed that the first full registration scan and cut worked and produced usable stickers. The prepared Letter sticker job used Explore 5 USB, fine-point blade, Medium / 80 g, one pass. This supersedes the earlier pending-alignment notes for that specific setup.

Automatic import, Fill, and Auto arrange now share a placement search that respects the same machine bounds and reserved corners shown in the preview. Tests cover all four optical machine choices on Letter/A4, existing-position preservation, overflow to another sheet, oversized-item rejection, and repair of old layouts while retaining transforms. The product-specific preset has been removed; old projects retain their saved dimensions and placements.

Validation for this update: 297 root tests (295 passed, 2 skipped), production build, Windows unpacked build, 17 website tests, and offline website build passed. An isolated desktop profile opened a generic 35-sticker autofilled project without planning conflicts and generated its marked PDF without clearance warnings. Generic screenshots replaced the previous product-branded examples. The user's saved projects remain compatible.

## Material manager — November 1, 2026

- Imported the complete available local Explore 5 cache: 116 material names, 118 material/blade profiles, no skipped records. Data stays local and no Design Space files are modified.
- All 109 compatible fine-point profiles built native plots offline with their exact ordered pressure sequences. Eight deep-point profiles and one signed-pressure profile are retained for reference but rejected for direct cutting. No hardware was connected or moved by these checks.
- Isolated Electron UI checks verified automatic import, 180 g / two-pass cardstock selection, custom preset creation at 195 g / three passes, application to the current project, and persistence after reload. The material manager screenshot is `docs/assets/criprox-materials.png`.
- Production app build passed. Root tests: 316 total, 314 passed, 2 skipped. The Windows sandbox blocked temporary-file renames in unrelated tests; the suite passed outside the sandbox after dependency installation completed.
- Website dependencies installed from the local npm cache. Website verification currently reports an unrelated missing `docs/assets/criprox-sticker-designer.png` reference in the existing sticker-designer documentation: 16 of 17 website tests pass, and the offline build stops at that missing asset. The new material-manager screenshot and guide links resolve.

## Sticker designer, editable cuts, and print preview — November 1, 2026

- Root suite: 320 tests, 318 passed and 2 skipped. Production app and unpacked Windows builds pass. Tests cover editable-design persistence, clipboard copies, cut geometry and transforms, registration clearance, native open/closed paths, and print-preview cancellation and cleanup.
- A real hidden Electron renderer verified text, shapes, drawn lines, and embedded images at 600 DPI. Run `electron tests/sticker-render.electron.cjs` to repeat this pixel check.
- The installed cutter runtime built a registered job containing a concave star, an open polyline, and an ellipse at 80 g, one pass. `node scripts/cutter-custom-path-probe.cjs` repeats this offline check without discovering, connecting to, or moving hardware. Custom paths still need physical validation; the earlier successful sticker-sheet run used rounded rectangles.
- Isolated browser checks verified polygon and freehand cut creation, open lines, editable vertices, undo/redo, Delete, saving designs to the sheet, and autofilling 20 custom-outline stickers without planning conflicts. Preparing that sheet produced its marked PDF and matching cut job. The desktop UI used by another agent was left alone during these checks.
- Desktop print-preview inspection verified the full page image, page navigation, and cancellation without submitting a print job. Screenshots are `docs/assets/criprox-print-preview.png` and `docs/assets/criprox-sticker-designer.png`.
- The designer screenshot now resolves the missing-asset issue recorded above. All 17 website tests pass; `node site/build.mjs --offline` builds and verifies 12 pages and 21 releases.
- Updated executable: `release/designer-preview/win-unpacked/CriProx.exe`. Keep its supporting files together. This separate development build was not launched over the active desktop session; no installer or release was published.

## Trimmed sticker outlines and shape nesting — November 1, 2026

- Root suite: 326 tests, 324 passed and 2 skipped. Production build and the hidden Electron rasterizer pass. New checks cover cut-bound trimming, editable-canvas persistence, transparent corners, combined outlines, open-only fallback, concave collision checks, containment, and minimum spacing.
- An isolated browser saved a 30 mm circle from a 40 mm designer canvas and confirmed 30 × 30 mm sheet dimensions. Auto arrange and Fill placed 35 circles in the default Letter planning area with 2 mm spacing, compared with 30 rectangular grid slots. All cut shapes stayed separate and clear of the machine guides. Existing copies were retained by Fill. Screenshot: `docs/assets/criprox-sticker-nesting.png`.
- A rendered marked-PDF regression checks that one circle's empty rectangular corner does not erase its neighbor. The corresponding native job contains the expected cropped coordinates and separate contours; registration marks retain their positions. No printer or cutter was used for this update.
- Existing saved designs retain their old frame until edited and saved again. Full design canvases remain editable; only the sheet output is cropped. Open-only designs retain a rectangular footprint. Nesting is a deterministic contact search with a grid fallback, not a guarantee of globally optimal packing; existing rotations are preserved.
- The browser also prepared the 35-circle sheet and displayed its PDF preview and matching cut-job download. The Windows build is `release/nesting-preview/win-unpacked/CriProx.exe`; the existing desktop session was not replaced or restarted. All 17 website tests and the offline website build pass.

## Sticker library actions and artwork-preserving borders — November 1, 2026

- Isolated UI checks confirmed Delete removes a selected zero-copy library design, sheet selection deletes only one copy, and Undo/Redo restore each. The right-click menu supports editing, renaming, independent design duplication, cut/copy/paste, placement, and three distinct deletion scopes. Delete all designs followed by Ctrl+Z restored both the placed and unused designs. The shared card menu still opens and dismisses correctly.
- A wide imported label was resized to 24 × 14.5 mm, set to trim, and given 1 mm padding with a 0.3 mm blue stroke. Preview inspection confirmed the complete measured artwork source remained visible inside the border. A rendered-PDF regression verifies both colored edge markers, the text, the printed stroke, unchanged registration marks, and the matching native cut contour.
- Trimming preserves white artwork on transparent backgrounds and every non-white pixel in opaque images. Blank/fully transparent images retain their full frame. Custom designs keep their complete saved artwork/cut mapping. Border settings round-trip through project files; invalid dimensions/colors are rejected.
- Root suite: 331 tests, 329 passed and 2 skipped. Production build passes. Screenshot: `docs/assets/criprox-sticker-menu.png`. No printer or cutter was accessed. The updated unpacked executable is `release/sticker-controls-preview/win-unpacked/CriProx.exe`; keep it with its supporting files.

## Responsive layout, Fit Cut, layers, and Home — November 1, 2026

- Reproduced the slow 96-oval layout: the previous search exceeded an eight-second benchmark limit. Matching-ellipse geometry reduces the same local benchmark to roughly 0.6 seconds. A 96-item fitted-border benchmark completes in roughly 1.3 seconds. These are local measurements, not fixed guarantees for every project.
- Auto arrange and Fill use an isolated worker, progress, cancellation, a bounded nesting phase with a safe grid fallback, and a watchdog. A production `file:` Electron test completed 96 placements in 623 ms while the renderer's 5 ms timer continued ticking (124 ticks). Browser cancellation retained the previous layout; a subsequent run completed with 96 items and no overlap warning. Fast convex distance checks agree with exact segment checks over deterministic positions and tangent contacts.
- A hidden Electron pixel test fitted an outline around an oval and text extending beyond the original canvas. All 66,591 original opaque artwork pixels survived, the border printed, and there was one outer cut. The canvas expanded as needed. Fit Cut options survive project validation and re-fitting replaces the generated border.
- Real browser dragging reordered Layers. Undo and Redo restored each stacking order. Selection and pink cut guides are 1 px dashed strokes with non-scaling display widths; the selection handle stays small as zoom changes. The extra Show cuts message was removed. Screenshot: `docs/assets/criprox-fit-cut.png`.
- Home opens by default, with Proxy Card Builder and Stickers, new/open actions, draft continuation, recent local copies, and the existing desktop project library. Browser checks created fresh projects in both modes and restored their previous drafts through recents. Opening a sticker file selected its workspace automatically; recent projects persisted across reload. Both light and dark Home themes were inspected. The mode registry is shared by the home tiles and workspace menu.
- Root suite: 340 tests, 338 passed and 2 skipped. Production build passes. New tests cover fitted borders, canvas expansion, layer reordering and history, ellipse/convex clearance, bounded search fallback, workspace names, recent summaries, deduplication, and cache limits. No printer or cutter was accessed.
- Updated unpacked build: `release/home-preview/win-unpacked/CriProx.exe`. Existing desktop sessions were left untouched. Screenshot: `docs/assets/criprox-home.png`.
- Final packaging verification confirmed that the executable's bundled UI, styles, and layout worker match the final production build. All 17 website tests and the offline build of 12 pages / 21 releases pass. Home was also checked in a narrow layout without horizontal overflow.

## Proxy Card Builder cut guides — November 1, 2026

The card preview now has Show cuts alongside zoom, using the shared native polygon geometry for each occupied placement. Browser checks verified four guides for a four-card partial sheet, on/off toggling, constant 1 px dashed pink lines after zoom, and working card context menus through the non-interactive overlay. The production build and existing generated-print/registration checks pass. Screenshot: `docs/assets/criprox-card-cuts.png`. The new unpacked executable is `release/card-cuts-preview/win-unpacked/CriProx.exe`; existing desktop sessions were left untouched. No printer or cutter was accessed.

## AI design release corrections - November 1, 2026

Regression checks cover preserving separate recent identities through AI create/load and Home, rejecting late AI mutations while the human editor is busy, embedding catalog images before layer edits, comparing AI sheet-preview pixels with shared artwork rendering (crop, padding, stroke, rotation and reflection), and clearing only incompatible machine registration captures. The renderer test mounts the real App with an isolated browser profile and an intercepted catalog image fixture. It loads no printer or cutter service and makes no hardware requests. Run `npx electron tests/ai-design-fixes.electron.cjs`; Windows CI also runs this regression.
