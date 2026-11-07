import { createRoot } from 'react-dom/client';
import AiDesignSettings from '../src/components/AiDesignSettings';

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
function check(value: unknown, message: string) {
  if (!value) throw Error(message);
}
async function until(predicate: () => unknown) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  throw Error('Timed out waiting for AI design settings');
}

export async function run() {
  const host = document.createElement('div');
  document.body.append(host);
  let root = createRoot(host);
  const originalBridge = window.skarix;
  let state = {
    running: false,
    enabled: true,
    url: '',
    connectionFile: '',
    scope: 'design-only',
    error: 'Could not restore AI design access: Another Skarix window has AI design access on.',
  };
  let starts = 0,
    stops = 0,
    releaseStop: (() => void) | undefined;
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  const start = () => button('Start AI design access');
  const stop = () => button('Stop AI design access');
  const copy = () => button('Copy MCP configuration');
  window.skarix = {
    ...originalBridge,
    ai: {
      status: async () => ({ ...state }),
      start: async () => {
        starts++;
        if (state.enabled) throw Error('Another Skarix window has AI design access on.');
        state = { ...state, enabled: true, running: true, url: 'http://127.0.0.1:1234/mcp' };
        return { ...state };
      },
      stop: async () => {
        stops++;
        await new Promise<void>((resolve) => {
          releaseStop = resolve;
        });
        state = { ...state, enabled: false, running: false, url: '', error: '' };
        return { ...state };
      },
      copyConfig: async () => true,
      onRequest: () => () => {},
      onCancel: () => () => {},
    },
  };
  try {
    root.render(<AiDesignSettings />);
    await until(() => stop());
    check(start() && !start()!.disabled, 'Failed restoration must allow retrying Start');
    check(!stop()!.disabled, 'Failed restoration must allow Stop without a running server');
    check(copy()?.disabled, 'A stopped server must not offer a usable configuration');
    check(
      host.textContent?.includes('Automatic starts are still enabled.'),
      'Saved preference is not explained',
    );
    check(host.textContent?.includes('Could not restore'), 'Restoration failure is not displayed');

    start()!.click();
    // Wait for the rejected request's React render, not the still-enabled button
    // from before the click. Otherwise Stop can run while Start is becoming busy.
    await until(
      () =>
        starts === 1 &&
        !stop()?.disabled &&
        [...host.querySelectorAll('[role="status"]')].some(
          (item) => item.textContent === 'Another Skarix window has AI design access on.',
        ),
    );
    check(stop(), 'A failed Start retry must keep Stop available');
    stop()!.click();
    await until(() => releaseStop && stop()?.disabled);
    check(
      start()?.disabled && copy()?.disabled,
      'All access actions must be disabled while stopping',
    );
    stop()!.click();
    check(stops === 1, 'Repeated clicks must not queue another Stop');
    releaseStop!();
    await until(() => !stop() && !start()?.disabled);
    check(host.textContent?.includes('AI design access is off'), 'Stop must show access as off');
    check(
      !host.textContent?.includes('Could not restore'),
      'Stop must clear the old restore error',
    );
    check(!state.enabled, 'Stop must clear the saved preference');

    root.unmount();
    root = createRoot(host);
    root.render(<AiDesignSettings />);
    await until(() => start());
    await tick();
    check(!stop() && copy()?.disabled, 'Reopening Settings must keep disabled access off');
    check(starts === 1, 'Reopening Settings must not attempt to start access');
    start()!.click();
    await until(() => stop() && !copy()?.disabled);
    check(!start(), 'Running access should offer Stop rather than Start');
    check(
      host.textContent?.includes('AI design access is on'),
      'Manual Start must show access as on',
    );

    return [
      'PASS failed MCP restoration offers both retry and persistent Stop',
      'PASS failed retry, repeated Stop clicks and reopened AI settings stay consistent',
      'PASS disabled MCP access can be started again',
    ];
  } finally {
    root.unmount();
    host.remove();
    window.skarix = originalBridge;
  }
}
