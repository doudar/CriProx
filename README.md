<div align="center">
  <img src="build/icon.png" alt="CriProx icon" width="112" height="112">
  <h1>CriProx</h1>
  <p><strong>A local-first studio for printable card PDFs and reusable Cricut cuts.</strong></p>
  <p>Turn playtest card lists and custom artwork into precise, reusable print sheets—without an account, cloud workspace, or subscription.</p>

  <p>
    <a href="https://github.com/Go2Engle/CriProx/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Go2Engle/CriProx?style=for-the-badge&logo=github&color=7656d6"></a>
    <a href="https://github.com/Go2Engle/CriProx/actions/workflows/ci.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/Go2Engle/CriProx/ci.yml?branch=main&style=for-the-badge&label=build"></a>
    <a href="LICENSE"><img alt="GPL-3.0-only license" src="https://img.shields.io/github/license/Go2Engle/CriProx?style=for-the-badge&color=5b8def"></a>
    <a href="https://github.com/sponsors/Go2Engle"><img alt="Sponsor on GitHub" src="https://img.shields.io/badge/Sponsor_on_GitHub-ea4aaa?style=for-the-badge&logo=githubsponsors&logoColor=white"></a>
    <a href="https://ko-fi.com/go2engle"><img alt="Donate on Ko-fi" src="https://img.shields.io/badge/Donate_on_Ko--fi-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white"></a>
    <img alt="Node.js 22 or newer" src="https://img.shields.io/badge/Node.js-22%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white">
    <img alt="Supported platforms" src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-desktop-222?style=for-the-badge">
  </p>

  <p>
    <a href="https://criprox.themanamarket.com/"><strong>Website</strong></a>
    ·
    <a href="https://github.com/Go2Engle/CriProx/releases/latest"><strong>Download</strong></a>
    · <a href="docs/CRICUT-WORKFLOW.md">Print guide</a>
    · <a href="docs/FEATURES.md">Features</a>
    · <a href="CONTRIBUTING.md">Contribute</a>
  </p>
</div>

![CriProx Home with workspaces and recent projects](docs/assets/criprox-home.png)

<p align="center"><em>Choose a workspace, start a project, or continue a recent one from CriProx Home. Card imagery loads through Scryfall.</em></p>

## Why CriProx?

CriProx brings the fiddly parts of a playtest-card workflow into one focused desktop app. Import a deck list, choose printings or custom art, and preview the physical layout. Generate marked print PDFs locally, or reuse a captured template with its matching Design Space cut project.

|                              |                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 🏠 **Start from Home** | Choose Proxy Card Builder or Stickers, continue a draft, create a new project, or reopen recent local projects. |
| 🎨 **AI design with MCP** | Let an AI create editable proxy cards, original heroes, detailed sticker drawings and sheet layouts; printing and cutting remain user-only. [Setup guide](docs/AI-DESIGN-MCP.md). |
| 🔒 **Local-first**           | Projects, imported artwork, and autosaves stay on your device. No account or hosted backend.                                     |
| 📐 **Physical dimensions**   | Millimeter-based geometry, standard 63 × 88 mm cards, matched PNG/SVG output, and 300–1200 DPI export.                           |
| 🃏 **Flexible artwork**      | Search cards, browse sets, commander precons, or tokens, choose Scryfall printings or MPC Autofill community art, or use local images. |
| ✨ **Optional upscale**      | Choose high-detail local 4× enhancement for Scryfall card images when preparing a print PDF; ordinary exports use the originals. |
| ⬇️ **Guided updates**       | Browse the changelog anytime with new releases clearly marked, then download and verify the right desktop package for guided installation. |
| ✂️ **Reusable cuts**         | Capture a Design Space template once, print from CriProx, and cut with the same saved project.             |
| 🖨️ **Generate registration marks** | Create marked PDFs and matching cut coordinates for cards or freely arranged stickers, with no template capture required. |
| 🖨️ **Print directly** | Review the full page in CriProx’s print preview, choose a printer, copies, color, and duplex, then print artwork and registration marks together. |
| 🎨 **Design your own stickers** | Combine editable text, shapes, images, and drawn lines; choose color palettes, design custom blade paths, and show the cuts before filling a sheet. |
| ✅ **Compact print workflow** | Completed setup and settings collapse into summaries with green checks. Reopen any section whenever you need it.                 |
| 📐 **Manual nine-card cuts** | Print a 3×3 PDF with paper-edge guides for a trimmer, or use a matched Basic Cut PNG with a Cricut.                              |
| 🔁 **Fronts and backs**      | Export manual-refeed or alternating duplex pages; double-sided cards automatically use their matching reverse face.              |
| 💾 **Local project library** | Drag decks into subfolders, search and sort your library, keep artwork with each project, and save reusable defaults in Settings.                   |
| 🧭 **One window, two workspaces** | Cards and Stickers share the same layout: inputs and selection on the left, sheet in the center, setup on the right, with common zoom, navigation, and editing shortcuts. |
| 📐 **Machine and paper guides** | Preview layout space, sensor clearance, and the same black registration marks included in generated print PDFs. |
| 🏷️ **Automatic sticker sheets** | Trim empty margins without losing artwork, add white padding and a colored border, and nest cut shapes with edge-to-edge spacing. Manage designs from the right-click menu and fill sheets while keeping reserved corners clear. |
| 🧰 **Material manager** | Import cached Design Space materials, save custom presets, and automatically fill pressure and passes when you choose a material. |
| 🔌 **Cutter connection** | Connect an Explore 5 on Windows to scan and cut prepared sheets with Light/Medium/Hard pressure and 1–10 passes; one USB sticker-sheet run is physically validated. |
| 🔑 **Remember your cutter key** | Automatically connect from the cut page using a Windows-protected saved key; guided Design Space setup appears when a new key is needed. |

