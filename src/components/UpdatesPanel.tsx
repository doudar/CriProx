import { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

export const INITIAL_UPDATE_STATE: UpdateState = {
  currentVersion: __APP_VERSION__,
  status: 'idle',
  update: null,
  changelog: __APP_CHANGELOG__,
  lastChecked: null,
  transferred: 0,
  total: 0,
  error: '',
};

export default function UpdatesPanel({
  state,
  action,
  openInstaller,
  installBusy,
  installDisabled,
}: {
  state: UpdateState;
  action: (action: 'checkNow' | 'download' | 'cancel' | 'viewRelease') => void;
  openInstaller: () => void;
  installBusy: boolean;
  installDisabled: boolean;
}) {
  const update = state.update;
  const [linkError, setLinkError] = useState<{ version: string; message: string } | null>(null);
  const [macAction, setMacAction] = useState<'copyMacCommand' | 'openTerminal' | null>(null);
  const [commandCopied, setCommandCopied] = useState(false);
  const [macError, setMacError] = useState('');
  const downloading = state.status === 'downloading' || state.status === 'verifying';
  const busy = downloading || state.status === 'checking';
  const platform = window.criprox?.platform;
  const percent = state.total
    ? Math.min(100, Math.floor((state.transferred / state.total) * 100))
    : 0;
  const megabytes = (value: number) => `${(value / 1024 ** 2).toFixed(1)} MB`;
  async function macHelp(action: 'copyMacCommand' | 'openTerminal') {
    if (macAction) return;
    setMacAction(action);
    setMacError('');
    try {
      const releases = window.criprox?.releases;
      if (!releases) throw new Error('Updates are unavailable.');
      await releases[action]();
      if (action === 'copyMacCommand') setCommandCopied(true);
    } catch {
      setMacError(
        action === 'copyMacCommand'
          ? 'Could not copy the command. Select and copy it below.'
          : 'Could not open Terminal. Open it from Applications → Utilities.',
      );
    } finally {
      setMacAction(null);
    }
  }
  return (
    <div className="updates-panel">
      {state.simulation && (
        <p className="update-simulation" role="status">
          Local update simulation · {state.simulation}. Uses a temporary profile and test data; no
          app installation.
        </p>
      )}
      <div className="settings-page-heading">
        <div>
          <h3>Updates</h3>
          <p>You’re using Skarix {state.currentVersion}.</p>
        </div>
        <button
          className="secondary compact"
          disabled={busy || installBusy}
          onClick={() => action('checkNow')}
        >
          {state.status === 'checking' ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <RotateCcw size={14} />
          )}
          {state.status === 'checking' ? 'Checking…' : 'Check now'}
        </button>
      </div>
      <p className="hint">
        {state.lastChecked
          ? `Last checked ${new Date(state.lastChecked).toLocaleString()}.`
          : 'Checks GitHub for stable releases at startup, every 15 minutes, and when you return to Skarix.'}
      </p>
      <div role="status" aria-live="polite">
        {state.status === 'up-to-date' && <p>You’re up to date.</p>}
        {state.status === 'cancelled' && (
          <p>Download cancelled. You can try again whenever you’re ready.</p>
        )}
        {state.status === 'ready' && (
          <p className="update-verified">
            <ShieldCheck size={18} /> Download verified and ready to install.
          </p>
        )}
      </div>
      {state.error && (
        <p className="error-box" role="alert">
          {state.error}
        </p>
      )}
      {update && (
        <>
          <div className="update-release-summary">
            <h4>Skarix {update.latestVersion} is available</h4>
            {update.installerName && (
              <p>
                {update.installerName} · {megabytes(update.downloadSize || 0)}
              </p>
            )}
          </div>
          {downloading && (
            <div className="update-download-progress">
              <label htmlFor="update-progress">
                {state.status === 'verifying' ? 'Verifying installer…' : `Downloading… ${percent}%`}
              </label>
              <progress id="update-progress" max={state.total || 1} value={state.transferred} />
              <span>
                {megabytes(state.transferred)} of {megabytes(state.total)}
              </span>
            </div>
          )}
          {!update.canDownload && (
            <p>
              A verified download is not available for this device yet. View the release for manual
              installation options.
            </p>
          )}
          <div className="app-settings-actions">
            {update.canDownload && !downloading && state.status !== 'ready' && (
              <button
                className="primary compact"
                disabled={busy}
                onClick={() => action('download')}
              >
                <Download size={14} />{' '}
                {state.status === 'error' || state.status === 'cancelled'
                  ? 'Retry download'
                  : 'Download update'}
              </button>
            )}
            {downloading && (
              <button className="secondary compact" onClick={() => action('cancel')}>
                Cancel download
              </button>
            )}
            {state.status === 'ready' && (
              <button
                className="primary compact"
                disabled={installBusy || installDisabled || Boolean(macAction)}
                onClick={openInstaller}
              >
                <ExternalLink size={14} />{' '}
                {installBusy
                  ? 'Preparing update…'
                  : state.simulation
                    ? 'Test installer handoff'
                    : 'Install update'}
              </button>
            )}
            <button className="text-button compact" onClick={() => action('viewRelease')}>
              <ExternalLink size={14} /> View release on GitHub
            </button>
          </div>
          {state.status === 'ready' && !state.simulation && (
            <p className="hint">
              Your workspace will be saved and Skarix will close to install the update.
            </p>
          )}
          {platform === 'darwin' && (
            <section className="update-mac-help" aria-label="macOS unblock command">
              <h4>If macOS blocks the updated app</h4>
              <p>After replacing Skarix in Applications, paste this command in Terminal.</p>
              <pre>
                <code>xattr -dr com.apple.quarantine "/Applications/Skarix.app"</code>
              </pre>
              <div className="app-settings-actions">
                <button
                  className="secondary compact"
                  disabled={Boolean(macAction) || installBusy}
                  onClick={() => void macHelp('copyMacCommand')}
                >
                  {commandCopied ? <Check size={14} /> : <Copy size={14} />}
                  {commandCopied ? 'Copied' : 'Copy command'}
                </button>
                <button
                  className="secondary compact"
                  disabled={Boolean(macAction) || installBusy}
                  onClick={() => void macHelp('openTerminal')}
                >
                  <Terminal size={14} /> Open Terminal
                </button>
              </div>
              {macError && (
                <p className="error-box" role="alert">
                  {macError}
                </p>
              )}
            </section>
          )}
        </>
      )}
      <section className="update-history" aria-label="Changelog">
        <h4>Changelog</h4>
        {state.changelog.length === 0 && (
          <p className="hint">Release notes are available after checking for updates.</p>
        )}
        {state.changelog.map((release) => {
          const published = release.publishedAt ? new Date(release.publishedAt) : null;
          return (
            <article
              key={release.version}
              className="update-changelog"
              aria-label={`Skarix ${release.version}`}
            >
              <div className="update-release-meta">
                <span className="update-version">{release.version}</span>
                {release.isNew && <span className="update-release-badge new">New</span>}
                {release.isInstalled && (
                  <span className="update-release-badge installed">Installed</span>
                )}
                {published && Number.isFinite(published.getTime()) && (
                  <time dateTime={release.publishedAt || undefined}>
                    {published.toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </time>
                )}
              </div>
              <div className="update-release-body">
                <h4 className="update-release-heading">
                  {release.releaseHeading || `Skarix ${release.version}`}
                </h4>
                <div
                  onClick={(event) => {
                    const anchor = (event.target as HTMLElement).closest('a');
                    if (!anchor) return;
                    event.preventDefault();
                    setLinkError(null);
                    void window.criprox?.releases?.openLink(anchor.href).catch(() =>
                      setLinkError({
                        version: release.version,
                        message:
                          'Could not open the release notes link. Try viewing the release on GitHub.',
                      }),
                    );
                  }}
                  dangerouslySetInnerHTML={{
                    __html:
                      release.releaseNotesHtml || '<p>Release notes are available on GitHub.</p>',
                  }}
                />
                {linkError?.version === release.version && (
                  <p className="error-box" role="alert">
                    {linkError.message}
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
