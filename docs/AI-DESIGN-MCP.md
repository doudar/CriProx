# AI design with MCP

Skarix includes an optional local MCP server for editable artwork and sheet layouts. It starts off each launch.

1. Open **Settings → AI design**.
2. Choose **Start AI design access**, then **Copy MCP configuration**.
3. Add it to your MCP client and keep Skarix open.
4. Stop access from the same page when finished.

The configuration contains a local token. Keep it private and use trusted clients. The server is bound to loopback.

The design tools cover capabilities, workspace inspection, project creation/loading/export, design creation/editing/duplication/deletion, SVG import, cut paths, fitting cuts, layout, sheet settings, previews and undo/redo. Use `workspace: "stickers"`; this identifier is retained for compatibility.

Designs support up to 500 layers, 2,000 normalized points per path and 100,000 total points. Coordinates and sizes are millimeters. Use text, shapes, filled paths or embedded images. The server does not invoke an image-generation model.

Read the workspace first, use its IDs, inspect previews and refine. AI preserves the prior project before loading or creating another. Pending edits fail if a human starts editing or changes the project.

Catalog search and gaming-card templates are removed. No tool can operate printers/cutters, execute shell commands or access arbitrary IPC. The user reviews and performs print/cut operations.

## Appearance and layer tools

`create_design.elements` and `edit_design` add/update patches share the saved artwork schema. Use `get_design_capabilities` to discover guidance and `get_workspace` to inspect IDs. Optional appearance objects can be cleared with `null`.

| Property | Supported values |
| --- | --- |
| `gradient` | `from`/`to` hex colors; optional `type` (`linear`/`radial`), `angle`, normalized `cx`/`cy`, `radius`, and 2–16 `stops` containing normalized `offset`, hex `color`, and `opacity`. |
| `effects` | `blur`, `backgroundBlur` in mm; up to four `shadows` with `type` (`drop`/`inner`/`glow`), `color`, `opacity`, `blur`, `x`, `y`. Background blur samples earlier siblings. |
| `blendMode` | `normal`, `multiply`, `screen`, `overlay`, `soft-light`. |
| `mask` | Preset `shape`, optional `feather` in mm, and `fade` (`none`, `left`, `right`, `top`, `bottom`, `radial`). Works on groups too. |
| `texture` | `type` (`image`, `grain`, `paper`, `stone`, `metal`), integer `seed`, `scale`, `opacity`; image textures require an embedded PNG/JPEG/WebP `image`. Applies to shapes, text (including text on a path) or filled paths. |
| `adjustments` | Image-only `exposure` (−4…4), `contrast`/`saturation` (0…3), `temperature` (−1…1), `sharpen` (0…2). |
| `curves` | Draw-only array of up to 256 cubic segments: normalized `c1`, `c2`, `end` points. Starts at `points[0]`; `closed` closes the outline. |
| `textPath` | Text-only `{pathId, side: "inner" | "middle" | "outer", offset: 0…100}` referencing an existing shape or closed drawn polygon. |
| `hidden`, `locked` | Booleans. Hidden layers omit output; locking protects edits. Group flags apply to descendants. Unlock in a separate operation before changing protected properties. |

`edit_design.operations` also accepts:

```json
[
  {"action": "group", "ids": ["shape", "caption"], "id": "badge"},
  {"action": "update", "id": "badge", "patch": {"rotation": 15}},
  {"action": "align", "ids": ["badge", "other"], "alignment": "middle"}
]
```

Alignments are `left`, `center`, `right`, `top`, `middle`, `bottom`, `distribute-horizontal` and `distribute-vertical`. Distribution needs at least three layers and spaces centers evenly. Select either a group or its children, not both. Group operations require sibling artwork layers; blade paths remain outside artwork groups.

