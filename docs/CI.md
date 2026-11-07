# Skarix automation

The independent repository uses four workflows written for the studio:

| Workflow                  | Trigger                       | Result                                                                                                                        |
| ------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Skarix CI                 | PR, main push, manual         | Tests, renderer preservation checks, three-platform build/package validation, website preview, documentation gate, actionlint |
| Skarix code scanning      | PR, main push, weekly, manual | JavaScript/TypeScript CodeQL results                                                                                          |
| Skarix installer previews | Manual selected branch        | Unsigned Windows x64, macOS universal and Linux x64 artifacts with hashes and exact source commit                             |
| Release                   | Successful main CI, manual main | Prepare a tested version, build all three installers, then publish the complete release                                    |

PRs use pull_request rather than pull_request_target. Installer previews disable publication and use read-only tokens. Release publishing waits for successful installers on all three platforms; Apple signing secrets are scoped to the macOS release signing step. CodeQL's security-events write permission is limited to its analysis job; fork PR token restrictions remain enforced by GitHub.

Windows CI also launches the actual application with disposable storage and closes it with AI access off and on (including an open local connection). The process must exit within 15 seconds and remove its AI connection file. The probe never opens a user's profile or sends printer/cutter operations.

CI, release installers and installer previews all use the shared `artwork-test-fonts` action before running application tests. On Linux it installs DejaVu and Liberation fonts, refreshes the font cache, and sets `SKARIX_TEST_FONT` to select DejaVu Sans for the native canvas tests' Arial alias. This keeps visible-text assertions independent of the hosted runner's fallback font matching. Other platforms retain their normal fonts. A regression check verifies that all three workflows prepare fonts before testing the app.

Actions are pinned to full commit hashes. actionlint 1.7.12 is downloaded from its official release and verified against its published SHA-256 before execution. Jobs have bounded timeouts and CI cancels superseded runs.

Release Please generates version files and release notes from the exact successful main CI revision. The release workflow publishes only after every installer succeeds; failed installer runs leave the prepared version unpublished. Rerunning an old failed workflow retains its old configuration, so workflow fixes require a new run from the corrected main revision.
