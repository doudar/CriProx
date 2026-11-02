import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export async function api(route, options = {}) {
  const response = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${route}`,
    {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    },
  );
  if (response.status === 404 && options.allowMissing) return null;
  if (!response.ok) throw new Error(`GitHub ${route}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

export function installerNames(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable release version.');
  return [
    `Skarix-${version}-win-x64.exe`,
    `Skarix-${version}-mac-universal.dmg`,
    `Skarix-${version}-linux-x64.AppImage`,
  ];
}

export function checksumInstallers(directory, version) {
  const expected = installerNames(version).sort();
  const actual = readdirSync(directory).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected exactly the three versioned installers; received: ${actual.join(', ')}`,
    );
  }
  return expected
    .map((name) => {
      const bytes = readFileSync(path.join(directory, name));
      if (!bytes.length) throw new Error(`Empty installer: ${name}`);
      return `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`;
    })
    .join('');
}

export function assertReleaseTarget(metadata) {
  if (!/^[a-f0-9]{40}$/.test(metadata.base) || !/^[a-f0-9]{40}$/.test(metadata.sha)) {
    throw new Error('Invalid release source revision.');
  }
  installerNames(metadata.version);
  if (metadata.tag !== `v${metadata.version}`) throw new Error('Release tag/version mismatch.');
  if (git('rev-parse', 'HEAD') !== metadata.sha || git('rev-parse', 'HEAD^') !== metadata.base) {
    throw new Error('Prepared release commit does not match its source.');
  }
  const changed = git('diff', '--name-only', `${metadata.base}..HEAD`).split('\n').sort();
  const allowed = [
    '.release-please-manifest.json',
    'CHANGELOG.md',
    'package-lock.json',
    'package.json',
  ].sort();
  if (JSON.stringify(changed) !== JSON.stringify(allowed))
    throw new Error('Unexpected release commit files.');
  for (const file of ['package.json', 'package-lock.json']) {
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (
      pkg.version !== metadata.version ||
      (pkg.packages && pkg.packages[''].version !== metadata.version)
    ) {
      throw new Error(`Version mismatch in ${file}`);
    }
  }
  if (JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'))['.'] !== metadata.version) {
    throw new Error('Release manifest version mismatch.');
  }
}
