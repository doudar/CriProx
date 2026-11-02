import path from 'node:path';
import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { Parser } from 'htmlparser2';

export const repository = 'Go2Engle/CriProx';
export const github = `https://github.com/${repository}`;
export const guides = [
  {
    file: 'docs/INSTALLATION.md',
    slug: 'installation',
    title: 'Installation',
    description: 'Downloads, first launch, updates, and troubleshooting.',
  },
  {
    file: 'docs/FEATURES.md',
    slug: 'features',
    title: 'Feature reference',
    description: 'Artwork, sheet layouts, exports, and local projects.',
  },
  {
    file: 'docs/CRICUT-WORKFLOW.md',
    slug: 'cricut-workflow',
    title: 'Print & cut guide',
    description: 'One-time template setup, PDF printing, and saved Design Space cuts.',
  },
  {
    file: 'docs/VALIDATION.md',
    slug: 'validation',
    title: 'Validation',
    description: 'Software checks and remaining physical testing.',
  },
  {
    file: 'docs/ARCHITECTURE.md',
    slug: 'architecture',
    title: 'Architecture',
    description: 'How the desktop app works, for contributors.',
  },
  {
    file: 'docs/REFERENCES.md',
    slug: 'references',
    title: 'References & credits',
    description: 'Artwork sources, external services, and acknowledgements.',
  },
  {
    file: 'CONTRIBUTING.md',
    slug: 'contributing',
    title: 'Contributing',
    description: 'Development, pull requests, and the release process.',
  },
  {
    file: 'SECURITY.md',
    slug: 'security',
    title: 'Security',
    description: 'Supported versions and private vulnerability reporting.',
  },
  {
    file: 'docs/WEBSITE.md',
    slug: 'website',
    title: 'Website maintenance',
    description: 'How this site and its release timeline stay up to date.',
  },
];

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

export function normalizeBase(value = '/') {
  if (
    !/^\/(?:[\w.-]+\/)*$/.test(value) ||
    value.split('/').some((segment) => segment === '.' || segment === '..')
  )
    throw new Error('SITE_BASE_PATH must be / or a path such as /CriProx/.');
  return value;
}

export function slugify(text) {
  return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} })
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

// Validate the API boundary before any remote fields reach static output.
export function publishedRelease(release) {
  if (!/^v?\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?$/.test(release.tag_name)) {
    throw new Error('Unexpected stable release tag.');
  }
  const published = new Date(release.published_at);
  if (!Number.isFinite(published.getTime())) throw new Error('Invalid release publication date.');
  if (release.body != null && typeof release.body !== 'string')
    throw new Error('Invalid release notes.');
  if (release.name != null && typeof release.name !== 'string')
    throw new Error('Invalid release title.');
  const assets = (release.assets || []).map((asset) => {
    const download = new URL(asset.browser_download_url);
    if (
      download.origin !== 'https://github.com' ||
      !download.pathname.startsWith(`/${repository}/releases/download/`)
    ) {
      throw new Error('Installer download must belong to this GitHub repository.');
    }
    return { name: String(asset.name), browser_download_url: download.href };
  });
  return {
    tag_name: release.tag_name,
    name: release.name || release.tag_name,
    published_at: published.toISOString(),
    body: release.body || '',
    html_url: `${github}/releases/tag/${encodeURIComponent(release.tag_name)}`,
    assets,
  };
}

export function rewriteLink(href, source, base) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return href;
  const [pathname, hash] = href.split('#');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), pathname));
  const suffix = hash ? `#${hash}` : '';
  const guide = guides.find((item) => item.file === resolved);
  if (guide) return `${base}docs/${guide.slug}/${suffix}`;
  if (resolved === 'README.md') return `${base}${suffix}`;
  if (resolved === 'CHANGELOG.md') return `${base}changelog/${suffix}`;
  if (resolved.startsWith('docs/assets/')) return `${base}${resolved}${suffix}`;
  return `${github}/blob/main/${resolved}${suffix}`;
}

export function markdown(content, { source = 'README.md', base = '/', headingPrefix = '' } = {}) {
  const headings = new Map();
  const parser = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type === 'link' || token.type === 'image')
        token.href = rewriteLink(token.href, source, base);
    },
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const slug = slugify(text);
        const count = headings.get(slug) || 0;
        headings.set(slug, count + 1);
        return `<h${depth} id="${escapeHtml(headingPrefix)}${slug}${count ? `-${count}` : ''}">${text}</h${depth}>\n`;
      },
    },
  });
  return sanitizeHtml(parser.parse(content), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['id'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      code: ['class'],
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
  });
}

