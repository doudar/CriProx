import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  repository,
  github,
  guides,
  escapeHtml as esc,
  normalizeBase,
  markdown,
  section,
  featureCards,
  cleanReleaseNotes,
  releaseHeading,
  stableReleases,
  changelogReleases,
  fetchReleases,
  publishedRelease,
} from './lib.mjs';
import { verifySite } from './verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const output = path.join(here, '_site');
const base = normalizeBase(process.env.SITE_BASE_PATH ?? '/Skarix/');
const origin = process.env.SITE_ORIGIN || 'https://doudar.github.io';
if (!/^https?:\/\/[^/]+$/.test(origin))
  throw new Error('SITE_ORIGIN must be an origin such as https://doudar.github.io.');
const url = (route) => `${base}${route}`;
const render = (text, source = 'README.md') => markdown(text, { source, base });
const readme = await readFile(path.join(root, 'README.md'), 'utf8');
const offline = process.argv.includes('--offline');
if (offline && process.env.REQUIRE_RELEASES === 'true')
  throw new Error('Offline release data is forbidden for publication.');
const releaseSource = process.env.RELEASES_FILE
  ? stableReleases(JSON.parse(await readFile(process.env.RELEASES_FILE, 'utf8')))
  : offline
    ? changelogReleases(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8'))
    : await fetchReleases({ token: process.env.GITHUB_TOKEN });
const releases = releaseSource.map(publishedRelease);
const latest = releases[0];
const latestUrl = latest?.html_url || `${github}/releases/latest`;
const date = (value) =>
  new Date(value).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
const releaseId = (release) => release.tag_name.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
const releaseHtml = (release, index) => `<article class="release" id="${esc(releaseId(release))}">
  <div class="release-meta"><a class="version" href="#${esc(releaseId(release))}" aria-label="Version ${esc(release.tag_name)}${index === 0 ? ', latest release' : ''}">${esc(release.tag_name.replace(/^v/, ''))}</a><a class="release-date" href="#${esc(releaseId(release))}" aria-label="${date(release.published_at)}, version ${esc(release.tag_name)}"><time datetime="${esc(release.published_at.slice(0, 10))}">${date(release.published_at)}</time></a></div>
  <div class="release-body prose"><h2>${esc(releaseHeading(release))}</h2>${markdown(cleanReleaseNotes(release.body || '') || 'Release notes are available on GitHub.', { base, headingPrefix: `${releaseId(release)}-` })}<a class="text-link" href="${esc(release.html_url)}">Release & downloads <span aria-hidden="true">↗</span></a></div>
</article>`;

const githubIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.64 1.22 3.28.94.1-.73.4-1.22.71-1.5-2.5-.29-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.16a10.8 10.8 0 0 1 5.64 0c2.15-1.46 3.1-1.16 3.1-1.16.61 1.55.23 2.7.11 2.98.72.79 1.16 1.8 1.16 3.02 0 4.33-2.64 5.27-5.15 5.55.4.35.76 1.03.76 2.08v3.1c0 .3.2.65.77.54A11.25 11.25 0 0 0 12 .75Z"/></svg>`;

function shell({ title, description, route, active, content }) {
  const nav = [
    ['changelog/', 'Changelog', 'changelog'],
    ['docs/', 'Docs', 'docs'],
  ];
  const brand = `<a class="brand" href="${url('')}" aria-label="Skarix home"><img src="${url('assets/favicon.svg?v=aurora')}" alt="" width="36" height="36">skarix</a>`;
  const links = nav
    .map(
      ([route, title, key]) =>
        `<a href="${url(route)}"${active === key ? ' aria-current="page"' : ''}>${title}</a>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Skarix</title><meta name="description" content="${esc(description)}"><meta name="theme-color" content="#f6f7f9">
<link rel="canonical" href="${esc(origin + url(route))}"><link rel="icon" href="${url('assets/favicon.svg?v=aurora')}" type="image/svg+xml">
<meta property="og:title" content="${esc(title)} · Skarix"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${esc(origin + url(route))}"><meta property="og:image" content="${esc(origin + url('docs/assets/skarix-home.png'))}">
<link rel="stylesheet" href="${url('assets/style.css')}"><link rel="alternate" type="application/atom+xml" title="Skarix releases" href="${url('feed.xml')}"><script src="${url('assets/nav.js')}" defer></script></head>
<body${active === 'changelog' ? ' class="changelog-page"' : ''}><a class="skip-link" href="#main">Skip to content</a><header class="header">${brand}
<nav class="desktop-navigation" aria-label="Main navigation">${links}<a href="${github}" class="github-link" aria-label="GitHub">${githubIcon}</a></nav>
<details class="mobile-navigation"><summary class="menu-toggle" aria-label="Navigation menu" aria-controls="mobile-menu"><svg class="menu-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><svg class="close-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></summary><div class="mobile-menu" id="mobile-menu"><div class="mobile-menu-heading">${brand}</div><nav aria-label="Mobile navigation">${links}<a href="${github}" class="github-link">${githubIcon}<span>GitHub</span></a></nav></div></details></header>
<main id="main">${content}</main><footer class="footer"><div>${brand}<p>Made for making. Built to stay local.</p></div><div class="footer-links"><a href="${github}">Source code</a><a href="${github}/issues">Feedback</a><a href="https://github.com/Go2Engle/CriProx">Upstream source</a><a href="${github}/blob/main/LICENSE">GPL-3.0</a></div><p class="credits">An independent, open-source project. Based on CriProx by Chris Engle and its contributors. Unaffiliated with Cricut. <a href="${url('docs/references/')}">References & credits</a>.</p></footer></body></html>`;
}

const features = featureCards(readme);
const downloads = [
  ['macOS', '.dmg', 'Apple Silicon & Intel'],
  ['Windows', '.exe', '64-bit installer'],
  ['Linux', '.AppImage', '64-bit AppImage'],
];
const home = `<section class="hero"><p class="eyebrow">OPEN SOURCE CUTTING STUDIO</p><h1>Make something<br><span>your own.</span></h1><p class="hero-description">${esc(readme.match(/<p><strong>(.*?)<\/strong><\/p>/)?.[1] || 'A local studio for artwork, labels, decals and cut-ready designs.')}</p><p class="hero-subtitle">${esc(readme.match(/<p>(Turn .*?)<\/p>/)?.[1] || 'Create editable artwork. Arrange your sheet. Bring your design to life.')}</p><div class="actions"><a class="button primary" href="#download">View downloads <span aria-hidden="true">↓</span></a><a class="button" href="${url('docs/cricut-workflow/')}">Read the print guide <span aria-hidden="true">→</span></a></div><p class="hero-note">Free & open source <span>·</span> macOS, Windows & Linux${latest ? ` <span>·</span> <a href="${url(`changelog/#${releaseId(latest)}`)}">${esc(latest.tag_name)}</a>` : ''}</p></section>
<figure class="studio-preview"><img src="${url('docs/assets/skarix-home.png')}" alt="Skarix Home with an editable starter project and local design workspace" width="1280" height="720" fetchpriority="high"><figcaption>One workspace for your artwork, sheet layout, and print files.</figcaption></figure>
<section class="section" id="features"><div class="section-heading"><p class="eyebrow">FROM IDEA TO ARTWORK</p><h2>The little details, handled.</h2><p>Create your artwork and prepare matching print and cut files in one local studio.</p></div><div class="features">${features.map((feature, index) => `<article class="feature"><span class="feature-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><h3>${esc(feature.title)}</h3>${render(feature.description)}</article>`).join('')}</div><a class="text-link" href="${url('docs/features/')}">Explore the full feature reference <span aria-hidden="true">→</span></a></section>
<section class="section workflow"><div class="section-heading"><p class="eyebrow">A SIMPLE WORKFLOW</p><h2>Build. Print. Cut. Repeat.</h2></div><div class="prose steps">${render(section(readme, 'From artwork to cut').split('\n\n')[0])}</div><aside class="note">Review generated sheets and matching contours, print at actual size, and check alignment before cutting. Optional captured templates require their original matching Design Space project. <a href="${url('docs/cricut-workflow/')}">Read the workflow guide →</a></aside></section>
<section class="section" id="download"><div class="section-heading"><p class="eyebrow">MAKE ROOM FOR YOUR NEXT IDEA</p><h2>At home on your desktop.</h2><p>${latest ? `Latest stable release: <a href="${url(`changelog/#${releaseId(latest)}`)}">${esc(latest.tag_name)}</a> · ${date(latest.published_at)}` : 'Stable desktop packages are available on GitHub.'}</p></div><div class="downloads">${downloads
  .map(([platform, extension, detail]) => {
    const asset = latest?.assets?.find((asset) => asset.name.endsWith(extension));
    return `<a class="download" href="${esc(asset?.browser_download_url || latestUrl)}"><span>${platform}</span><strong>Download <span aria-hidden="true">↗</span></strong><small>${detail}</small></a>`;
  })
  .join(
    '',
  )}</div><p class="download-note">Skarix is in development. Published v0.17.1 installers still contain the earlier CriProx interface. Current installers are unsigned. See the <a href="${url('docs/installation/')}">installation guide</a> for first-launch steps. Cricut Design Space is unavailable on Linux.</p></section>`;

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
await cp(path.join(here, 'style.css'), path.join(output, 'assets/style.css'));
await cp(path.join(here, 'nav.js'), path.join(output, 'assets/nav.js'));
await cp(path.join(root, 'public/favicon.svg'), path.join(output, 'assets/favicon.svg'));
await cp(path.join(root, 'docs/assets'), path.join(output, 'docs/assets'), { recursive: true });
const routes = [];
async function page(route, title, description, active, content) {
  const file = path.join(output, route, 'index.html');
  await mkdir(path.dirname(file), { recursive: true });
  // Intentional static-site generation: validated release metadata is escaped,
  // and Markdown is sanitized before writing to a fixed generated HTML route.
  await writeFile(file, shell({ title, description, route, active, content }));
  routes.push(route);
}
await page(
  '',
  'Open Source Cutting Studio',
  'A local studio for artwork, labels, decals and cut-ready designs. Free, open source, and available on macOS, Windows, and Linux.',
  'home',
  home,
);
await page(
  'changelog/',
  'Changelog',
  'What’s new in Skarix: additions, improvements, and fixes in every stable release.',
  'changelog',
  `<div class="changelog-intro"><h1>Changelog</h1><a class="atom-link" href="${url('feed.xml')}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1" fill="currentColor"/></svg>Atom Feed</a>${offline ? '<p class="note">Local preview from CHANGELOG.md. Published pages use GitHub’s stable releases.</p>' : ''}</div><div class="timeline">${releases.length ? releases.map(releaseHtml).join('') : '<p>No stable releases have been published yet.</p>'}</div>`,
);
await page(
  'docs/',
  'Documentation',
  'Install Skarix, create artwork, and prepare matching print and cut files.',
  'docs',
  `<div class="page-intro"><p class="eyebrow">A LITTLE GUIDANCE</p><h1>Let’s make a sheet<span>.</span></h1><p>Start here, then keep these guides nearby as you print.</p><p class="docs-note">These guides track the current project on main. For changes in a specific release, see the <a href="${url('changelog/')}">changelog</a>.</p></div><div class="guide-grid">${guides.map((guide) => `<a class="guide-card" href="${url(`docs/${guide.slug}/`)}"><h2>${esc(guide.title)} <span aria-hidden="true">↗</span></h2><p>${esc(guide.description)}</p></a>`).join('')}</div>`,
);
for (const guide of guides) {
  const content = await readFile(path.join(root, guide.file), 'utf8');
  await page(
    `docs/${guide.slug}/`,
    guide.title,
    guide.description,
    'docs',
    `<div class="docs-layout"><aside class="docs-sidebar"><p class="eyebrow">DOCUMENTATION</p><nav aria-label="Documentation">${guides.map((item) => `<a href="${url(`docs/${item.slug}/`)}"${item.slug === guide.slug ? ' aria-current="page"' : ''}>${esc(item.title)}</a>`).join('')}</nav></aside><article class="prose doc"><a class="text-link back-link" href="${url('docs/')}">← All guides</a>${render(content, guide.file)}<div class="doc-source"><p>Published from the project’s Markdown documentation.</p><a href="${github}/blob/main/${guide.file}">View source on GitHub ↗</a></div></article></div>`,
  );
}
await writeFile(
  path.join(output, '404.html'),
  shell({
    title: 'Page not found',
    description: 'This page could not be found.',
    route: '404.html',
    content: `<section class="page-intro"><p class="eyebrow">404</p><h1>This sheet is blank.</h1><p>The page may have moved.</p><a class="button primary" href="${url('')}">Back to Skarix →</a></section>`,
  }),
);
await writeFile(path.join(output, '.nojekyll'), '');
await writeFile(
  path.join(output, 'sitemap.xml'),
  `<?xml version="1.0" encoding="utf-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map((route) => `<url><loc>${esc(origin + url(route))}</loc></url>`).join('')}</urlset>`,
);
await writeFile(
  path.join(output, 'robots.txt'),
  `User-agent: *\nAllow: /\nSitemap: ${origin + url('sitemap.xml')}\n`,
);
// HTML and XML share these escapes, except apostrophes use XML's built-in entity.
const xml = (value) => esc(value).replace(/&#39;/g, '&apos;');
// Intentional Atom output, not a downloaded executable: fixed destination,
// validated ISO dates, XML-escaped metadata, and sanitized Markdown content.
await writeFile(
  path.join(output, 'feed.xml'),
  `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Skarix releases</title><id>${xml(origin + url('changelog/'))}</id><link href="${xml(origin + url('feed.xml'))}" rel="self"/><link href="${xml(origin + url('changelog/'))}"/><updated>${latest?.published_at || new Date().toISOString()}</updated><author><name>${repository.split('/')[0]}</name></author>${releases.map((release) => `<entry><title>${xml(release.name || release.tag_name)}</title><id>${xml(release.html_url)}</id><link href="${xml(origin + url(`changelog/#${releaseId(release)}`))}"/><updated>${release.published_at}</updated><content type="html">${xml(render(cleanReleaseNotes(release.body || '')))}</content></entry>`).join('')}</feed>`,
);
await verifySite(output, base);
console.log(
  `Built and verified ${routes.length} pages and ${releases.length} releases in site/_site (${offline ? 'offline preview' : 'published release data'}).`,
);
