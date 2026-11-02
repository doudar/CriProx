# AI design with MCP

Skarix includes an optional local MCP server for editable artwork and sheet layouts. It starts off each launch.

1. Open **Settings → AI design**.
2. Choose **Start AI design access**, then **Copy MCP configuration**.
3. Add it to your MCP client and keep Skarix open.
4. Stop access from the same page when finished.

The configuration contains a local token. Keep it private and use trusted clients. The server is bound to loopback.

The fifteen tools cover capabilities, workspace inspection, project creation/loading/export, design creation/editing/duplication/deletion, SVG import, cut paths, fitting cuts, layout, sheet settings, previews and undo/redo. Use `workspace: "stickers"`; this identifier is retained for compatibility.

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
