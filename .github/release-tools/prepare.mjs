import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GitHub, Manifest } from 'release-please';
import { api, assertReleaseTarget, git } from './lib.mjs';

const base = process.env.BASE_SHA;
function savePrepared(metadata, notes) {
  assertReleaseTarget(metadata);
  const output = process.env.PREPARED_DIR;
  mkdirSync(output, { recursive: true });
  git('bundle', 'create', path.join(output, 'release.bundle'), `${base}..HEAD`);
  writeFileSync(path.join(output, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  writeFileSync(path.join(output, 'notes.md'), notes + '\n');
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `created=true\nsha=${metadata.sha}\ntag=${metadata.tag}\n`,
  );
}
if (!/^[a-f0-9]{40}$/.test(base) || git('rev-parse', 'HEAD') !== base) {
  throw new Error('Check out the exact CI-tested revision.');
}
const runs = await api(
  `actions/workflows/skarix-ci.yml/runs?head_sha=${base}&event=push&status=success&per_page=100`,
);
if (
  !runs.workflow_runs.some(
    (run) => run.head_branch === 'main' && run.head_sha === base && run.conclusion === 'success',
  )
) {
  throw new Error('This revision has not passed Skarix CI on main.');
}
const startingHead = (await api('git/ref/heads/main')).object.sha;
if (startingHead !== base) {
  // Resume an interrupted publication using the exact commit already pushed,
  // including on a later day when freshly generated notes would have a new date.
  git('fetch', 'origin', startingHead);
  if (
    git('rev-parse', `${startingHead}^`) === base &&
    /^chore\(main\): release \d+\.\d+\.\d+$/.test(git('show', '-s', '--format=%s', startingHead))
  ) {
    git('checkout', '--detach', startingHead);
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    const metadata = { base, sha: startingHead, version, tag: `v${version}` };
    const release = await api(`releases/tags/${metadata.tag}`, { allowMissing: true });
    if (!release || release.draft) {
      const changelog = readFileSync('CHANGELOG.md', 'utf8');
      const notes = changelog
        .slice(changelog.indexOf(`## [${version}]`))
        .split(/\n## \[/)[0]
        .trim();
      if (!notes.startsWith(`## [${version}]`)) throw new Error('Missing generated release notes.');
      savePrepared(metadata, notes);
      process.exit(0);
    }
  }
  console.log('Main has advanced or this release is already published; no release needed.');
  appendFileSync(process.env.GITHUB_OUTPUT, 'created=false\n');
  process.exit(0);
}
// The SHA pins both history and file reads even if main advances during preparation.
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
const github = await GitHub.create({
  owner,
  repo,
  token: process.env.GH_TOKEN,
  defaultBranch: 'main',
});
const manifest = await Manifest.fromManifest(github, base, undefined, undefined, {
  separatePullRequests: true,
});
const candidates = await manifest.buildPullRequests();
if (!candidates.length) {
  console.log('No unreleased application features or fixes; no release needed.');
  appendFileSync(process.env.GITHUB_OUTPUT, 'created=false\n');
  process.exit(0);
}
if (candidates.length !== 1 || !candidates[0].version)
  throw new Error('Expected one application release.');
const candidate = candidates[0];
const version = candidate.version.toString();
const allowed = new Set([
  'package.json',
  'package-lock.json',
  'CHANGELOG.md',
  '.release-please-manifest.json',
]);
for (const update of candidate.updates) {
  if (!existsSync(update.path) && !update.createIfMissing) continue;
  if (!allowed.has(update.path)) throw new Error(`Unexpected release update: ${update.path}`);
  writeFileSync(
    update.path,
    update.updater.updateContent(
      existsSync(update.path) ? readFileSync(update.path, 'utf8') : undefined,
    ),
  );
}
git('config', 'user.name', 'github-actions[bot]');
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
// Keep the version commit's timestamp stable across retries on the same day.
const date = String(Number(git('show', '-s', '--format=%ct', base)) + 1) + ' +0000';
process.env.GIT_AUTHOR_DATE = date;
process.env.GIT_COMMITTER_DATE = date;
git('add', '--', ...allowed);
git('commit', '-m', `chore(main): release ${version}`);
const metadata = { base, sha: git('rev-parse', 'HEAD'), version, tag: `v${version}` };
assertReleaseTarget(metadata);
const head = await api('git/ref/heads/main');
if (![base, metadata.sha].includes(head.object.sha)) {
  console.log('Main has advanced; its successful CI run will prepare the next release.');
  appendFileSync(process.env.GITHUB_OUTPUT, 'created=false\n');
  process.exit(0);
}
savePrepared(metadata, candidate.body.releaseData[0].notes);
console.log(`Prepared ${metadata.tag} at ${metadata.sha}; nothing has been pushed or published.`);
