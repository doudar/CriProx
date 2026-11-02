import type { CutterState } from './cutter';

export type CutterPageApi = {
  state: () => Promise<CutterState>;
  keyStatus: (machine?: string) => Promise<{ available: boolean }>;
  connectSaved: (transport: 'usb' | 'ble', machine?: string) => Promise<CutterState>;
  onState: (callback: (state: CutterState) => void) => () => void;
};
/** One saved-key attempt per visible page visit. Status updates never trigger retry loops. */
export function watchCutterPage(
  api: CutterPageApi,
  transport: 'usb' | 'ble',
  handlers: {
    state: (value: CutterState) => void;
    savedKey: (available: boolean) => void;
    pending: (pending: boolean) => void;
    error: (message: string) => void;
  },
  machine = 'explore-5',
): () => void {
  let active = true,
    latest: CutterState | undefined;
  const stop = api.onState((value) => {
    latest = value;
    if (active) handlers.state(value);
  });
  handlers.pending(true);
  void (async () => {
    try {
      const initial = await api.state();
      if (!active) return;
      latest ??= initial;
      handlers.state(latest);
      if (!latest.supported || !['disconnected', 'error'].includes(latest.status)) return;
      const key = await api.keyStatus(machine);
      if (!active) return;
      handlers.savedKey(key.available);
      if (!key.available || !['disconnected', 'error'].includes(latest.status)) return;
      const connected = await api.connectSaved(transport, machine);
      if (active) handlers.state(connected);
    } catch (error) {
      if (!active) return;
      handlers.error(error instanceof Error ? error.message : 'Could not connect to the cutter.');
      try {
        const key = await api.keyStatus(machine);
        if (active) handlers.savedKey(key.available);
      } catch {
        if (active) handlers.savedKey(false);
      }
    } finally {
      if (active) handlers.pending(false);
    }
  })();
  return () => {
    active = false;
    stop();
  };
}