> [!IMPORTANT]
> CriProx generates and prints registration marks locally. Windows Explore 5 builds can submit their matching scan-and-cut job, and one USB sticker-sheet run at 80 g / one pass produced usable stickers. Other materials and settings still need testing. Keep generated sheets paired with their CriProx coordinates; an unrelated Design Space mat may not align. See the [print workflow](docs/CRICUT-WORKFLOW.md).

## From card list to cut

Start from **Home → Proxy Card Builder**, or choose it from the **Workspace** menu. Home also opens recent projects and creates new card or sticker projects. **Stickers** keeps its own draft in the same window. Both editors place imports and selected-item controls on the left, the preview in the center, and sheet setup on the right; click the CriProx logo to return Home.

1. **Build the sheet.** Import a Moxfield or Archidekt link, paste a deck list, search cards, browse sets, commander precons, or tokens, or add local artwork. Click a card to choose alternate artwork; MPC Autofill shows loaded choices with the highest DPI first. Right-click a card to duplicate it or fill the active sheet's empty slots with that artwork. For label batches, choose **Stickers** to import images or a grouped SVG, or **Create sticker** to design with text, shapes, images, and drawing tools, then arrange them automatically; see the [sticker workflow](docs/CRICUT-WORKFLOW.md#sticker-sheets-and-label-batches).
2. **Organize and dial in the output.** Save decks in the project library, drag them into folders, and use search to reopen them. Choose the machine, paper, layout, resolution, bleed, and optional card backs. Scroll over the preview to zoom; drag empty space or right-drag anywhere to pan. Edit your preferred setup directly in Settings and save it for future projects, or also apply it to the current deck.
3. **Generate the marks.** Open **Print then cut → Prepare print sheets**. CriProx creates all corner marks and the directional arrow with the artwork, for each sheet. Review the PDF and any clearance or printer-margin warnings.
4. **Save the matching files.** Choose a material in sheet setup or **Print then cut** to fill its pressure and passes automatically. **Manage materials** imports the local Design Space catalog and saves your custom presets. Choose **Save PDF + matching cut job** to keep the marked PDF, cut coordinates, and requested cut settings together. Card backs retain the chosen manual-refeed or duplex order.
5. **Print directly.** Use the prepared preview’s print buttons to review the page image and choose printer, copies, color, page range, and duplex. CriProx prints at actual size; **System printer settings** opens advanced driver options. Select matching paper with fit or shrink disabled. Keep every black mark and the arrow complete.
6. **Cut the printed sheet.** The cut page automatically tries your saved Explore 5 key. If a new key is needed, follow **Open Cricut Design Space**, connect there, close it, then authorize remembering the key and connect in CriProx. Choose the printed front page and confirm its mat placement and fine-point blade. **Cut sheet** measures the mat, scans the marks, and cuts the matching contours. Pause, resume, or cancel from the app. One USB sticker sheet has been validated at 80 g / one pass; the optional captured-template route uses its exact saved Design Space job.

