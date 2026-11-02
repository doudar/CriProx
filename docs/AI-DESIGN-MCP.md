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
