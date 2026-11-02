# Skarix automation

The independent repository uses three workflows written for the studio:

| Workflow                  | Trigger                       | Result                                                                                                                        |
| ------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Skarix CI                 | PR, main push, manual         | Tests, renderer preservation checks, three-platform build/package validation, website preview, documentation gate, actionlint |
| Skarix code scanning      | PR, main push, weekly, manual | JavaScript/TypeScript CodeQL results                                                                                          |
| Skarix installer previews | Manual selected branch        | Unsigned Windows x64, macOS universal and Linux x64 artifacts with hashes and exact source commit                             |

No workflow creates releases or tags, changes permissions, or deploys Pages. No repository secrets are passed to build steps. PRs use pull_request rather than pull_request_target. Installer builds explicitly disable publication and use read-only tokens. CodeQL's security-events write permission is limited to its analysis job; fork PR token restrictions remain enforced by GitHub.

Windows CI also launches the actual application with disposable storage and closes it with AI access off and on (including an open local connection). The process must exit within 15 seconds and remove its AI connection file. The probe never opens a user's profile or sends printer/cutter operations.

Actions are pinned to full commit hashes. actionlint 1.7.12 is downloaded from its official release and verified against its published SHA-256 before execution. Jobs have bounded timeouts and CI cancels superseded runs.

The original Release Please config and version files are retained as historical tooling configuration, but no workflow executes them. A future release or website deployment requires a separately reviewed publishing workflow or manual maintainer action.
