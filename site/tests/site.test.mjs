import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markdown,
  rewriteLink,
  featureCards,
  cleanReleaseNotes,
  releaseHeading,
  stableReleases,
  changelogReleases,
  fetchReleases,
  normalizeBase,
  needsDocumentation,
  slugify,
  publishedRelease,
} from '../lib.mjs';

test('Markdown renders GFM, rebases documentation links, and removes executable content', () => {
  const html = markdown(
    '# Test\n\n[Guide](FEATURES.md#sheet-design)\n\n| A | B |\n| - | - |\n| C | D |\n\n<script>alert(1)</script><img src="x" onerror="alert(1)">\n\n[Unsafe](javascript:alert(1))',
    { source: 'docs/INSTALLATION.md', base: '/Skarix/' },
  );
  assert.match(html, /id="test"/);
  assert.match(html, /href="\/Skarix\/docs\/features\/#sheet-design"/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /<script|onerror|javascript:/);
});

test('relative links resolve from both root and nested guides for Pages or custom domains', () => {
  assert.equal(normalizeBase(), '/');
  assert.match(
    markdown('[Guide](FEATURES.md)', { source: 'docs/INSTALLATION.md' }),
    /href="\/docs\/features\/"/,
  );
  assert.equal(rewriteLink('../CONTRIBUTING.md', 'docs/FEATURES.md', '/'), '/docs/contributing/');
  assert.equal(
    rewriteLink('docs/assets/skarix-home.png', 'README.md', '/Skarix/'),
    '/Skarix/docs/assets/skarix-home.png',
  );
  assert.equal(
    rewriteLink('LICENSE', 'README.md', '/Skarix/'),
    'https://github.com/doudar/Skarix/blob/main/LICENSE',
  );
  assert.equal(
    rewriteLink('#network-access-and-offline-use', 'docs/INSTALLATION.md', '/Skarix/'),
    '#network-access-and-offline-use',
  );
  assert.throws(() => normalizeBase('https://other.site/'));
  assert.throws(() => normalizeBase('/../'));
});

test('heading extraction uses HTML sanitization and publication validates release metadata', () => {
  assert.doesNotMatch(slugify('<scrip<script>nested</script>t>unsafe'), /[<>]/);
  const release = {
    tag_name: 'v1.2.3',
    published_at: '2026-10-01T12:00:00Z',
    body: '### Features\n* New',
    assets: [],
  };
  assert.equal(publishedRelease(release).published_at, '2026-10-01T12:00:00.000Z');
  assert.throws(
    () => publishedRelease({ ...release, published_at: '<script>invalid</script>' }),
    /Invalid release/,
  );
  assert.throws(
    () =>
      publishedRelease({
        ...release,
        assets: [{ name: 'evil.dmg', browser_download_url: 'https://example.com/evil.dmg' }],
      }),
    /Installer download/,
  );
});

test('timeline categories use release-specific anchors', () => {
  assert.match(markdown('### Fixes', { headingPrefix: 'v0112-' }), /id="v0112-fixes"/);
});

test('homepage feature summaries are derived from the README table and fail on drift', () => {
  const content =
    '## Why Skarix?\n\n| | |\n| - | - |\n| ✨ **New feature** | A helpful description. |\n\n## Next\n';
  assert.deepEqual(featureCards(content), [
    { title: 'New feature', description: 'A helpful description.' },
  ]);
  assert.throws(() => featureCards('## Something else'), /missing/);
  assert.throws(() => featureCards('## Why Skarix?\nEmpty'), /missing or empty/);
});

