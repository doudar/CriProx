# Contributing to Skarix

Thank you for contributing. Bug reports, focused feature proposals, documentation improvements, and tested code changes are welcome.

## Development

Skarix requires Node.js 22 or newer and npm.

```sh
npm ci
npm test
npm run build
npm run desktop
```

Keep changes focused, preserve the renderer's Electron sandbox boundary, and add tests when behavior changes. Do not include copyrighted card artwork, private project files, secrets, or generated installer files in a pull request.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/) for commits and pull request titles. Common examples are:

```text
feat(export): add a print option
fix(layout): keep rotated cards inside the sheet
docs: clarify the Cricut handoff
chore(deps): update Electron
```

Use `feat!:` or a `BREAKING CHANGE:` footer when a change is incompatible. `feat` describes a minor change, `fix` a patch, and a breaking change a major version boundary; publication remains a separate maintainer decision. Other commit types appear in project history but do not normally trigger a release by themselves.

Pull requests should describe the implementation, validation, and any user-facing or compatibility impact. A maintainer may squash-merge a pull request, so its title must also be a valid Conventional Commit.

Website updates must use non-breaking `chore(site):`, `docs(site):`, or `style(site):` commits and
PR titles. Do not use `feat`, `fix`, `perf`, or breaking-change footers for website work; the site
publishes independently and must not trigger app releases or add app release notes. Keep application
behavior changes in a separate PR. Release Please excludes commits confined to `site/` and
`docs/assets/`; CI also rejects release-triggering website PR titles, including changes to the
website workflow or shared README alongside website files.

For user-facing features, update the feature reference or relevant guide in the same pull request.
Update the README feature table when a capability belongs on the homepage. The website publishes
these sources automatically, and CI checks that feature PRs include a documentation update.
Write commit subjects as readable release notes. See [website and living documentation](docs/WEBSITE.md)
for the source mapping, documentation-check exemption, and local website preview commands.

By submitting a contribution, you agree to license it under the project's GNU General Public License v3.0 only and confirm that you have the right to do so.

## CI and installer previews

Skarix CI tests and builds the studio on Windows, macOS and Linux, checks desktop packaging, and verifies the Windows Electron renderer and existing-project preservation. It also tests the website, builds an offline preview, checks feature documentation and validates all workflows with a pinned, checksum-verified actionlint. Code scanning analyzes JavaScript and TypeScript separately.

All workflows use pinned action revisions and fresh hosted runners. Build jobs have read-only repository access, checkouts do not retain credentials, and pull requests never publish packages, releases or Pages. The code-scanning job has only its additional security-results permission.

After the workflow is on the default branch, select **Actions → Skarix installer previews → Run workflow** and choose the branch to build. It packages the selected commit for Windows x64, macOS universal and Linux x64, and uploads unsigned artifacts for 14 days with SHA256SUMS.txt and SOURCE.txt. The workflow never creates a tag, overwrites release assets, or publishes a release.

The inherited automatic Release Please/publishing and Pages deployment workflows have been removed. Existing version files and changelog remain intact; this change publishes no release. A maintainer must separately approve and prepare a release and its version changes. Website publication likewise requires a separate reviewed deployment setup.

Funding is copied from [doudar/.github/FUNDING.yml](https://github.com/doudar/.github/blob/main/FUNDING.yml): GitHub Sponsors doudar, Buy Me a Coffee anthonydouv, and the existing SmartSpin2K PayPal URL.