export function section(content, heading) {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line === `## ${heading}`);
  if (start < 0) throw new Error(`README is missing the "${heading}" section used by the website.`);
  const next = lines.findIndex((line, index) => index > start && /^## /.test(line));
  return lines
    .slice(start + 1, next < 0 ? undefined : next)
    .join('\n')
    .trim();
}

export function featureCards(readme) {
  const table = new Marked()
    .lexer(section(readme, readme.includes('## Why Skarix?') ? 'Why Skarix?' : 'Why CriProx?'))
    .find((token) => token.type === 'table');
  if (!table || !table.rows.length)
    throw new Error('The Why CriProx? feature table is missing or empty.');
  return table.rows.map((row) => ({
    title: row[0].text.replace(/\*\*/g, '').replace(/^[^\p{L}\p{N}]+/u, ''),
    description: row[1].text,
  }));
}

export function cleanReleaseNotes(body) {
  return body
    .replace(/^##? \[?v?\d+\.\d+\.\d+[^\n]*\n?/m, '')
    .replace(/\s*\(\[[a-f\d]{7,40}\]\(https:\/\/github\.com\/[^)]+\/commit\/[^)]+\)\)/gi, '')
    .replace(/^### (?:Features|New Features)\s*$/gm, '### New')
    .replace(/^### Bug Fixes\s*$/gm, '### Fixes')
    .replace(
      /^### (?:Performance Improvements|Miscellaneous Chores|Code Refactoring)\s*$/gm,
      '### Improvements',
    )
    .replace(
      /^(\s*[-*] )\*\*([^*]+):\*\*\s*/gm,
      (_, prefix, scope) => `${prefix}**${scope.charAt(0).toUpperCase()}${scope.slice(1)}**: `,
    )
    .replace(
      /^(\s*[-*] (?:\*\*[^*]+\*\*: )?)([a-z])/gm,
      (_, prefix, letter) => prefix + letter.toUpperCase(),
    )
    .split('\n')
    .filter((line, index, lines) => !/^[-*] /.test(line) || lines.indexOf(line) === index)
    .join('\n')
    .trim();
}

export function releaseHeading(release) {
  const version = release.tag_name.replace(/^v/, '');
  const name = release.name?.trim();
  if (name && name !== release.tag_name && name !== version) return name;
  const tokens = new Marked().lexer(cleanReleaseNotes(release.body || ''));
  const newSection = tokens.findIndex((token) => token.type === 'heading' && token.text === 'New');
  const list = (newSection >= 0 ? tokens.slice(newSection + 1) : tokens).find(
    (token) => token.type === 'list',
  );
  const subject = list?.items[0]?.text.replace(/^\*\*[^*]+\*\*:\s*/, '') || '';
  let text = '';
  new Parser({
    ontext(value) {
      text += value;
    },
  }).end(markdown(subject));
  text = text.replace(/\s+/g, ' ').trim();
  // Drop an issue suffix from the headline; its link remains in the release notes.
  const issue = text.lastIndexOf(' (#');
  if (issue >= 0 && /^\d+\)$/.test(text.slice(issue + 3))) text = text.slice(0, issue);
  if (!text) return `CriProx ${version}`;
  if (text.length > 140) text = text.slice(0, 137).trimEnd() + '…';
  return text;
}

export function stableReleases(releases) {
  if (!Array.isArray(releases)) throw new Error('The release API must return an array.');
  return releases
    .filter((release) => !release.draft && !release.prerelease && release.published_at)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
}

export function changelogReleases(content) {
  return content
    .split(/(?=^## \[\d)/m)
    .slice(1)
    .map((chunk) => {
      const match = chunk.match(/^## \[([^\]]+)\]\([^)]+\) \((\d{4}-\d{2}-\d{2})\)/);
      if (!match) throw new Error('Unexpected CHANGELOG.md release heading.');
      return {
        tag_name: `v${match[1]}`,
        name: `v${match[1]}`,
        published_at: `${match[2]}T00:00:00Z`,
        body: chunk,
        html_url: `${github}/releases/tag/v${match[1]}`,
        assets: [],
      };
    });
}

export async function fetchReleases({ token, fetchImpl = fetch } = {}) {
  const all = [];
  for (let page = 1; ; page++) {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'CriProx-site',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new Error(
        `GitHub releases request failed (${response.status}); refusing to publish stale release data.`,
      );
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error('Unexpected GitHub releases response.');
    all.push(...releases);
    if (releases.length < 100) return stableReleases(all);
  }
}

export function needsDocumentation({ title, files, labels = [] }) {
  const feature = /^feat(?:\([^)]*\))?!?:/.test(title);
  const appChanged = files.some((file) => /^(src\/|electron\/|public\/)/.test(file));
  const docsChanged = files.some((file) => file === 'README.md' || /^docs\/.+\.md$/.test(file));
  return feature && appChanged && !docsChanged && !labels.includes('documentation-not-needed');
}