test('release notes keep issue links and meaning while removing commit noise and duplicates', () => {
  const bullet =
    '* **print:** correct A4 layouts ([#83](https://github.com/doudar/Skarix/issues/83)) ([acc0e4f](https://github.com/doudar/Skarix/commit/acc0e4f38853445))';
  const cleaned = cleanReleaseNotes(
    `## [0.11.2](https://example.com) (2026-10-05)\n\n### Bug Fixes\n${bullet}\n${bullet}`,
  );
  assert.match(cleaned, /### Fixes/);
  assert.match(cleaned, /\*\*Print\*\*: Correct A4 layouts/);
  assert.match(cleaned, /issues\/83/);
  assert.doesNotMatch(cleaned, /acc0e4f|0\.11\.2/);
  assert.equal(cleaned.split('\n').filter((line) => line.startsWith('* ')).length, 1);
});

test('stable release selection excludes drafts and previews and sorts by publication date', () => {
  assert.deepEqual(
    stableReleases([
      { tag_name: 'draft', draft: true, published_at: '2026-10-07' },
      { tag_name: 'preview', prerelease: true, published_at: '2026-10-06' },
      { tag_name: 'old', published_at: '2026-09-01' },
      { tag_name: 'new', published_at: '2026-10-01' },
      { tag_name: 'unpublished' },
    ]).map((item) => item.tag_name),
    ['new', 'old'],
  );
});

test('release API pagination retains old releases and fails instead of silently publishing stale data', async () => {
  const calls = [];
  const firstPage = Array.from({ length: 100 }, (_, i) => ({
    tag_name: `v${i}`,
    published_at: '2026-10-01T00:00:00Z',
  }));
  const releases = await fetchReleases({
    fetchImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.headers.Accept, 'application/vnd.github+json');
      return {
        ok: true,
        json: async () =>
          calls.length === 1
            ? firstPage
            : [{ tag_name: 'old', published_at: '2026-09-01T00:00:00Z' }],
      };
    },
  });
  assert.equal(releases.length, 101);
  assert.match(calls[1], /page=2/);
  await assert.rejects(
    fetchReleases({ fetchImpl: async () => ({ ok: false, status: 403 }) }),
    /403/,
  );
});

test('offline preview parses release-please headings', () => {
  const releases = changelogReleases(
    '# Changelog\n\n## [0.11.2](https://example.com) (2026-10-05)\n\n### Bug Fixes\n* Fix\n',
  );
  assert.equal(releases[0].tag_name, 'v0.11.2');
  assert.equal(releases[0].published_at, '2026-10-05T00:00:00Z');
});

test('feature documentation gate requires a guide update and permits explicit maintainer exemptions', () => {
  const feature = { title: 'feat(export): add a new layout', files: ['src/lib/export.ts'] };
  assert.equal(needsDocumentation(feature), true);
  assert.equal(
    needsDocumentation({ ...feature, files: [...feature.files, 'docs/FEATURES.md'] }),
    false,
  );
  assert.equal(needsDocumentation({ ...feature, labels: ['documentation-not-needed'] }), false);
  assert.equal(
    needsDocumentation({ title: 'chore(deps): update tooling', files: ['package.json'] }),
    false,
  );
  assert.equal(
    needsDocumentation({ title: 'feat(site): add website', files: ['site/build.mjs'] }),
    false,
  );
});

test('release headings use custom names or existing feature subjects before fixes', () => {
  const release = {
    tag_name: 'v1.2.3',
    name: 'v1.2.3',
    body: '### Bug Fixes\n* **print:** correct A4 layouts\n\n### Features\n* **cards:** browse & sort sets ([#88](https://github.com/doudar/Skarix/pull/88))',
  };
  assert.equal(releaseHeading(release), 'Browse & sort sets');
  assert.equal(releaseHeading({ ...release, name: 'A new way to browse' }), 'A new way to browse');
  assert.equal(
    releaseHeading({
      ...release,
      name: '1.2.3',
      body: '### Bug Fixes\n* **print:** correct A4 layouts',
    }),
    'Correct A4 layouts',
  );
  assert.equal(releaseHeading({ ...release, body: '' }), 'Skarix 1.2.3');
});

test('derived release headings strip Markdown markup and executable content', () => {
  const release = {
    tag_name: 'v1.2.3',
    body: '### Features\n* **artwork:** add `PNG` &amp; **JPEG** <script>alert(1)</script>',
  };
  assert.equal(releaseHeading(release), 'Add PNG & JPEG');
  assert.equal(
    releaseHeading({ ...release, body: '### Features\n* ' + 'x'.repeat(160) }).length,
    138,
  );
});
