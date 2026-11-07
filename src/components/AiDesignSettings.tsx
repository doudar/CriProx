import { useEffect, useState } from 'react';
export default function AiDesignSettings() {
  const api = window.skarix?.ai;
  const [state, setState] = useState<{ running: boolean; url: string }>({
      running: false,
      url: '',
    }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    if (api)
      void api
        .status()
        .then((status) => {
          setState(status);
          if (status.error) setMessage(status.error);
        })
        .catch(() => setMessage('Could not read AI design status.'));
  }, [api]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      if (api) setState(await api.status());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'AI design request failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="AI design settings">
      <h3>AI design with MCP</h3>
      <p>
        Let a connected AI create and edit artwork, text, shapes, images, drawn paths and sheet
        layouts in the live editor. Changes support Undo.
      </p>
      <p>
        Printing and all cutter operations are user-only. The design server cannot print, connect a
        cutter, scan or cut.
      </p>
      {api ? (
        <>
          <p role="status">
            {state.running ? 'AI design access is on' : 'AI design access is off'}
          </p>
          {state.running && <p className="hint">Local endpoint: {state.url}</p>}
          <div className="sticker-actions">
            <button
              className={state.running ? 'secondary' : 'primary'}
              disabled={busy}
              onClick={() => void action(() => (state.running ? api.stop() : api.start()))}
            >
              {state.running ? 'Stop AI design access' : 'Start AI design access'}
            </button>
            <button
              className="secondary"
              disabled={busy || !state.running}
              onClick={() =>
                void action(async () => {
                  await api.copyConfig();
                  setMessage('MCP configuration copied. Add it to your AI client, then connect.');
                })
              }
            >
              Copy MCP configuration
            </button>
          </div>
          <p className="hint">
            Start access, copy the configuration into your MCP client, and leave Skarix open. Access
            uses a private local token. Skarix remembers your choice and restores access next time
            if you leave it on. The copied configuration works across sessions. Closing this window
            stops the server; Stop AI design access also disables it for future launches and cancels
            pending edits.
          </p>
        </>
      ) : (
        <p>AI design access requires the desktop app.</p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
