# Print and cut with Skarix

Skarix retains CriProx's shared design, print, material, and cutting tools. The rebrand itself has not been physically cut-tested.

## Prepare a design

1. Open **Design studio**. Use **Meet Skarix** for an editable example or import artwork.
2. Choose machine, Letter or A4 paper, and physical artwork dimensions.
3. Arrange copies, inspect **Show cuts**, and check the contours. Image silhouettes are not automatically traced.
4. Choose a material and review pressure and passes. **Manage materials** retains cached Design Space materials and local presets.

## Prepare and print

Open **Print & cut** and prepare marked sheets. Each page receives registration marks and matching contours. Inspect the PDF preview and clearance warnings.

Use matching paper, actual size/100% scale, no fit/shrink and no headers. Save the PDF and matching job together. An unrelated Design Space mat cannot substitute for Skarix's generated coordinates.

Black marks print; editor clearance guides do not. Artwork crossing marks or page edges blocks preparation. Source resolution, DPI and printer scaling all affect output quality.

## Direct Explore 5 cutting

The native controller supports Explore 5 over Windows USB/BLE and experimental macOS BLE. USB is preferred; Bluetooth remains experimental. Other machine guides do not imply direct device support.

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