Generated PDFs need no capture. The optional **Reuse a captured Design Space job** section preserves the existing capture workflow; its PDFs must use that saved job. See the [workflow guide](docs/CRICUT-WORKFLOW.md) for both paths and physical validation.

![Direct printing and a zoomable sticker preview in CriProx](docs/assets/criprox-print-cut.png)

CriProx also exports transparent artwork PNGs, matched vector geometry, dimensions, and a Design Space handoff guide for the separate direct PNG workflow. Those exports do not contain registration marks; use **Prepare print sheets** for locally generated marks.

Export filenames use the deck name, output paper, layout, and purpose, such as
`My-Deck-US-Letter-6-card-fronts.pdf` or `My-Deck-US-Letter-6-card-sheet-01-artwork.png`.
Reusable setup images and captured templates describe the machine and cut geometry, so they can be
shared across decks. Manual Cricut PDFs also include readable cut offsets. Existing captured
templates with older filenames still load automatically.

For higher sheet density, the experimental manual profile prints nine cards on Letter or A4 and
downloads a matched 191 × 266 mm Basic Cut PNG. It is a physical alignment workflow, not Print Then
Cut, so validate the page and mat position on plain paper first.

Selecting **Manual cutting** as the machine also uses the nine-card layout. The sheet editor previews
configurable card and page cut guides as you change their separate colors, width, placement, line style, corners,
length, and page style. The front PDF uses those guides; backs remain artwork-only. Cricut registered
layouts show their saved Design Space registration marks and exported card positions in the sheet
preview when a capture is selected. Otherwise the preview uses the locally generated mark geometry. Print at actual size
and check the dimensions before cutting.

## Download

