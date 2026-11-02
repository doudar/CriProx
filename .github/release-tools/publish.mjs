import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { api, assertReleaseTarget, checksumInstallers, git, installerNames } from './lib.mjs';

const prepared = process.env.PREPARED_DIR;
const assets = process.env.ASSETS_DIR;
const metadata = JSON.parse(readFileSync(path.join(prepared, 'metadata.json'), 'utf8'));
assertReleaseTarget(metadata);
const checksums = checksumInstallers(assets, metadata.version);
const tagged = await api(`git/ref/tags/${metadata.tag}`, { allowMissing: true });
if (tagged && tagged.object.sha !== metadata.sha)
  throw new Error('Existing tag points to a different commit.');
let release = await api(`releases/tags/${metadata.tag}`, { allowMissing: true });
if (release && !release.draft) {
  console.log(`${metadata.tag} is already published; leaving its assets untouched.`);
  process.exit(0);
}
const head = await api('git/ref/heads/main');
if (!tagged && ![metadata.base, metadata.sha].includes(head.object.sha)) {
  console.log('Main advanced while building; its CI run will release the newer revision.');
  process.exit(0);
}
if (!tagged) {
  git('tag', metadata.tag, metadata.sha);
  // Only this job has write access. gh reads GH_TOKEN without storing credentials.
  git(
    '-c',
    'credential.helper=',
    '-c',
    'credential.helper=!gh auth git-credential',
    'push',
    '--atomic',
    'origin',
    `${metadata.sha}:refs/heads/main`,
    `refs/tags/${metadata.tag}`,
  );
}
const notes = readFileSync(path.join(prepared, 'notes.md'), 'utf8');
if (!release) {
  release = await api('releases', {
    method: 'POST',
    body: JSON.stringify({
      tag_name: metadata.tag,
      target_commitish: metadata.sha,
      name: metadata.tag,
      body: notes,
      draft: true,
      prerelease: false,
    }),
  });
}
writeFileSync(path.join(assets, 'SHA256SUMS.txt'), checksums);
writeFileSync(
  path.join(assets, 'SOURCE.txt'),
  `Repository: https://github.com/${process.env.GITHUB_REPOSITORY}\nCommit: ${metadata.sha}\nCI source: ${metadata.base}\nUnsigned installers.\n`,
);
execFileSync(
  'gh',
  [
    'release',
    'upload',
    metadata.tag,
    ...[...installerNames(metadata.version), 'SHA256SUMS.txt', 'SOURCE.txt'].map((name) =>
      path.join(assets, name),
    ),
    '--clobber',
  ],
  { stdio: 'inherit' },
);
const uploaded = await api(`releases/${release.id}/assets?per_page=100`);
for (const name of [...installerNames(metadata.version), 'SHA256SUMS.txt', 'SOURCE.txt']) {
  const matches = uploaded.filter((asset) => asset.name === name && asset.state === 'uploaded');
  if (matches.length !== 1 || matches[0].size !== readFileSync(path.join(assets, name)).length) {
    throw new Error(`Missing or incomplete release asset: ${name}`);
  }
}
await api(`releases/${release.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ name: metadata.tag, body: notes, draft: false, make_latest: 'legacy' }),
});
console.log(
  `Published https://github.com/${process.env.GITHUB_REPOSITORY}/releases/tag/${metadata.tag}`,
);
