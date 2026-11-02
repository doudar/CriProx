import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';

const { bundledReleaseHistory, mergeReleaseHistory } = createRequire(import.meta.url)(
  '../electron/release-history.cjs',
);
Object.assign(globalThis, {
  __APP_VERSION__: '0.15.0',
  __APP_CHANGELOG__: mergeReleaseHistory('0.15.0', bundledReleaseHistory('0.15.0')),
  window: {},
});
const { default: UpdatesPanel, INITIAL_UPDATE_STATE } =
  await import('../src/components/UpdatesPanel');

function render(state: UpdateState) {
  return renderToStaticMarkup(
    createElement(UpdatesPanel, {
      state,
      action: () => {},
      openInstaller: () => {},
      installBusy: false,
      installDisabled: false,
    }),
  );
}

test('release history is visible before checking, when up to date, and after a failed check', () => {
  for (const status of ['idle', 'checking', 'up-to-date', 'error'] as const) {
    const html = render({
      ...INITIAL_UPDATE_STATE,
      status,
      error: status === 'error' ? 'Offline' : '',
    });
    assert.match(html, /aria-label="Changelog"/);
    assert.match(html, /aria-label="Skarix 0.15.0"/);
    assert.match(html, />Installed<\/span>/);
    assert.doesNotMatch(html, />New<\/span>|Download update|Install update/);
  }
});

test('new releases are labeled separately from the installed version without requiring an installer', () => {
  const changelog = mergeReleaseHistory('0.15.0', bundledReleaseHistory('0.15.0'), [
    {
      version: '0.16.0',
      body: '* Browse the changelog anytime',
      publishedAt: '2026-10-11T00:00:00Z',
    },
  ]);
  const html = render({ ...INITIAL_UPDATE_STATE, changelog, status: 'up-to-date' });
  assert.match(html, />New<\/span>/);
  assert.match(html, />Installed<\/span>/);
  assert.match(html, /Browse the changelog anytime/);
  assert.ok(
    html.indexOf('aria-label="Skarix 0.16.0"') < html.indexOf('aria-label="Skarix 0.15.0"'),
  );
});
