import { getMachine, type Machine } from '../lib/machine-guides';
import { useEffect, useMemo, useState } from 'react';
import { Cable, Unplug, CheckCircle2, Scissors, ExternalLink } from 'lucide-react';
import { DISCONNECTED_CUTTER, type CutterState } from '../lib/cutter';
import { cutSettingsSummary, readCutSettings, directCutIssue } from '../lib/cut-settings';
import { watchCutterPage } from '../lib/cutter-page-connection';

export default function CutterPanel({
  job,
  active = true,
  machine = 'explore-5',
}: {
  job?: string;
  active?: boolean;
  machine?: Machine;
}) {
  const model = getMachine(machine);
  const mac = window.criprox?.platform === 'darwin';
  const [state, setState] = useState<CutterState>(DISCONNECTED_CUTTER);
  const [transport, setTransport] = useState<'usb' | 'ble'>(() => {
    try {
      if (mac) return 'ble';
      return localStorage.getItem('criprox-cutter-transport') === 'ble' ? 'ble' : 'usb';
    } catch {
      return 'usb';
    }
  });
  const [savedKey, setSavedKey] = useState<boolean>(),
    [setupOpened, setSetupOpened] = useState(false);
  const [authorized, setAuthorized] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [sheetIndex, setSheetIndex] = useState(0),
    [printed, setPrinted] = useState(false),
    [materialReady, setMaterialReady] = useState(false);
  const prepared = useMemo(() => {
    if (!job) return undefined;
    try {
      const value = JSON.parse(job);
      if (value.machine !== machine || !Array.isArray(value.sheets)) return undefined;
      return {
        sheets: value.sheets as { frontPdfPage: number; contours: unknown[] }[],
        paper: value.paper as string,
        settings: readCutSettings({
          cutMaterial: value.cutSettings.material,
          cutPressure: value.cutSettings.pressurePreset,
          cutPasses: value.cutSettings.passes,
          cutProfile: value.cutSettings?.profile,
        }),
      };
    } catch {
      return undefined;
    }
  }, [job, machine]);
  useEffect(() => {
    setSheetIndex(0);
    setPrinted(false);
    setMaterialReady(false);
  }, [job, machine]);
  useEffect(() => {
    setPrinted(false);
    setMaterialReady(false);
  }, [sheetIndex]);
  const api = window.criprox?.cutter;
  const materialIssue = prepared ? directCutIssue(prepared.settings, machine) : '';
  useEffect(() => {
    setSavedKey(undefined);
    setAuthorized(false);
    setSetupOpened(false);
    setError('');
  }, [machine]);
  useEffect(() => {
    if (!api || !active || !model.directConnect) {
      setPending(false);
      return;
    }
    setError('');
    return watchCutterPage(
      api,
      transport,
      {
        state: setState,
        savedKey: (available) => {
          setSavedKey(available);
          setAuthorized(available);
        },
        pending: setPending,
        error: setError,
      },
      machine,
    );
  }, [api, active, transport, machine, model.directConnect]);
  const cutting = state.status === 'cutting';
  const connected =
    ['connected', 'cutting'].includes(state.status) &&
    state.encrypted &&
    (state.machine ?? 'explore-5') === machine;
  const otherMachineConnected =
    ['connected', 'cutting', 'homing'].includes(state.status) &&
    (state.machine ?? 'explore-5') !== machine;
  const busy =
    pending || ['connecting', 'homing', 'cutting', 'disconnecting'].includes(state.status);
  async function run(action: () => Promise<CutterState>) {
    setPending(true);
    setError('');
    try {
      setState(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  async function connect() {
    if (!api) return;
    await run(async () => {
      try {
        return await (savedKey
          ? api.connectSaved(transport, machine)
          : api.connect(transport, authorized, machine));
      } finally {
        const key = await api.keyStatus(machine).catch(() => ({ available: false }));
        setSavedKey(key.available);
      }
    });
  }
  async function openSetup() {
    if (!api || !window.criprox?.cricut) return;
    setPending(true);
    setError('');
    try {
      setState(await api.disconnect());
      await window.criprox.cricut.open();
      setSetupOpened(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="cutter-panel" aria-label="Cutter connection">
      <div className="cutter-heading">
        <h3>Cut the printed sheet</h3>
        <span className={`cutter-status ${connected ? 'is-connected' : ''}`} role="status">
          {connected && <CheckCircle2 size={15} />}{' '}
          {connected
            ? 'Connected'
            : state.status === 'error'
              ? 'Needs attention'
              : busy
                ? 'Working…'
                : 'Not connected'}
        </span>
      </div>
      <p className="muted">
        {model.name} · Fine-point blade
        {model.mat ? ` · ${model.mat.width} × ${model.mat.height} inch mat` : ''} · Close Design
        Space before connecting.
      </p>
      {!model.directConnect ? (
        <p role="status">{model.unavailableReason}</p>
      ) : !api || !state.supported ? (
        <p>
          Direct cutter control requires the Windows or macOS desktop app. Printing and exports
          remain available here.
        </p>
      ) : (
        <>
          {otherMachineConnected && (
            <p role="alert">
              A different cutter is connected.{' '}
              <button disabled={busy} onClick={() => void run(() => api.disconnect())}>
                Disconnect {state.name || 'cutter'}
              </button>
            </p>
          )}
          {state.status === 'connecting' && (
            <button
              className="secondary"
              onClick={() =>
                void api
                  .disconnect()
                  .then(setState)
                  .catch(() => {})
              }
            >
              Cancel connection
            </button>
          )}
          {!model.directCut && <p>{model.unavailableReason}</p>}
          {!model.hardwareVerified && (
            <p className="muted">
              {`${model.name} support is experimental and has not been physically validated.`}
            </p>
          )}
          {!connected && savedKey === false && (
            <section className="cutter-test" aria-label="Cutter setup">
              <h3>
                {setupOpened ? 'Finish setup, then return to Skarix' : 'Set up your cutter key'}
              </h3>
              <p>
                {setupOpened
                  ? 'Sign in to Design Space and connect your selected cutter there. Then close Design Space, leave the cutter powered on, and connect below.'
                  : 'No usable saved cutter key is available. Open Cricut Design Space, sign in and connect your selected cutter, then close it before connecting in Skarix.'}
              </p>
              <button
                className="secondary"
                disabled={busy || !window.criprox?.cricut}
                onClick={() => void openSetup()}
              >
                <ExternalLink size={16} />
                {setupOpened ? 'Open Design Space again' : 'Open Cricut Design Space'}
              </button>
            </section>
          )}
          <div className="sticker-actions">
            <label className="cutter-transport">
              Connection{' '}
              <select
                aria-label="Cutter connection type"
                value={transport}
                disabled={busy || connected}
                onChange={(e) => {
                  const value = e.target.value as 'usb' | 'ble';
                  setTransport(value);
                  try {
                    localStorage.setItem('criprox-cutter-transport', value);
                  } catch {}
                }}
              >
                {!mac && <option value="usb">USB</option>}
                <option value="ble">
                  {mac ? 'Bluetooth LE' : 'Bluetooth LE (experimental)'}
                </option>
              </select>
            </label>
            {connected ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await api.disconnect();
                    const key = await api.keyStatus(machine).catch(() => ({ available: false }));
                    setSavedKey(key.available);
                    setAuthorized(key.available);
                    return next;
                  })
                }
              >
                <Unplug size={16} />
                Disconnect
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || otherMachineConnected || (!savedKey && !authorized)}
                onClick={() => void connect()}
              >
                <Cable size={16} />
                Connect cutter
              </button>
            )}
            {!connected && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await api.forgetKey(machine);
                    setSavedKey(false);
                    setAuthorized(false);
                    setSetupOpened(false);
                    return next;
                  })
                }
              >
                Forget saved key
              </button>
            )}
          </div>
          {!connected && !savedKey && (
            <label className="workflow-check">
              <input
                type="checkbox"
                checked={authorized}
                disabled={busy}
                onChange={(e) => setAuthorized(e.target.checked)}
              />
              <span>
                Use and remember my cutter key on this computer.
                <small>
                  Skarix protects the saved key with{' '}
                  {mac ? 'macOS Keychain' : 'your Windows account'}. Design Space sign-in is needed
                  only to get a new key. Login tokens are never saved by Skarix.
                </small>
              </span>
            </label>
          )}
          <p className="cutter-message" role="status">
            {state.message}
          </p>
          {cutting ? (
            <section className="cutter-test">
              <h3>Sheet job in progress</h3>
              {state.cutSettings && (
                <p>
                  {state.cutSettings.materialName} · {state.cutSettings.pressureGrams} g ·{' '}
                  {state.cutSettings.passes} passes
                </p>
              )}
              <div className="sticker-actions">
                <button
                  className="secondary"
                  disabled={pending}
                  onClick={() =>
                    void run(() => (state.phase === 'paused' ? api.resume() : api.pause()))
                  }
                >
                  {state.phase === 'paused' ? 'Resume' : 'Pause'}
                </button>
                <button
                  className="secondary"
                  disabled={pending}
                  onClick={() => void run(() => api.cancel())}
                >
                  Cancel cut
                </button>
              </div>
            </section>
          ) : prepared && job ? (
            <section className="cutter-test">
              <label>
                Printed sheet{' '}
                <select
                  aria-label="Sheet to cut"
                  value={sheetIndex}
                  disabled={busy}
                  onChange={(e) => setSheetIndex(Number(e.target.value))}
                >
                  {prepared.sheets.map((sheet, index) => (
                    <option key={index} value={index}>
                      Sheet {index + 1} · front PDF page {sheet.frontPdfPage} ·{' '}
                      {sheet.contours.length} cuts
                    </option>
                  ))}
                </select>
              </label>
              <p>{cutSettingsSummary(prepared.settings)}</p>
              {materialIssue && <p role="alert">{materialIssue}</p>}
              <p>
                Place the printed sheet in portrait orientation at the upper-left of the mat’s
                adhesive grid, with its printed arrow at the upper left pointing toward the machine.
                Leave all four black marks visible.
              </p>
              <label className="workflow-check">
                <input
                  type="checkbox"
                  checked={printed}
                  disabled={busy}
                  onChange={(e) => {
                    setPrinted(e.target.checked);
                    setMaterialReady(false);
                  }}
                />
                I printed the selected front page from this prepared job at 100% / Actual size on{' '}
                {prepared.paper === 'a4' ? 'A4' : 'US Letter'}.
              </label>
              <label className="workflow-check">
                <input
                  type="checkbox"
                  checked={materialReady}
                  disabled={busy || !printed}
                  onChange={(e) => setMaterialReady(e.target.checked)}
                />
                The fine-point blade is installed and this printed sheet is secured on the mat as
                shown above.
              </label>
              <button
                className="primary"
                disabled={
                  busy ||
                  !connected ||
                  !printed ||
                  !materialReady ||
                  !state.capabilities.cut ||
                  !!materialIssue
                }
                onClick={() =>
                  void run(async () => {
                    setPrinted(false);
                    setMaterialReady(false);
                    return api.cutSheet(job, sheetIndex, true);
                  })
                }
              >
                <Scissors size={16} />
                Cut sheet
              </button>
              <p className="muted">
                Load the mat when prompted. Skarix measures it, scans the registration marks, and
                cuts only this sheet’s contours using the saved pressure and passes. A failed scan
                cancels the job. An Explore 5 USB sticker sheet cut successfully at 80 g, one pass.
                Check alignment when changing paper, material, or settings.
              </p>
            </section>
          ) : (
            <p>Prepare the marked print sheets in Skarix to enable their matching cut job.</p>
          )}
          {connected && (
            <p className="muted">
              {state.name} · Firmware {state.firmware} · Encrypted{' '}
              {state.transport === 'usb' ? 'USB' : 'Bluetooth'} connection
            </p>
          )}
        </>
      )}
      {error && (
        <p className="workflow-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