Installers for the latest stable release are available on the [GitHub Releases page](https://github.com/Go2Engle/CriProx/releases/latest).

| Platform | Package            | Notes                                                          |
| -------- | ------------------ | -------------------------------------------------------------- |
| macOS    | Universal DMG      | Apple Silicon and Intel; currently unsigned                    |
| Windows  | x64 NSIS installer | Currently unsigned                                             |
| Linux    | x64 AppImage       | Creates exports; Cricut Design Space is not available on Linux |

### Install on macOS

1. Download the **Universal DMG** from the [latest release](https://github.com/Go2Engle/CriProx/releases/latest).
2. Open the DMG and drag **CriProx** into **Applications**.
3. Because CriProx is not yet signed or notarized, macOS may block the first launch. Only for a copy downloaded from the official repository, open Terminal and run:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/CriProx.app"
   ```

4. Open CriProx from **Applications**.

### Install on Windows

1. Download the **x64 `.exe` installer** from the [latest release](https://github.com/Go2Engle/CriProx/releases/latest).
2. Run the installer. Because CriProx is not yet code-signed, Microsoft Defender SmartScreen may display a warning. If the installer came from the official repository, select **More info**, then **Run anyway**.
3. Complete the setup wizard, then open CriProx from the Start menu or desktop shortcut.

### Update CriProx

CriProx checks for newer stable releases when the desktop app starts. Choose **Review update**
or open **Settings → Updates** to see release notes, check again, and download the right package
with progress, cancellation, retries, and SHA-256 verification. **Remind me later** snoozes the
notice for 24 hours and leaves an **Update available** reminder beside the donation button in
the bottom bar. Click it to return to Updates; it reads **Update ready** after verification.

1. Choose **Download update** and wait for verification.
2. Finish exports and save project or default changes. **Install update** saves the active workspace and closes CriProx after launching the update.
3. On macOS, choose **Install update**, drag **CriProx** from the new DMG into **Applications**, and choose **Replace**. If macOS blocks the new version, use **Copy command** and **Open Terminal** on the Updates screen before installing, then run the copied quarantine command after replacing the app.
4. On Windows, choose **Install update** and complete setup.
5. On Linux, choose **Install update** and a permanent location for the AppImage. CriProx saves and launches it, then closes the current copy.
6. Reopen CriProx. Application updates keep the managed project library. When upgrading from v0.6.0 or earlier on macOS, use **Settings → Project library → Import old library** once to copy projects from `Documents/CriProx`.

macOS app replacement and Windows setup remain interactive. Use **View release on GitHub** if a verified package
is unavailable. Existing users need one manual installation to receive the guided updater.

New releases include a `SHA256SUMS.txt` file for installer verification. See the [installation guide](docs/INSTALLATION.md) for Linux notes, troubleshooting, and local-development setup.

## Quick start for contributors

CriProx requires Node.js 22 or newer and npm.

```sh
git clone https://github.com/Go2Engle/CriProx.git
cd CriProx
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`, or run `npm run desktop` to build and launch the Electron app.

```sh
npm test          # Run geometry, parsing, rendering, and validation tests
npm run build     # Type-check and build the production renderer
npm run package   # Build an installer for the current operating system
```

## Documentation

| Guide                                        | What it covers                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Installation](docs/INSTALLATION.md)         | Desktop packages, unsigned-app notes, development, and build commands                   |
| [Feature reference](docs/FEATURES.md)        | Imports, layouts, output formats, project storage, limits, and experimental modes       |
| [Cricut workflow](docs/CRICUT-WORKFLOW.md)   | The Design Space boundary, reusable registration workflow, and physical acceptance test |
| [Software validation](docs/VALIDATION.md)    | Automated and hands-on checks already completed, plus remaining hardware validation     |
| [Architecture](docs/ARCHITECTURE.md)         | Data flow, important modules, Electron security model, and testing strategy             |
| [References and credits](docs/REFERENCES.md) | External workflow documentation, APIs, artwork sources, and project acknowledgements    |
| [Contributing](CONTRIBUTING.md)              | Development expectations, Conventional Commits, pull requests, and releases             |
| [Security](SECURITY.md)                      | Supported versions and private vulnerability reporting                                  |
| [Changelog](CHANGELOG.md)                    | User-visible changes organized by release                                               |
| [Website automation](docs/WEBSITE.md)        | GitHub Pages publishing, living documentation, and the automated release timeline       |

## Project status

CriProx is a software-tested prototype. Its layout, export, density metadata, project validation, and registered-PDF recognition are covered by automated and manual checks. Real-world sensor acquisition, printer scaling, cutter alignment, and repeatability still depend on the exact machine, calibration, printer, paper, and mat.

The six-card layout uses an experimental Tabloid setup in Design Space to capture a reusable Letter or A4 template; seven-card supports Letter only. Print the finished CriProx PDFs from a dedicated PDF application and cut with the matching saved Design Space project. The eight-card layout captures a full Tabloid PDF from Design Space and reframes its complete marked area onto the selected US Letter or A4 output paper without scaling, provided it fits with at least 1 mm clearance. The Sheet area selector shows only layouts supported by the selected paper and cutting method. Test one size-check sheet and record physical measurements before printing a full deck. The [validation record](docs/VALIDATION.md) tracks what is proven in software and what still needs hardware acceptance.

## Community

Bug reports, focused feature ideas, documentation fixes, and tested pull requests are welcome.

- [Report a bug](https://github.com/Go2Engle/CriProx/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/Go2Engle/CriProx/issues/new?template=feature_request.yml)
- [Review contribution guidelines](CONTRIBUTING.md)
- [Report a vulnerability privately](https://github.com/Go2Engle/CriProx/security/advisories/new)
- [Support CriProx development on Ko-fi](https://ko-fi.com/go2engle)

## License

CriProx is free and open-source software licensed under the [GNU General Public License v3.0 only](LICENSE). Distributed copies and derivative works must remain under the GPL, with corresponding source made available under its terms. See [NOTICE](NOTICE) for the copyright notice.

Card data and artwork are provided by Scryfall, MPC Autofill contributors, and their respective owners. CriProx is unofficial fan-made software and is not approved, endorsed, sponsored by, or affiliated with Wizards of the Coast, Cricut, Scryfall, or MPC Autofill.
