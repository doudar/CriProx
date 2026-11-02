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

Use `feat!:` or a `BREAKING CHANGE:` footer when a change is incompatible. `feat` produces a minor release, `fix` produces a patch release, and a breaking change produces a major release. Other commit types appear in project history but do not normally trigger a release by themselves.

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

## Releases

Release Please maintains the release pull request, application version, package lock, and changelog from commits on `main`. Do not bump those files by hand. When a maintainer merges the release pull request, GitHub Actions builds the macOS, Windows, and Linux installers, attaches them to a draft GitHub release, and publishes the release only after every build succeeds.

Repository maintainers must enable **Allow GitHub Actions to create and approve pull requests** under **Settings → Actions → General** so Release Please can maintain its release pull request.

For a feature build, run **Actions → Test installers → Run workflow** on `main` and enter the pushed feature branch in `build_branch`. The completed run holds macOS, Windows, and Linux installer artifacts for up to 30 days; share its link with testers. See the [installation guide](docs/INSTALLATION.md#test-installers-from-a-branch) for download steps and access requirements.