Groups use `kind: "group"`, `groupWidth`/`groupHeight` for the original local frame, and `parentId` on children. Normal width/height resize that frame; rotation and flips apply to the whole group. Nesting is limited to eight levels. Duplicate and remove operations include descendants. `ungroup` preserves transforms but requires resetting group effects, mask, blend and opacity first.

Pass `canvas.grid: {"visible": true, "snap": true, "spacing": 2}` through create/edit to save non-printing editor preferences. MCP positions remain exact. `fit_design_cut` also accepts `strokePlacement: "inside" | "centered" | "outside"`.

Preview after changes. The same SVG rendering powers the interactive editor and saved/printed artwork. Assets must be embedded; effects cannot load external URLs or run scripts. Total limits remain 500 layers and 40 MB of embedded images, including texture images. Curves count toward the 100,000-point budget.

An editable example created through the MCP server is available in [`examples/skarix-aurora.skarix.json`](../examples/skarix-aurora.skarix.json). Open it from Home to inspect the rounded badge, layered gradients, lighting and textured lettering.

## Detailed illustration workflow

Use `preflight_design` before submitting a large design. It accepts proposed `canvas` and
`elements`, or an existing `designId`, and reports each numeric budget, current value and
recovery suggestion. Rendering uses a 600 dpi target with an approximately 24-megapixel cap;
compressed PNG size is only known after rendering. Oversized output errors include the actual
PNG data-URL character count and a suggested scale reduction. Image limits measure data-URL
characters, not decoded bytes.

`get_editor_state` describes the current human operation. Read-only workspace, preview and
export tools remain available during editing, but describe the **last saved** project, not the
unsaved draft. Do not discard human work silently. After the user chooses Save or Cancel,
call `resolve_editor_operation` with `action`, the returned `operationId`, and `confirm: true`.
Stopping AI access or a request timeout during rendering prevents the pending save from committing;
the human draft stays open and can still be saved manually. Changes to the project or draft while
rendering also invalidate the confirmation before any save is committed.
An operation that has changed, or is still rendering/fitting, cannot be resolved by an old request.

Layers have optional `name` labels. Groups are the existing nested artwork groups, now with
names, hierarchy breadcrumbs and selected-part close-ups. `preview_design` accepts a `layerId`
with `designId` for a cropped view of the part in context (including ancestor effects).

`canvas.reference` stores an embedded image, `visible`, `opacity`, `x`, `y`, `width` and `height`
for an editor-only reference overlay. Set it to `null` through MCP to remove it. It never enters
printed artwork, previews or blade geometry; it remains embedded in the saved native project.

For repeated details, add a `repeat` object to a source print layer:

```json
{"mode":"scatter","count":80,"columns":10,"spacingX":60,"spacingY":10,
 "angle":30,"seed":7,"rotationJitter":15,"opacityJitter":0.3}
```

Modes are `grid`, `radial` and `scatter`. Grid uses columns and horizontal/vertical spacing.
Radial uses the spacing values as ellipse radii and angle as the step between copies.
Scatter distributes copies within the spacing rectangle. Offsets use source-local coordinates.
The seed deterministically controls scatter and rotation/opacity variation. These are linked
render-only instances of one editable layer, not 80 additional saved layers. Changing the source
updates every copy. Maximums are 200 copies per source and 2,000 rendered layers per design.
Groups, cut layers and text following another path cannot be repeated. Keep repeated artwork
inside the canvas/cut contour; repetition does not create additional blade paths.

`list_material_presets` returns built-in Painted metal, Rubber and Soft grass appearances and,
with a `designId`, saved project-local materials. `edit_design.operations` accepts
`{"action":"apply_material","ids":["frame"],"presetId":"painted-metal","includeDescendants":true}`
and `{"action":"save_material","id":"frame","name":"Turquoise metal"}`. Applying a material
preserves geometry and skips locked, cut and non-fillable layers. Saved materials use procedural
textures, not embedded photo textures; up to 32 named styles travel with each design. These are
illustration appearances, unrelated to cutter pressure/material settings.
