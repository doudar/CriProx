# Print and cut with Skarix

Skarix retains CriProx's shared design, print, material, and cutting tools. Cutting has been physically tested on macOS.

## Prepare a design

1. Open **Design studio**. Use **Meet Skarix** for an editable example or import artwork.
2. Choose machine, Letter or A4 paper, and physical artwork dimensions.
3. Arrange copies, inspect **Show cuts**, and check the contours. Image silhouettes are not automatically traced.
4. Choose a material and review pressure and passes. **Manage materials** retains cached Design Space materials and local presets.

## Prepare and print

Open **Print & cut** and prepare marked sheets. Each page receives registration marks and matching contours. Inspect the PDF preview and clearance warnings.

Use matching paper, actual size/100% scale, no fit/shrink and no headers. Save the PDF and matching job together. An unrelated Design Space mat cannot substitute for Skarix's generated coordinates.

Black marks print; editor clearance guides do not. Artwork crossing marks or page edges blocks preparation. Source resolution, DPI and printer scaling all affect output quality.

## Create and refine artwork

Choose **Add shape** to open the preset picker; choosing a shape closes it. **Add text** and **Add image** stay beside it. Expand **Drawing tools & palette** for lines, polygons, freehand strokes and **Add Bézier curve**. The selected layer’s inspector shows only relevant appearance sections.

1. Expand **Gradient**, enable the fill, then choose Linear or Radial. Add color stops, adjust positions and lower stop opacity for transparent highlights. Linear angle and radial center/radius control direction.
2. Use **Effects** for blend mode, blur and shadows. Background blur softens earlier artwork in the same group; a transparent foreground fill reveals it. **Mask & clipping** contains artwork within a shape and adds feathering or an edge fade. These effects print, but do not move blade paths.
3. Use **Texture** on shapes or text (including text on a path) for seeded procedural surfaces or a tiled embedded photo. Select an image layer to reveal **Image adjustments**. Keep the original image and refine exposure, contrast, saturation, temperature or sharpening.
4. For text on a path, add a shape or closed polygon, select the text, and expand **Text on a path**. Choose the guide and Inner, Middle or Outer placement. Adjust position, alignment and font size to fit the lettering. Hiding the guide leaves the text visible; deleting it restores straight text.
5. Shift-click layer rows or canvas objects to select several. **Align & distribute** aligns to the selection bounds or spaces centers evenly. **Group selected** creates an editable group; its dimensions, rotation, masks and effects apply to the combined artwork. Select a child in Layers to edit it. Reset group effects, mask, blend and opacity before ungrouping to preserve appearance.
6. Use the eye and lock controls in **Layers** to hide output or prevent edits. Hidden artwork does not print and hidden cut paths do not cut. Unlock a layer before editing it. Group visibility and locking also apply to its children.
7. Toggle **Grid** and **Snap** above the canvas. Set spacing under **Canvas & cut settings → Grid settings**. The grid never prints. Exact values typed in fields or sent through MCP are retained; snapping applies to pointer drawing, movement and resizing.

Expand **Canvas & cut settings** when you need dimensions, background or border settings. Before saving and printing, inspect the artwork and pink cut outlines, especially after hiding cut layers.

## Adjust the cut border

In the designer, change **Cut border** to automatically fit the cut around visible artwork. Set the gap with **Border width** and the printed line thickness with **Border stroke**; a stroke of 0 hides the printed line. Choose **Inside** (default), **Centered** or **Outside** to place the printed stroke relative to the cut line. Border changes replace the previous fitted outline and printed border. You can also use **Fit Cut** after editing artwork to refit its outline.

Drag numeric fields left or right to decrease or increase values, or click and type an exact value. Review the pink cut preview before saving to the sheet.

## Direct Explore 5 cutting

The native controller supports Explore 5 over Windows USB/BLE and macOS BLE. macOS Bluetooth cutting has been physically tested. On Windows, USB is preferred and Bluetooth remains experimental. Other machine guides do not imply direct device support.

Choose the exact model in **Cutting method**. Model labels are platform-independent; the native Cricut provider uses inspected components from the installed Design Space app on Windows or macOS. Maker 5 now has experimental direct connection and registered cutting through its own runtime factory and machine-family key. It requires a Maker 5 material profile imported from Design Space or created in Manage materials. Explore 5 presets cannot be reused as Maker 5 presets automatically. Maker 5 has not been physically tested.

Joy 2 has experimental direct connection, but this Letter/A4 workflow cannot prepare its smaller registered sheets. Original Joy and retired models without Print Then Cut cannot prepare registered pages. Older Explore and Maker models, Joy Xtra and Venture need a separate legacy driver before direct connection is available. They remain selectable for external workflows. Silhouette and other manufacturers can use separate providers; no Silhouette driver is implemented yet.

1. Use the inspected Design Space setup and connect one powered-on Explore 5. If no saved key exists, follow the app's Design Space sign-in and connection flow, then close Design Space.
2. Review the printed page, contours, material, pressure and passes.
3. Secure the page face-up in portrait orientation at the upper-left of the 12 × 12 inch mat's adhesive grid, arrow toward the machine. Keep all marks visible.
4. Confirm actual-size printing, fine-point blade and mat readiness. Choose **Cut sheet**, then press the device Load button when prompted.
5. Watch registration and cutting status. Failed scans cancel instead of bypassing registration. Pause/resume and cancel remain available. Wait for completion and idle before unloading.

Prior CriProx work confirmed one full USB sticker sheet at 80 g and one pass. This does not validate every material, paper size or layout. Check alignment on inexpensive material before production.

## Captured templates and external workflows

The optional captured-template workflow retains its saved Design Space cut project. Use its corresponding template and actual-size page; it cannot be substituted for a generated-sheet direct-cut job. Artwork-only exports do not independently register a printed page.

AI can prepare artwork and layouts only. The human reviews output and operates printers/cutters.

See [features](FEATURES.md), [integration notes](EXPLORE-5-INTEGRATION.md), and the [official guide](https://help.cricut.com/hc/en-us/articles/360009387274-How-to-Print-Then-Cut-in-Design-Space).

Text on a closed path wraps across the 0%/100% position, keeping letters visible as they cross the start of a circle or polygon. Artwork outside the canvas or cut outline is still clipped.


## Building a detailed illustration

Name related layers and group logical parts (for example Frame, Wheels and Woodland). Expand
or collapse groups, follow hierarchy breadcrumbs and use **Selected part detail** to inspect
small geometry. The existing group transforms and effects still apply to the whole part.

In the designer, use **Reference overlay** for an embedded photo guide. Adjust visibility,
opacity and position while drawing; the reference is never included in print or cut output.
Save the native project to retain both the editable illustration and its reference.

Use **Repeat pattern** on a print layer for spokes, tread or foliage. Copies share one source,
so editing that source updates the pattern. Keep copies inside the intended canvas/cut contour.
A repeated print layer does not create repeated cut paths. **Artwork materials** reuse gradients,
textures and softness; they are not physical cutter material settings.

Before printing, hide the reference to judge the artwork, inspect the rendered preview and
pink cut contour, and save your project. All printing and cutting still require your normal
review and explicit actions in the app.
