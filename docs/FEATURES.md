# Skarix features

Skarix — Open Source Cutting Studio — is based on CriProx by Chris Engle and its original contributors.

## Home and projects

Home offers a blank canvas, **Meet Skarix**, the continuing draft, and recent projects. The starter has a 76 × 42 mm Skarix sticker with four editable layers: two geometric logo strokes, the wordmark and a tagline. It uses no downloaded artwork.

The starter loads automatically only when no saved draft exists. Opening it explicitly preserves the previous project in Recents. Blank projects stay blank when reopened. Save portable `.skarix.json` files for durable storage.

Existing sticker projects remain readable. Legacy card projects can be exported from Home, including the last autosaved card draft even if it never appeared in Recents or the managed library. Recovery exports leave the stored draft unchanged. Their editing workspace and online catalogs are removed. User files, prior application storage and installation identifiers are preserved.

## Artwork and layout

Create text, shapes, embedded images and filled paths. Import SVG, change layer order, opacity, rotation and flipping. Editable layers are stored with projects.

Work in physical dimensions, arrange copies, nest layouts, and inspect pink cut contours. Artwork and blade paths can be edited separately. Image silhouettes are not automatically traced.

Undo/redo and clipboard shortcuts work in the active editor. Delete removes a selected design or placed copy; Undo restores it. Text inputs retain their usual shortcuts.

## Print and cut

Choose a machine, Letter or A4 paper and material settings. **Print & cut** prepares marked pages and matching contours. Inspect the preview, print at actual size, and use the matching job.

Windows Explore 5 USB support and the reusable material library are retained. Other machine guides support external workflows; direct device support is narrower. See [Print & cut](CRICUT-WORKFLOW.md).

## Material manager, pressure and passes

Use **Manage materials** to inspect cached Design Space materials or create local presets. Refresh preserves your edits. Projects and jobs retain selected material settings; review pressure and pass count before cutting.

## AI design and settings

Optional MCP access starts off each launch. AI can edit artwork, SVG, contours, layouts and previews; it cannot print, control cutters, run shell commands or use the removed catalogs. See [AI setup](AI-DESIGN-MCP.md).

Closing the design window stops AI access and removes its local connection record. Window-close and application-quit requests wait for the same cleanup operation. Windows and Linux exit after the last window closes; macOS retains its normal application lifecycle until Quit. Application quit also waits for the cutter helper to exit, with a three-second fallback termination after disconnect. A separately launched MCP client owns its own relay process.

Settings includes light/dark appearance, AI access and updates. Updates validate release origins and installer checksums from **doudar/Skarix**. Existing CriProx-named assets in that repository remain recognizable.
