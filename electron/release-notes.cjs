const { Marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const { Parser } = require('htmlparser2');

// Match the website's cleanReleaseNotes/releaseHeading rules. Parity tests cover
// every entry in CHANGELOG.md so the desktop presentation does not drift.
function cleanReleaseNotes(body) {
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

function isReleaseNotesUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ((url.hostname === 'github.com' && /^\/doudar\/Skarix(?:\/|$)/.test(url.pathname)) ||
        url.hostname === 'criprox.themanamarket.com')
    );
  } catch {
    return false;
  }
}

function resolveLink(value) {
  if (!value) return '';
  try {
    const url = new URL(value, 'https://github.com/doudar/Skarix/blob/main/');
    return isReleaseNotesUrl(url.href) ? url.href : '';
  } catch {
    return '';
  }
}

function releaseNotesHtml(body, version) {
  const headings = new Map();
  const prefix = `update-${version.replace(/[^a-z0-9._-]/gi, '-')}-`;
  const parser = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const slug = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} })
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, '')
          .trim()
          .replace(/\s/g, '-');
        const count = headings.get(slug) || 0;
        headings.set(slug, count + 1);
        const id = `${prefix}${slug}${count ? `-${count}` : ''}`;
        const level = Math.min(6, depth + 2);
        return `<h${level} id="${id}">${text}</h${level}>\n`;
      },
    },
  });
  return sanitizeHtml(parser.parse(body), {
    allowedTags: sanitizeHtml.defaults.allowedTags,
    allowedAttributes: { a: ['href', 'title'], '*': ['id'] },
    allowedSchemes: ['https'],
    allowProtocolRelative: false,
    transformTags: {
      '*': (tagName, attributes) => {
        if (attributes.id && !attributes.id.startsWith(prefix))
          attributes.id = prefix + attributes.id.replace(/[^a-z0-9._-]/gi, '-');
        return { tagName, attribs: attributes };
      },
      a: (_tag, attributes) => {
        const href = resolveLink(attributes.href || '');
        return { tagName: href ? 'a' : 'span', attribs: href ? { href } : {} };
      },
    },
  });
}

function releaseHeading({ version, name, body }) {
  if (name?.trim() && name.trim() !== version && name.trim() !== `v${version}`) return name.trim();
  const tokens = new Marked().lexer(body);
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
  }).end(releaseNotesHtml(subject, version));
  text = text.replace(/\s+/g, ' ').trim();
  const issue = text.lastIndexOf(' (#');
  if (issue >= 0 && /^\d+\)$/.test(text.slice(issue + 3))) text = text.slice(0, issue);
  if (!text) return `Skarix ${version}`;
  return text.length > 140 ? text.slice(0, 137).trimEnd() + '…' : text;
}

function formatReleaseNotes({ version, name, body }) {
  const cleaned = cleanReleaseNotes(body);
  return {
    releaseHeading: releaseHeading({ version, name, body: cleaned }),
    releaseNotesHtml: releaseNotesHtml(
      cleaned || 'Release notes are available on GitHub.',
      version,
    ),
  };
}

module.exports = { cleanReleaseNotes, formatReleaseNotes, isReleaseNotesUrl };
