const { readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'release');
const installers = readdirSync(output)
  .filter((name) => /^Skarix-.*\.(exe|dmg|AppImage)$/.test(name))
  .sort();
if (!installers.length) throw new Error('No Skarix installers were produced.');
const checksums = installers.map(
  (name) =>
    createHash('sha256')
      .update(readFileSync(path.join(output, name)))
      .digest('hex') +
    '  ' +
    name,
);
writeFileSync(path.join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
writeFileSync(
  path.join(output, 'SOURCE.txt'),
  'Repository: https://github.com/doudar/Skarix\nCommit: ' +
    sha +
    '\nUnsigned preview; not a published release.\n',
);
console.log('Checksums recorded for ' + installers.length + ' installer(s) at ' + sha);
