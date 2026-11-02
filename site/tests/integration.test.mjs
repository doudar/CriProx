import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySite } from '../verify.mjs';

const site = fileURLToPath(new URL('../', import.meta.url));
test('complete build keeps current docs, uses stable installer assets, and verifies Pages links', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'criprox-site-test-'));
  const fixture = path.join(temporary, 'releases.json');
  const releases = [
    {
      tag_name: 'v1.2.3',
      name: 'v1.2.3',
      published_at: '2026-10-01T12:00:00Z',
      html_url: 'https://github.com/Go2Engle/CriProx/releases/tag/v1.2.3',
      body: '### Features\n* **artwork:** add a new image source',
      assets: [
        {
          name: 'CriProx.dmg',
          browser_download_url:
            'https://github.com/Go2Engle/CriProx/releases/download/v1.2.3/CriProx.dmg',
        },
      ],
    },
    { tag_name: 'v1.2.4-draft', draft: true, published_at: '2026-10-02T12:00:00Z' },
    { tag_name: 'v1.3.0-beta', prerelease: true, published_at: '2026-10-03T12:00:00Z' },
  ];
  try {
    await writeFile(fixture, JSON.stringify(releases));
    execFileSync(process.execPath, [path.join(site, 'build.mjs')], {
      env: {
        ...process.env,
        RELEASES_FILE: fixture,
        SITE_BASE_PATH: '/CriProx/',
        SITE_ORIGIN: 'https://example.test',
      },
    });
    const home = await readFile(path.join(site, '_site/index.html'), 'utf8');
    const timeline = await readFile(path.join(site, '_site/changelog/index.html'), 'utf8');
    const guide = await readFile(path.join(site, '_site/docs/features/index.html'), 'utf8');
    assert.match(home, /releases\/download\/v1.2.3\/CriProx.dmg/);
    assert.match(timeline, /id="v1.2.3-new"/);
    assert.doesNotMatch(timeline, /v1.2.4-draft|v1.3.0-beta/);
    assert.match(guide, /Artwork and layout/);
    assert.match(home, /<script src="\/CriProx\/assets\/nav.js" defer><\/script>/);
    assert.doesNotMatch(home, /<script(?! src=)/);
    assert.match(home, /<details class="mobile-navigation">/);
    assert.match(timeline, /<h2>Add a new image source<\/h2>/);
    assert.match(timeline, /class="version" href="#v1.2.3"/);
    assert.match(timeline, /class="atom-link"/);
    assert.match(await readFile(path.join(site, '_site/assets/nav.js'), 'utf8'), /Escape/);
    await verifySite(path.join(site, '_site'), '/CriProx/');
    // Production defaults must use the custom domain at the root, without env overrides.
    const productionEnv = { ...process.env, RELEASES_FILE: fixture };
    delete productionEnv.SITE_BASE_PATH;
    delete productionEnv.SITE_ORIGIN;
    execFileSync(process.execPath, [path.join(site, 'build.mjs')], {
      env: productionEnv,
    });
    const origin = 'https://criprox.themanamarket.com';
    const rootHome = await readFile(path.join(site, '_site/index.html'), 'utf8');
    const rootGuide = await readFile(path.join(site, '_site/docs/features/index.html'), 'utf8');
    const feed = await readFile(path.join(site, '_site/feed.xml'), 'utf8');
    const sitemap = await readFile(path.join(site, '_site/sitemap.xml'), 'utf8');
    const robots = await readFile(path.join(site, '_site/robots.txt'), 'utf8');
    assert.ok(rootHome.includes(`<link rel="canonical" href="${origin}/">`));
    assert.ok(rootHome.includes(`<meta property="og:url" content="${origin}/">`));
    assert.ok(rootHome.includes(`${origin}/docs/assets/criprox-studio.png`));
    assert.match(rootHome, /<script src="\/assets\/nav.js" defer><\/script>/);
    assert.match(rootHome, /href="\/changelog\/"/);
    assert.ok(rootGuide.includes(`<link rel="canonical" href="${origin}/docs/features/">`));
    assert.ok(feed.includes(`<link href="${origin}/feed.xml" rel="self"/>`));
    assert.ok(feed.includes(`${origin}/changelog/#v1.2.3`));
    const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    assert.ok(sitemapUrls.length > 0);
    assert.ok(
      sitemapUrls.every((url) => url.startsWith(`${origin}/`) && !url.includes('/CriProx/')),
    );
    assert.equal(robots, `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
    for (const content of [rootHome, rootGuide, feed, sitemap, robots]) {
      assert.doesNotMatch(content, /https:\/\/go2engle\.github\.io|(?:href|src)="\/CriProx\//);
    }
    await verifySite(path.join(site, '_site'), '/');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('generated-site verification rejects broken Markdown links and duplicate anchors', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'criprox-site-invalid-'));
  try {
    await writeFile(
      path.join(temporary, 'index.html'),
      '<h1 id="a">A</h1><h2 id="a">B</h2><a href="/CriProx/missing/">Missing</a><script src="/CriProx/assets/missing.js"></script>',
    );
    await assert.rejects(verifySite(temporary, '/CriProx/'), /duplicate id a[\s\S]*missing target/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
