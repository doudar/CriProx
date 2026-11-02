import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { findAvailableRelease, findReleaseHistory, isNewerVersion, isTrustedReleaseUrl } =
  require('../electron/release-check.cjs') as {
    findAvailableRelease: (
      currentVersion: string,
      fetchRelease?: (url: string, init: RequestInit) => Promise<Response>,
    ) => Promise<Record<string, unknown> | null>;
    findReleaseHistory: (
      currentVersion: string,
      fetchRelease?: (url: string, init: RequestInit) => Promise<Response>,
    ) => Promise<{ version: string; body: string }[]>;
    isNewerVersion: (candidate: string, current: string) => boolean;
    isTrustedReleaseUrl: (value: string) => boolean;
  };

test('release versions use semantic version precedence', () => {
  assert.equal(isNewerVersion('v0.2.0', '0.1.9'), true);
  assert.equal(isNewerVersion('0.1.1', '0.1.0'), true);
  assert.equal(isNewerVersion('0.1.0', '0.1.0'), false);
  assert.equal(isNewerVersion('0.0.9', '0.1.0'), false);
  assert.equal(isNewerVersion('1.0.0', '1.0.0-beta.2'), true);
  assert.equal(isNewerVersion('not-a-version', '0.1.0'), false);
});

test('history includes installed and older stable releases and rejects unsafe entries', async () => {
  const release = (version: string) => ({
    tag_name: `v${version}`,
    html_url: `https://github.com/doudar/Skarix/releases/tag/v${version}`,
    body: '### Features\n* Browse notes',
  });
  const history = await findReleaseHistory('0.14.0', async (url) => {
    assert.equal(url, 'https://api.github.com/repos/doudar/Skarix/releases?per_page=100');
    return new Response(
      JSON.stringify([
        release('0.15.0'),
        release('0.14.0'),
        release('0.13.0'),
        { ...release('0.16.0'), draft: true },
        { ...release('0.16.0'), prerelease: true },
        release('0.16.0-beta.1'),
        release('invalid'),
        { ...release('0.16.0'), html_url: 'https://evil.example/release' },
        null,
      ]),
    );
  });
  assert.deepEqual(
    history.map((release) => release.version),
    ['0.15.0', '0.14.0', '0.13.0'],
  );
  await assert.rejects(findReleaseHistory('0.14.0', async () => new Response('{}')));
});

test('only Skarix GitHub release pages can be opened by the renderer', () => {
  assert.equal(isTrustedReleaseUrl('https://github.com/doudar/Skarix/releases/tag/v0.2.0'), true);
  assert.equal(isTrustedReleaseUrl('https://github.com/Go2Engle/Other/releases/tag/v0.2.0'), false);
  assert.equal(
    isTrustedReleaseUrl('https://github.com.evil.example/doudar/Skarix/releases/tag/v0.2.0'),
    false,
  );
});

test('release checks return a newer stable GitHub release', async () => {
  const update = await findAvailableRelease('0.1.0', async (url, init) => {
    assert.equal(url, 'https://api.github.com/repos/doudar/Skarix/releases/latest');
    assert.match(String((init.headers as Record<string, string>)['User-Agent']), /Skarix\/0\.1\.0/);
    return new Response(
      JSON.stringify({
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/doudar/Skarix/releases/tag/v0.2.0',
        draft: false,
        prerelease: false,
      }),
      { status: 200 },
    );
  });

  assert.deepEqual(update, {
    currentVersion: '0.1.0',
    latestVersion: '0.2.0',
    releaseUrl: 'https://github.com/doudar/Skarix/releases/tag/v0.2.0',
    releaseName: '',
    releaseNotes: '',
    publishedAt: null,
  });
});
