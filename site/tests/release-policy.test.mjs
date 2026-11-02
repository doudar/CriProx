import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSiteReleasePolicy } from '../release-policy.mjs';

test('website changes cannot create app releases through PR squash titles', () => {
  for (const files of [
    ['site/build.mjs'],
    ['site/style.css', 'README.md'],
    ['docs/assets/skarix-home.png'],
    ['docs/WEBSITE.md'],
    ['.github/workflows/pages.yml'],
  ]) {
    for (const title of [
      'feat: update website',
      'fix: update website',
      'perf: update website',
      'chore(site)!: update website',
    ]) {
      assert.throws(
        () => assertSiteReleasePolicy({ title, files }),
        /must not trigger app releases/,
      );
    }
    for (const title of [
      'chore(site): update website',
      'docs(site): update website',
      'style(site): update website',
    ]) {
      assert.doesNotThrow(() => assertSiteReleasePolicy({ title, files }));
      assert.throws(
        () => assertSiteReleasePolicy({ title, files, body: 'BREAKING CHANGE: new site' }),
        /must not trigger app releases/,
      );
    }
  }
});

test('site scope stays non-releasing even when a PR touches shared repository files', () => {
  assert.throws(
    () =>
      assertSiteReleasePolicy({
        title: 'feat(site): update website',
        files: ['site/build.mjs', 'AGENTS.md'],
      }),
    /must not trigger app releases/,
  );
  assert.doesNotThrow(() =>
    assertSiteReleasePolicy({
      title: 'chore(site): update website',
      files: ['site/build.mjs', 'AGENTS.md'],
    }),
  );
});

test('app features, fixes, and breaking changes retain their release semantics', () => {
  for (const title of [
    'feat(export): add an option',
    'fix(layout): correct card position',
    'feat!: change app exports',
  ]) {
    assert.doesNotThrow(() =>
      assertSiteReleasePolicy({
        title,
        files: ['src/App.tsx', 'site/build.mjs', 'docs/FEATURES.md'],
      }),
    );
    assert.doesNotThrow(() =>
      assertSiteReleasePolicy({ title, files: ['src/App.tsx', 'README.md'] }),
    );
  }
});
