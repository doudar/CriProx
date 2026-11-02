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

The machine selector lists individual Cricut models, including **Explore 5**, without putting the operating system in the model name. Explore 5 retains its verified USB workflow. Maker 5 has experimental direct connection and registered cutting; Joy 2 has experimental connection only. Other models remain selectable with an explanation of the missing driver or sheet format. Model-specific keys, materials and jobs cannot be substituted across cutters. Explore 5 also supports experimental macOS BLE connection and cutting using the inspected Design Space runtime. Connection, authentication and homing were physically verified on a Mac; registration, cutting, pause/resume and cancellation remain untested on Mac hardware. See [Print & cut](CRICUT-WORKFLOW.md).

Cutters use a provider registry so other manufacturers, including Silhouette, can add their own transport, authentication and registration rules. Silhouette hardware support is not implemented yet. See [cutter providers](CUTTER-PROVIDERS.md).

## Material manager, pressure and passes

Use **Manage materials** to inspect cached Design Space materials or create local presets. Refresh preserves your edits. Projects and jobs retain selected material settings; review pressure and pass count before cutting.

## AI design and settings

Optional MCP access starts off each launch. AI can edit artwork, SVG, contours, layouts and previews; it cannot print, control cutters, run shell commands or use the removed catalogs. See [AI setup](AI-DESIGN-MCP.md).

Closing the design window stops AI access and removes its local connection record. Window-close and application-quit requests wait for the same cleanup operation. Windows and Linux exit after the last window closes; macOS retains its normal application lifecycle until Quit. Application quit also waits for the cutter helper to exit, with a three-second fallback termination after disconnect. A separately launched MCP client owns its own relay process.

Settings includes light/dark appearance, AI access and updates. Updates validate release origins and installer checksums from **doudar/Skarix**. Existing CriProx-named assets in that repository remain recognizable.
