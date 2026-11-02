# Skarix architecture

Skarix is a React/TypeScript renderer hosted by Electron, based on CriProx.

- `src/App.tsx`: Home, navigation, settings, recents and preserved legacy exports.
- `src/components/StickerStudio.tsx`: artwork, sheets, drafts and print/cut.
- `src/lib/starter-project.ts`: editable original Skarix sticker, loaded only without a draft or on explicit request.
- `src/lib/sticker-*.ts`: validation, rendering, geometry, nesting and import/export.
- Shared print modules and `electron/cutter/`: retained output, materials, protected keys and device control.
- `electron/ai-tools.cjs` and `src/lib/ai-design.ts`: design-only MCP tools.
- `electron/release-check.cjs`: verified releases from doudar/Skarix.
- `electron/user-data-path.cjs`: select prior storage without moving files.

## Compatibility

IPC names, project discriminators, database keys, library paths and install ID remain stable. Legacy types, validators and reusable print controls support original data and shared geometry. Catalog/deck network adapters and their IPC channels are removed.

Home exports legacy projects as copies. New design recents never prune preserved legacy snapshots. Starter creation never replaces a saved draft.

## Assets

Original SVG mark, logo and icon live in `public/brand/`; `build/icon.png` is the 1024 px desktop icon. The ink/mint angular mark represents cut shapes. The starter uses equivalent editable paths and text. Preserve LICENSE, NOTICE and third-party notices.
