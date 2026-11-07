import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('CI, releases and installer previews prepare the same font before application tests', async () => {
  for (const workflow of ['skarix-ci.yml', 'release.yml', 'installer-previews.yml']) {
    const content = await readFile(
      new URL(`../.github/workflows/${workflow}`, import.meta.url),
      'utf8',
    );
    assert.match(
      content,
      /- uses: \.\/\.github\/actions\/artwork-test-fonts\s+- run: npm test\s/,
      `${workflow} must prepare fonts before testing the app`,
    );
  }
  const action = await readFile(
    new URL('../.github/actions/artwork-test-fonts/action.yml', import.meta.url),
    'utf8',
  );
  assert.match(action, /if: runner.os == 'Linux'/);
  assert.match(action, /apt-get install --yes .*fonts-dejavu-core/);
  assert.match(
    action,
    /SKARIX_TEST_FONT=\/usr\/share\/fonts\/truetype\/dejavu\/DejaVuSans.ttf.*>> "\$GITHUB_ENV"/,
  );
});
