# Skarix features

Skarix — Open Source Cutting Studio — is based on CriProx by Chris Engle and its original contributors.

## Home and projects

Home offers a blank canvas, **Meet Skarix**, the continuing draft, and recent projects. The starter has a 100 × 100 mm rounded-square Aurora logo with ten editable layers: the badge, lighting, mint and coral chevrons, divider, textured wordmark and tagline. It uses no downloaded artwork.

The starter loads automatically only when no saved draft exists. Opening it explicitly preserves the previous project in Recents. Blank projects stay blank when reopened. Save portable `.skarix.json` files for durable storage.

Existing sticker projects remain readable. Legacy card projects can be exported from Home, including the last autosaved card draft even if it never appeared in Recents or the managed library. Recovery exports leave the stored draft unchanged. Their editing workspace and online catalogs are removed. User files, prior application storage and installation identifiers are preserved.

## Artwork and layout

Create text, shapes, embedded images and filled paths. Import SVG, change layer order, opacity, rotation and flipping. Editable layers are stored with projects.

The compact designer keeps shape presets behind **Add shape**. Drawing tools, canvas settings and advanced appearance controls collapse when not needed. Active appearance sections show **On**. Numeric inputs support typing and horizontal dragging.

- **Gradients:** linear or radial fills, angle and radial center/radius, up to 16 color stops with independent opacity.
- **Effects:** blur, background blur, drop shadows, inner shadows and glows. Blend modes include Multiply, Screen, Overlay and Soft Light.
- **Masks and textures:** clip artwork or groups to a shape, feather edges or fade them directionally; fill shapes and text with embedded photo tiles or seeded grain, paper, stone and brushed-metal textures.
- **Paths and text:** create cubic Bézier paths and drag their nodes/handles. Text can follow an existing shape or closed polygon with Inner, Middle or Outer placement and adjustable position along the path.
- **Layers:** group artwork, transform groups, collapse their layer rows, lock edits and hide output. Shift-click canvas objects or layer rows to align edges/centers or distribute centers evenly. Group effects apply to the combined artwork; reset those effects before ungrouping.
- **Layer organization:** name layers and nested groups, browse their hierarchy, select parent groups from breadcrumbs and inspect a zoomed close-up of a selected part. Locked groups protect descendants; ungrouping preserves hidden state.
- **Reference overlay:** embed a photo as a movable, resizable, adjustable-opacity editor guide. It is saved with the project but never printed or included in cut geometry.
- **Repeat patterns:** reuse one editable source in grids, radial patterns or seeded scatter. Variation controls rotate and fade repeated details without adding hundreds of saved layers (200 copies per source; 2,000 rendered layers per design). Fit Cut encloses all visible copies, including repeats inside transformed groups.
- **Artwork materials:** apply Painted metal, Rubber or Soft grass, or save a named procedural style for reuse across shapes/text/closed paths and group contents. Geometry and locked layers are preserved.
- **Images:** adjust exposure, contrast, saturation, temperature and sharpening without replacing the source image.
- **Grid:** show/hide the non-printing guide, choose spacing and snap drawing/movement/resizing to the grid.

The editor, previews and printed artwork share the same renderer. Appearance settings, group structure, visibility, locking and grid preferences are saved with the design and available through MCP. Hidden cut layers are omitted from cutting; visual effects do not change blade geometry.

Work in physical dimensions, arrange copies, nest layouts, and inspect pink cut contours. Artwork and blade paths can be edited separately. Image silhouettes are not automatically traced.

**Cut border** automatically updates the cut when you change border width, stroke width, color or placement. Printed strokes sit inside the cut by default, with centered and outside options. Drag numeric fields horizontally in the designer to adjust values, or click to type.

Undo/redo and clipboard shortcuts work in the active editor. Delete removes a selected design or placed copy; Undo restores it. Text inputs retain their usual shortcuts.

## Print and cut

Choose a machine, Letter or A4 paper and material settings. **Print & cut** prepares marked pages and matching contours. Inspect the preview, print at actual size, and use the matching job.

The machine selector lists individual Cricut models, including **Explore 5**, without putting the operating system in the model name. Explore 5 retains its verified USB workflow. Maker 5 has experimental direct connection and registered cutting; Joy 2 has experimental connection only. Other models remain selectable with an explanation of the missing driver or sheet format. Model-specific keys, materials and jobs cannot be substituted across cutters. Explore 5 also supports macOS BLE connection and cutting using the inspected Design Space runtime. Connection, authentication, homing and cutting have been physically tested on a Mac. See [Print & cut](CRICUT-WORKFLOW.md).

Cutters use a provider registry so other manufacturers, including Silhouette, can add their own transport, authentication and registration rules. Silhouette hardware support is not implemented yet. See [cutter providers](CUTTER-PROVIDERS.md).

## Material manager, pressure and passes

Use **Manage materials** to inspect cached Design Space materials or create local presets. Refresh preserves your edits. Projects and jobs retain selected material settings; review pressure and pass count before cutting.

## AI design and settings

Optional MCP access defaults off, remembers Start/Stop across sessions, and automatically resumes when the editor opens if left on. Copied client configuration remains reusable across app restarts. AI can edit artwork, SVG, contours, layouts and previews; it cannot print, control cutters, run shell commands or use the removed catalogs. See [AI setup](AI-DESIGN-MCP.md).

Closing the design window stops AI access and removes its local connection record without clearing the saved enabled preference. Window-close and application-quit requests wait for cleanup before exit. Windows and Linux exit after the last window closes; macOS retains its normal application lifecycle until Quit. Application quit also waits for the cutter helper to exit, with a three-second fallback termination after disconnect. A separately launched MCP client owns its own relay process.

Settings includes light/dark appearance, AI access and updates. Updates validate release origins and installer checksums from **doudar/Skarix**. Existing CriProx-named assets in that repository remain recognizable.

The macOS release workflow requires Developer ID signing and Apple notarization, and verifies the app inside the finished installer before publishing. This gives macOS a signed app identity for Bluetooth permissions and Keychain access across releases. Existing unsigned installers are not changed; local and branch-preview builds remain unsigned. Maintainers must configure the release secrets described in [Installation](INSTALLATION.md). Packaged Bluetooth and Keychain behavior still require hardware validation.

Release packaging uses the corrected signing-keychain password handling so valid certificate credentials no longer encounter the previous temporary-keychain password mismatch.

Mac release builds also fail explicitly if signing exits before installer verification finishes, preventing a misleading successful build step followed by a missing-installer upload failure.

The [Aurora logo example](../examples/README.md) demonstrates editable gradients, lighting and textures, including textures on text, created through the MCP server.

The Aurora logo appears throughout the app, README and website. **Meet Skarix** opens its editable rounded-square artwork, including the textured lettering.

Text on a closed path wraps across the 0%/100% position, keeping letters visible as they cross the start of a circle or polygon. Artwork outside the canvas or cut outline is still clipped.

The desktop app checks GitHub for newer stable releases at startup and every 15 minutes, and refreshes its cached check when you return to the app. When an update is available, an **Update [version]** button appears in the header and opens **Settings → Updates** for release notes and download options. You can also use **Check now** there. Downloads and installation remain manual.

The app and built-in MCP server use Skarix names, including exported project files and client configuration. Existing projects, drafts, and settings remain readable through migration support. Original upstream attribution is retained.

AI clients can preflight numeric design limits, inspect editor state during human edits, and explicitly save/cancel the identified draft with confirmation. Mutation guards remain in place; read-only inspection sees the last saved project.
