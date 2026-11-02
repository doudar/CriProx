import { readLocalSetting } from './lib/storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './lib/storage';
import {
  FolderOpen,
  Home,
  Settings,
  X,
  Minus,
  Maximize2,
  Sparkles,
  FilePlus2,
  ArrowRight,
  Download,
} from 'lucide-react';
import StickerStudio from './components/StickerStudio';
import AiDesignSettings from './components/AiDesignSettings';
import UpdatesPanel from './components/UpdatesPanel';
import { useAiDesignBridge } from './lib/use-ai-design';
import {
  listRecentProjects,
  readRecentProject,
  rememberRecentProject,
  type RecentProject,
} from './lib/recent-projects';
import { newStickerProject, validateStickerProject, type StickerProject } from './lib/stickers';
import { createStarterProject } from './lib/starter-project';
import { getInitialColorTheme, applyColorTheme, saveColorTheme } from './lib/theme';
import { openManagedProject } from './lib/managed-project';
import { download } from './lib/export';
import './studio.css';

function readActiveRecent() {
  try {
    const id = JSON.parse(readLocalSetting('skarix-recent-active') || '{}').stickers;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}
function saveActiveRecent(id?: string) {
  try {
    localStorage.setItem('skarix-recent-active', JSON.stringify({ stickers: id }));
  } catch {}
}
const initialUpdate: UpdateState = {
  currentVersion: __APP_VERSION__,
  status: 'idle',
  update: null,
  changelog: __APP_CHANGELOG__,
  lastChecked: null,
  transferred: 0,
  total: 0,
  error: '',
};

export default function App() {
  useAiDesignBridge();
  const [view, setView] = useState<'home' | 'studio'>('home');
  const [theme, setTheme] = useState(getInitialColorTheme);
  const [settings, setSettings] = useState(false);
  const [settingsPage, setSettingsPage] = useState('Appearance');
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [library, setLibrary] = useState<ProjectLibrarySnapshot | null>(null);
  const [legacyDraft, setLegacyDraft] = useState<unknown>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [studioBusy, setStudioBusy] = useState(true);
  const [draft, setDraft] = useState<StickerProject>();
  const [request, setRequest] = useState<{ sequence: number; project: StickerProject }>();
  const [titleHost, setTitleHost] = useState<HTMLDivElement | null>(null);
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const [printRequest, setPrintRequest] = useState(0);
  const [update, setUpdate] = useState(initialUpdate);
  const activeId = useRef<string | undefined>(readActiveRecent());
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    applyColorTheme(theme);
    saveColorTheme(theme);
  }, [theme]);
  useEffect(() => {
    if (settings) dialog.current?.showModal();
  }, [settings]);
  useEffect(() => {
    // The old card workspace autosaved independently of Recents and the library.
    // Keep this raw snapshot export-only; never modify or remove the original.
    void get('skarix-project')
      .then(setLegacyDraft)
      .catch(() =>
        setMessage('The preserved card draft could not be read. Its storage is unchanged.'),
      );
    void listRecentProjects()
      .then(setRecent)
      .catch(() => setMessage('Recent projects could not be read. Saved files are unchanged.'));
    void window.skarix?.projects
      ?.list()
      .then(setLibrary)
      .catch(() => {});
    const api = window.skarix?.releases;
    if (!api) return;
    let active = true;
    const receive = (state: UpdateState) => {
      if (active) setUpdate(state);
    };
    const check = () => {
      void api
        .check()
        .then(receive)
        .catch(() => {});
    };
    const unsubscribe = api.onState(receive);
    check();
    // The main-process checker caches results and coalesces concurrent requests.
    const timer = window.setInterval(check, 15 * 60 * 1000);
    window.addEventListener('focus', check);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, []);
  const remember = useCallback(async (project: StickerProject, fresh: boolean | string = false) => {
    if (fresh) activeId.current = typeof fresh === 'string' ? fresh : undefined;
    const items = await rememberRecentProject(project, 'stickers', activeId.current);
    activeId.current = items.find((item) => item.workspace === 'stickers')?.id;
    saveActiveRecent(activeId.current);
    setRecent(items);
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function openProject(project: unknown, id?: string) {
    const clean = validateStickerProject(project);
    if (draft?.artwork.length) await remember(draft);
    await remember(clean, id || true);
    setRequest({ sequence: Date.now(), project: clean });
    setView('studio');
  }
  function exportLegacy(value: unknown, name: string) {
    download(
      new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
      name.replace(/[^a-zA-Z0-9 -]/g, '') + '.skarix.json',
    );
    setMessage('Project copy exported. Use CriProx to edit this legacy format.');
  }
  async function updateAction(action: 'checkNow' | 'download' | 'cancel' | 'viewRelease') {
    const api = window.skarix?.releases;
    if (!api) return;
    if (action === 'viewRelease') {
      if (update.update) await api.open(update.update.releaseUrl);
    } else setUpdate(await api[action]());
  }
  function home() {
    if (draft?.artwork.length)
      void remember(draft).catch(() =>
        setMessage('Could not save a recent copy. Your draft is retained.'),
      );
    setView('home');
  }
  const legacy = recent.filter((item) => item.workspace === 'cards');
  const controls = window.skarix?.windowControls;
  return (
    <div className="skarix-app">
      <header className="skarix-header">
        <button
          className="skarix-brand"
          aria-label="Skarix Home"
          disabled={studioBusy}
          onClick={home}
        >
          <img src="./brand/skarix-mark.svg" alt="" />
          <span>
            skarix<small>OPEN SOURCE CUTTING STUDIO</small>
          </span>
        </button>
        <nav aria-label="Main navigation">
          <button
            disabled={studioBusy}
            aria-current={view === 'home' ? 'page' : undefined}
            onClick={home}
          >
            <Home size={16} /> Home
          </button>
          <button
            disabled={studioBusy}
            aria-current={view === 'studio' ? 'page' : undefined}
            onClick={() => setView('studio')}
          >
            Design studio
          </button>
        </nav>
        <div className="skarix-drag-space" />
        {update.update && (
          <button
            className="skarix-update-notice"
            aria-label={`Skarix ${update.update.latestVersion} is available. Open updates`}
            onClick={() => {
              setSettingsPage('Updates');
              setSettings(true);
            }}
          >
            <Download size={15} aria-hidden="true" />
            <span>Update {update.update.latestVersion}</span>
          </button>
        )}
        <button className="icon-button" aria-label="Settings" onClick={() => setSettings(true)}>
          <Settings size={19} />
        </button>
        {controls && (
          <div className="window-controls">
            <button aria-label="Minimize window" onClick={() => void controls.minimize()}>
              <Minus size={15} />
            </button>
            <button aria-label="Maximize window" onClick={() => void controls.toggleMaximize()}>
              <Maximize2 size={14} />
            </button>
            <button aria-label="Close window" onClick={() => void controls.close()}>
              <X size={17} />
            </button>
          </div>
        )}
      </header>
      {message && (
        <div className="skarix-notice" role="status">
          {message}
          <button aria-label="Dismiss message" onClick={() => setMessage('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {view === 'home' && (
        <main className="skarix-home">
          <section className="skarix-hero">
            <div>
              <p className="eyebrow">FROM FIRST IDEA TO FINAL CUT</p>
              <h1>
                Make something
                <br />
                <em>your own.</em>
              </h1>
              <p className="hero-copy">
                A local studio for artwork, labels, decals and cut-ready designs. Your ideas. Your
                tools. Your files.
              </p>
              <div className="hero-actions">
                <button
                  className="primary"
                  disabled={busy || studioBusy}
                  onClick={() => setView('studio')}
                >
                  Open design studio <ArrowRight size={17} />
                </button>
                <button
                  className="secondary"
                  disabled={busy || studioBusy}
                  onClick={() => input.current?.click()}
                >
                  <FolderOpen size={17} /> Open project
                </button>
              </div>
            </div>
            <div className="skarix-hero-art" aria-label="Skarix Aurora logo">
              <img src="./brand/skarix-logo.svg" alt="Skarix — Make it your own" />
            </div>
          </section>
          <section className="skarix-start" aria-label="Start a project">
            <button
              disabled={busy || studioBusy}
              onClick={() => void run(async () => openProject(newStickerProject()))}
            >
              <FilePlus2 />
              <strong>Blank canvas</strong>
              <span>Start with your own artwork.</span>
              <ArrowRight />
            </button>
            <button
              disabled={busy || studioBusy}
              onClick={() => void run(async () => openProject(await createStarterProject()))}
            >
              <Sparkles />
              <strong>Meet Skarix</strong>
              <span>Explore an editable starter sticker.</span>
              <ArrowRight />
            </button>
            {draft && (
              <button disabled={busy || studioBusy} onClick={() => setView('studio')}>
                <FolderOpen />
                <strong>Continue your draft</strong>
                <span>
                  {draft.name} · {draft.items.length} placed designs
                </span>
                <ArrowRight />
              </button>
            )}
          </section>
          <section className="skarix-recent">
            <h2>Recent projects</h2>
            <div className="skarix-project-grid">
              {recent
                .filter((item) => item.workspace === 'stickers')
                .map((item) => (
                  <button
                    key={item.id}
                    disabled={busy || studioBusy}
                    onClick={() =>
                      void run(async () => openProject(await readRecentProject(item.id), item.id))
                    }
                  >
                    {item.preview ? <img src={item.preview} alt="" /> : <FolderOpen />}
                    <strong>{item.name}</strong>
                    <span>
                      {item.count} designs · {new Date(item.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                ))}
            </div>
            {!recent.some((item) => item.workspace === 'stickers') && (
              <p>Open or save a project to keep a recent copy on this device.</p>
            )}
          </section>
          {(legacyDraft !== undefined || legacy.length > 0 || !!library?.projects.length) && (
            <details className="skarix-legacy">
              <summary>Preserved legacy projects</summary>
              <p>
                Your existing project files remain intact. Export a copy to continue editing the
                legacy format in CriProx.
              </p>
              {legacyDraft !== undefined && (
                <button
                  disabled={busy || studioBusy}
                  onClick={() => exportLegacy(legacyDraft, 'Recovered autosaved card draft')}
                >
                  <Download size={15} /> Export last autosaved card draft
                </button>
              )}
              {legacy.map((item) => (
                <button
                  disabled={busy || studioBusy}
                  key={item.id}
                  onClick={() =>
                    void run(async () => exportLegacy(await readRecentProject(item.id), item.name))
                  }
                >
                  <Download size={15} /> {item.name}
                </button>
              ))}
              {library?.projects.map((item) => (
                <button
                  disabled={busy || studioBusy}
                  key={item.id}
                  onClick={() =>
                    void run(async () =>
                      exportLegacy(
                        await openManagedProject(window.skarix!.projects!, item.id),
                        item.name,
                      ),
                    )
                  }
                >
                  <Download size={15} /> {item.name}
                </button>
              ))}
              <button onClick={() => void window.skarix?.projects?.reveal()}>
                Open original library folder
              </button>
            </details>
          )}
          <footer>
            Skarix v{__APP_VERSION__} · Your work stays on this device.
            <span>
              Based on{' '}
              <a href="https://github.com/Go2Engle/CriProx" target="_blank" rel="noreferrer">
                CriProx
              </a>{' '}
              by Chris Engle and its contributors.
            </span>
          </footer>
        </main>
      )}
      <div className="skarix-workspace-bar" hidden={view !== 'studio'}>
        <div className="project-title" ref={setTitleHost} />
        <div className="top-actions" ref={setActionsHost} />
        <button
          className="primary compact"
          disabled={studioBusy}
          onClick={() => setPrintRequest((value) => value + 1)}
        >
          Print & cut
        </button>
      </div>
      <StickerStudio
        open={view === 'studio'}
        printRequest={printRequest}
        titleHost={titleHost}
        actionsHost={actionsHost}
        request={request}
        onDraft={setDraft}
        onBusyChange={setStudioBusy}
        onRemember={remember}
        onAiOpen={(fresh) => {
          if (fresh) {
            activeId.current = undefined;
            saveActiveRecent();
          }
          setSettings(false);
          setView('studio');
        }}
      />
      <input
        ref={input}
        type="file"
        accept=".json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file)
            void run(async () => {
              if (file.size > 90_000_000) throw Error('Project exceeds 90 MB.');
              const value = JSON.parse(await file.text());
              if (!['skarix-stickers', 'criprox-stickers'].includes(value.kind))
                throw Error(
                  'This legacy project is preserved. Open it in CriProx; Skarix opens design projects.',
                );
              await openProject(value);
            });
        }}
      />
      {settings && (
        <dialog
          ref={dialog}
          className="modal wide skarix-settings"
          onCancel={() => setSettings(false)}
        >
          <div className="modal-heading">
            <h2>Settings</h2>
            <button
              aria-label="Close settings"
              className="icon-button"
              onClick={() => setSettings(false)}
            >
              <X />
            </button>
          </div>
          <nav className="settings-page-nav">
            {['Appearance', 'AI design', 'Updates'].map((page) => (
              <button
                key={page}
                aria-current={settingsPage === page ? 'page' : undefined}
                onClick={() => setSettingsPage(page)}
              >
                {page}
              </button>
            ))}
          </nav>
          {settingsPage === 'Appearance' && (
            <section>
              <h3>Make yourself at home</h3>
              <p>Choose the look of your studio.</p>
              <div className="segmented">
                {(['light', 'dark'] as const).map((value) => (
                  <button
                    key={value}
                    aria-pressed={theme === value}
                    className={theme === value ? 'selected' : ''}
                    onClick={() => setTheme(value)}
                  >
                    {value === 'light' ? 'Light' : 'Dark'}
                  </button>
                ))}
              </div>
              <p>Sheet size, material, and cutting settings live beside your design.</p>
            </section>
          )}
          {settingsPage === 'AI design' && <AiDesignSettings />}
          {settingsPage === 'Updates' && (
            <UpdatesPanel
              state={update}
              action={(action) => void run(() => updateAction(action))}
              openInstaller={() =>
                void run(async () => {
                  if (draft) await remember(draft);
                  const state = await window.skarix?.releases?.openInstaller();
                  if (state) setUpdate(state);
                })
              }
              installBusy={busy}
              installDisabled={busy}
            />
          )}
        </dialog>
      )}
    </div>
  );
}
