# Skarix website

The static website lives in `site/` and reads the README, Markdown guides and published releases from **doudar/Skarix**. It is separate from the Electron package.

## Build and preview

```sh
npm ci --prefix site
npm test --prefix site
npm run build --prefix site -- --offline
npm run preview --prefix site
```

Preview the default repository path at http://127.0.0.1:4174/Skarix/. Offline mode uses bundled changelog data and is for local review; published builds fetch current GitHub releases and exclude drafts/prereleases.

Defaults are `SITE_ORIGIN=https://doudar.github.io` and `SITE_BASE_PATH=/Skarix/`. Override both for another destination. This change does not enable Pages, change DNS, or deploy a website. Skarix CI builds an offline preview artifact; the inherited automatic Pages workflow has been removed. A maintainer must separately review and configure deployment before publishing.

## Sources of truth

- Introduction, feature table and workflow: README.md.
- Guides: docs/*.md, CONTRIBUTING.md and SECURITY.md.
- Release downloads: published doudar/Skarix assets.
- Branding: public/favicon.svg and docs/assets/skarix-home.png.

The footer credits CriProx, Chris Engle and the original contributors. Historical release notes retain their original content.

Keep website changes in separate non-breaking chore(site), docs(site), or style(site) pull requests so they do not create application releases.

The header, footer and favicon use the Aurora badge shared with the app. Regenerate shared assets with `node --import tsx scripts/generate-brand.ts` before rebuilding the website.
