import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { cleanReleaseNotes, formatReleaseNotes, isReleaseNotesUrl } =
  require('../electron/release-notes.cjs') as {
    cleanReleaseNotes: (body: string) => string;
    formatReleaseNotes: (release: { version: string; name?: string; body: string }) => {
      releaseHeading: string;
      releaseNotesHtml: string;
    };
    isReleaseNotesUrl: (value: string) => boolean;
  };

test('desktop changelog cleanup and headings match the website for every existing release', async () => {
  const site = await import(new URL('../site/lib.mjs', import.meta.url).href);
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  for (const release of site.changelogReleases(changelog)) {
    const desktop = formatReleaseNotes({
      version: release.tag_name.replace(/^v/, ''),
      name: release.name,
      body: release.body,
    });
    assert.equal(cleanReleaseNotes(release.body), site.cleanReleaseNotes(release.body));
    assert.equal(desktop.releaseHeading, site.releaseHeading(release));
    assert.doesNotMatch(desktop.releaseNotesHtml, /\/commit\//);
  }
});

test('release notes render category headings, lists, emphasis, code, and issue links', () => {
  const body =
    '### Features\n\n* **updates:** add `downloads` ([#98](https://github.com/doudar/Skarix/issues/98))\n\n### Bug Fixes\n\n* retry downloads\n\n### Performance Improvements\n\n* background work';
  const { releaseNotesHtml: html, releaseHeading } = formatReleaseNotes({
    version: '0.14.0',
    body,
  });
  assert.equal(releaseHeading, 'Add downloads');
  assert.match(html, /id="update-0.14.0-new"/);
  assert.match(html, /id="update-0.14.0-fixes"/);
  assert.match(html, /id="update-0.14.0-improvements"/);
  assert.match(html, /<ul>/);
  assert.match(html, /<strong>Updates<\/strong>: Add <code>downloads<\/code>/);
  assert.match(html, /href="https:\/\/github.com\/doudar\/Skarix\/issues\/98"/);
});

test('custom release announcements keep their formatting and issue link on desktop and website', async () => {
  const site = await import(new URL('../site/lib.mjs', import.meta.url).href);
  const body = `### In-app updates are here

Skarix now lets you review release notes, download updates, and launch the installer from **Settings → Updates**.

Please install this release manually once to enable the new updater. If you encounter any problems with in-app updates, please [open a GitHub issue](https://github.com/doudar/Skarix/issues/new/choose) and include your operating system, Skarix version, and what happened.

### Features

* **updates:** add verified downloads and installer handoff`;
  const desktop = formatReleaseNotes({ version: '0.14.0', body });
  const website = site.markdown(site.cleanReleaseNotes(body), { headingPrefix: 'release-0.14.0-' });
  for (const html of [desktop.releaseNotesHtml, website]) {
    assert.match(html, /<h[1-6][^>]*>In-app updates are here<\/h[1-6]>/);
    assert.match(html, /<strong>Settings → Updates<\/strong>/);
    assert.match(html, /<p>Please install this release manually once/);
    assert.match(html, /href="https:\/\/github.com\/doudar\/Skarix\/issues\/new\/choose"/);
    assert.match(html, />open a GitHub issue<\/a>/);
    assert.doesNotMatch(html, /\*\*Settings|\[open a GitHub issue\]/);
  }
  assert.equal(desktop.releaseHeading, 'Add verified downloads and installer handoff');
});

test('rendered release notes remove executable content and unsafe links', () => {
  const body =
    '### Features\n\n* new **art** <script>alert(1)</script>\n\n<img src="https://evil.example/tracker" onerror="alert(1)">\n<iframe src="https://evil.example"></iframe>\n<a href="javascript:alert(1)" onclick="alert(1)">Bad</a>\n\n[Unsafe](file:///tmp/installer)\n\n[Other repo](https://github.com/other/repo)\n\n[Guide](docs/INSTALLATION.md)';
  const result = formatReleaseNotes({
    version: '0.14.0',
    body: body + '<h3 id="update-progress">Extra section</h3>',
  });
  assert.doesNotMatch(
    result.releaseNotesHtml,
    /<script|<iframe|<img|onclick|onerror|javascript:|file:|evil.example|href="https:\/\/github.com\/other/,
  );
  assert.match(
    result.releaseNotesHtml,
    /href="https:\/\/github.com\/doudar\/Skarix\/blob\/main\/docs\/INSTALLATION.md"/,
  );
  assert.equal(result.releaseHeading, 'New art');
  assert.doesNotMatch(result.releaseNotesHtml, /id="update-progress"/);
  assert.match(result.releaseNotesHtml, /id="update-0.14.0-update-progress"/);
  assert.equal(isReleaseNotesUrl('https://github.com/doudar/Skarix/issues/98'), true);
  for (const url of [
    'file:///tmp/a',
    'https://github.com.evil.example/doudar/Skarix/issues/98',
    'https://github.com/doudar/Skarix-other',
    'https://evil:password@github.com/doudar/Skarix',
    'https://github.com:8080/doudar/Skarix',
  ])
    assert.equal(isReleaseNotesUrl(url), false);
});

test('release headings respect names, limit long titles, and have an empty-notes fallback', () => {
  assert.equal(
    formatReleaseNotes({ version: '0.14.0', name: 'Guided updates', body: '' }).releaseHeading,
    'Guided updates',
  );
  assert.equal(
    formatReleaseNotes({ version: '0.14.0', name: 'v0.14.0', body: '' }).releaseHeading,
    'Skarix 0.14.0',
  );
  assert.match(
    formatReleaseNotes({ version: '0.14.0', body: '' }).releaseNotesHtml,
    /Release notes are available/,
  );
  assert.ok(
    formatReleaseNotes({ version: '0.14.0', body: '### Features\n* ' + 'x'.repeat(160) })
      .releaseHeading.length <= 140,
  );
});
