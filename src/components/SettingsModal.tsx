import { useEffect, useRef, useState } from 'react';
import AiDesignSettings from './AiDesignSettings';
import { ExternalLink, FolderCog, Moon, RotateCcw, Save, Sun, Upload, X } from 'lucide-react';
import {
  FACTORY_PROJECT_DEFAULTS,
  projectDefaultsFrom,
  projectDefaultsMatch,
  projectFromDefaults,
  validateProjectDefaults,
  defaultSettingsIssue,
  type DefaultSettingsGroup,
  type ProjectDefaults,
} from '../lib/project-defaults';
import type { CardFace, Project } from '../lib/types';
import type { ColorTheme } from '../lib/theme';
import ProjectDefaultsEditor from './ProjectDefaultsEditor';
import UpdatesPanel from './UpdatesPanel';
import { useDialogBackdropDismiss } from '../lib/dialog-backdrop';

export default function SettingsModal({
  initialPage,
  updateState,
  updateAction,
  openInstaller,
  installBusy,
  defaults,
  project,
  snapshot,
  busy,
  colorTheme,
  close,
  changeTheme,
  saveDefaults,
  readArtwork,
  changeDirectory,
  importDocuments,
  reveal,
}: {
  initialPage: string;
  updateState: UpdateState;
  updateAction: (action: 'checkNow' | 'download' | 'cancel' | 'viewRelease') => void;
  openInstaller: () => void;
  installBusy: boolean;
  defaults: ProjectDefaults;
  project: Project;
  snapshot: ProjectLibrarySnapshot | null;
  busy: boolean;
  colorTheme: ColorTheme;
  close: () => void;
  changeTheme: (theme: ColorTheme) => void;
  saveDefaults: (defaults: ProjectDefaults, apply: boolean) => Promise<void>;
  readArtwork: (file: File) => Promise<CardFace>;
  changeDirectory: () => void;
  importDocuments: () => void;
  reveal: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(initialPage),
    [group, setGroup] = useState<DefaultSettingsGroup>('Sheet'),
    [draft, setDraft] = useState<ProjectDefaults>(() =>
      projectDefaultsFrom(projectFromDefaults(defaults)),
    ),
    [saving, setSaving] = useState(false),
    [readingArtwork, setReadingArtwork] = useState(false),
    [apply, setApply] = useState(false),
    [discard, setDiscard] = useState(false),
    [error, setError] = useState('');
  const changed = !projectDefaultsMatch(draft, defaults),
    working = saving || readingArtwork;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (discard) keepEditing.current?.focus();
  }, [discard]);
  const requestClose = () => {
    if (working) return;
    if (changed) setDiscard(true);
    else close();
  };
  const backdropDismiss = useDialogBackdropDismiss(requestClose);
  const update = (value: ProjectDefaults) => {
    setDraft(value);
    setError('');
    setDiscard(false);
  };
  async function save() {
    setError('');
    const issue = defaultSettingsIssue(draft.settings);
    if (issue) {
      setPage('New project defaults');
      setGroup(issue.group);
      setError(issue.message);
      return;
    }
    let validated: ProjectDefaults;
    try {
      validated = validateProjectDefaults(draft);
    } catch (cause) {
      setPage('New project defaults');
      setError(cause instanceof Error ? cause.message : 'Check your default settings.');
      return;
    }
    setSaving(true);
    try {
      await saveDefaults(validated, apply);
      setDraft(validated);
      setApply(false);
      setDiscard(false);
    } catch {
      setError('Could not save defaults on this device. Your changes are still here; try again.');
    } finally {
      setSaving(false);
    }
  }
  const fileExplorerName =
    window.criprox?.platform === 'darwin'
      ? 'Finder'
      : window.criprox?.platform === 'win32'
        ? 'File Explorer'
        : 'file manager';
  return (
    <dialog
      ref={dialog}
      className="modal wide app-settings-modal settings-workspace"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      {...backdropDismiss}
    >
      <div className="modal-heading">
        <div>
          <h2 id="settings-title">Settings</h2>
          <p>Your preferred setup, all in one place.</p>
        </div>
        <button
          className="icon-button"
          disabled={working}
          aria-label="Close settings"
          onClick={requestClose}
        >
          <X size={20} />
        </button>
      </div>
      <nav className="settings-page-nav" aria-label="Settings pages">
        {['New project defaults', 'Appearance', 'Project library', 'AI design', 'Updates'].map(
          (item) => (
            <button
              key={item}
              type="button"
              aria-current={page === item ? 'page' : undefined}
              onClick={() => {
                setPage(item);
                setDiscard(false);
              }}
            >
              {item}
            </button>
          ),
        )}
      </nav>
      <div className="settings-workspace-content">
        {page === 'AI design' && <AiDesignSettings />}
        <section hidden={page !== 'New project defaults'} aria-label="New project defaults">
          <div className="settings-page-heading">
            <div>
              <h3>New project defaults</h3>
              <p>
                Edit the setup for future projects. Saving keeps the current deck as it is unless
                you choose to apply these defaults.
              </p>
            </div>
            <div className="settings-draft-tools">
              <button
                className="secondary compact"
                disabled={working}
                onClick={() => update(projectDefaultsFrom(project))}
              >
                Use current project
              </button>
              <button
                className="text-button compact"
                disabled={working}
                onClick={() =>
                  update(projectDefaultsFrom(projectFromDefaults(FACTORY_PROJECT_DEFAULTS)))
                }
              >
                <RotateCcw size={13} /> Reset to factory
              </button>
            </div>
          </div>
          <ProjectDefaultsEditor
            draft={draft}
            change={update}
            readArtwork={readArtwork}
            working={setReadingArtwork}
            disabled={working}
            group={group}
            changeGroup={setGroup}
          />
        </section>
        <section hidden={page !== 'Appearance'} aria-label="Appearance">
          <div className="settings-page-heading">
            <div>
              <h3>Appearance</h3>
              <p>Theme changes apply immediately on this device.</p>
            </div>
          </div>
          <div className="segmented settings-theme-options" aria-label="Color theme">
            <button
              className={colorTheme === 'light' ? 'selected' : ''}
              aria-pressed={colorTheme === 'light'}
              onClick={() => changeTheme('light')}
            >
              <Sun size={14} /> Light
            </button>
            <button
              className={colorTheme === 'dark' ? 'selected' : ''}
              aria-pressed={colorTheme === 'dark'}
              onClick={() => changeTheme('dark')}
            >
              <Moon size={14} /> Dark
            </button>
          </div>
        </section>
        <section hidden={page !== 'Project library'} aria-label="Project library">
          <div className="settings-page-heading">
            <div>
              <h3>Project library</h3>
              <p>
                Choose where saved projects and their artwork are stored. Folder changes apply
                immediately.
              </p>
            </div>
          </div>
          <div className="settings-library-location">
            <div>
              <strong>{snapshot?.isDefault ? 'Skarix projects' : 'Custom projects folder'}</strong>
              <span title={snapshot?.root}>
                {snapshot?.root || 'Finding your projects folder…'}
              </span>
            </div>
            <button className="secondary compact" disabled={busy || !snapshot} onClick={reveal}>
              <ExternalLink size={14} /> Open in {fileExplorerName}
            </button>
          </div>
          <div className="app-settings-actions">
            <button className="secondary compact" disabled={busy} onClick={changeDirectory}>
              <FolderCog size={14} /> Change folder
            </button>
            {snapshot?.canImportDocumentsLibrary && (
              <button className="secondary compact" disabled={busy} onClick={importDocuments}>
                <Upload size={14} /> Import old library
              </button>
            )}
          </div>
        </section>
        <section hidden={page !== 'Updates'} aria-label="Updates">
          <UpdatesPanel
            state={updateState}
            action={updateAction}
            openInstaller={openInstaller}
            installBusy={installBusy}
            installDisabled={working || changed}
          />
          {changed && page === 'Updates' && (
            <p className="hint">Save or undo your default changes before installing the update.</p>
          )}
        </section>
      </div>
      <div className="settings-save-footer">
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        {discard ? (
          <div className="settings-discard" role="alert">
            <p>You have unsaved default changes.</p>
            <button
              ref={keepEditing}
              className="secondary compact"
              onClick={() => setDiscard(false)}
            >
              Keep editing
            </button>
            <button className="text-button compact" onClick={close}>
              Discard changes
            </button>
          </div>
        ) : (
          <>
            <div className="settings-save-status">
              <span role="status">
                {readingArtwork
                  ? 'Reading artwork…'
                  : saving
                    ? 'Saving…'
                    : changed
                      ? 'Unsaved default changes'
                      : 'Defaults are saved'}
              </span>
              <label className="settings-apply-choice">
                <input
                  type="checkbox"
                  checked={apply}
                  disabled={working}
                  onChange={(event) => setApply(event.target.checked)}
                />{' '}
                Also apply to current project
              </label>
            </div>
            <div className="settings-save-actions">
              {changed && (
                <button
                  className="text-button compact"
                  disabled={working}
                  onClick={() => update(projectDefaultsFrom(projectFromDefaults(defaults)))}
                >
                  Undo changes
                </button>
              )}
              <button className="secondary compact" disabled={working} onClick={requestClose}>
                Done
              </button>
              <button
                className="primary compact"
                disabled={working || (!changed && !apply)}
                onClick={() => void save()}
              >
                <Save size={14} />{' '}
                {saving
                  ? 'Saving…'
                  : apply
                    ? changed
                      ? 'Save and apply defaults'
                      : 'Apply defaults'
                    : 'Save defaults'}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
