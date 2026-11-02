# Repository guidance

## Living documentation

For user-visible features, update `docs/FEATURES.md` and the relevant installation or print workflow
guide in the same change. If a feature deserves a homepage summary, update the `Why Skarix?` table
in `README.md`; the website reads that table directly. Keep the `From artwork to cut` numbered
workflow and app screenshot current when the workflow or interface changes.

The website lives in `site/` and publishes existing Markdown guides. Do not add a second copy of
feature documentation there. See `docs/WEBSITE.md` for the build, release synchronization, and Pages
setup. Website changes should pass `npm ci --prefix site`, `npm test --prefix site`, and a website
build. Use `npm run build --prefix site -- --offline` when release API access is unavailable.

Use human-readable Conventional Commit subjects and PR titles. Release Please manages version
files and `CHANGELOG.md`; do not edit them by hand. Describe the actual user-visible result in
feature and fix subjects because those subjects become the public release notes.

Keep the main GitHub release title as the version tag (for example, `v0.14.0`). Use descriptive
titles in release-note headings, website summaries, and other places that introduce the release.
Write those titles, release notes, and feature/fix subjects for people who are not developers.
Lead with what users can do or what improves for them, and use familiar language instead of
implementation terms. For example, prefer "make updates easier from inside CriProx" over
"add verified downloads and installer handoff". Keep Conventional Commit prefixes for automation,
but make the subject itself suitable for public release notes. Apply this preference when preparing
future commits, PR titles, and releases so the wording does not need to be rewritten afterward.

Website changes must never trigger an application release or appear in application release notes.
Use non-breaking `chore(site):`, `docs(site):`, or `style(site):` commits and PR titles for website
work, including screenshots and website workflows. Never use `feat(site):`, `fix(site):`, `perf(site):`,
`!`, or breaking-change footers. Keep app behavior changes in a separate PR. Release Please excludes
commits confined to `site/` and `docs/assets/`, and CI checks website PR titles as an additional guard.
