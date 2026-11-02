import { createStarterProject } from '../lib/starter-project';
import { designOutputBounds } from '../lib/sticker-contours';
import { createPortal } from 'react-dom';
import { useWorkspaceHistory } from '../lib/use-workspace-history';
import { useAiWorkspace } from '../lib/use-ai-design';
import {
  WorkspaceGrid,
  WorkspacePanel,
  WorkspacePanelHeading,
  SheetNavigation,
  ZoomControl,
  MachineSelect,
  PaperOptions,
} from './WorkspaceChrome';
import { printPdf } from '../lib/direct-print';
import { generateMarkedPrint, generatedPrintBundle } from '../lib/generated-print';
import { MACHINE_NAMES } from '../lib/machine-guides';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runStickerLayout } from '../lib/sticker-layout-task';
import WorkspaceContextMenu, { type WorkspaceMenuTarget } from './WorkspaceContextMenu';
import { get, set } from 'idb-keyval';
import { Download, FolderOpen, Plus, Save, Layers3, SlidersHorizontal } from 'lucide-react';
import { type RegistrationProfile } from '../lib/registration';
import { setupPng } from '../lib/registered-pdf';
import { download } from '../lib/export';
import { filenameStem } from '../lib/filenames';
import {
  changeStickerSettings,
  fillStickerSheet,
  MAX_STICKER_FILE_BYTES,
  newStickerProject,
  parseStickerProject,
  stickerGeometryKey,
  stickerLayoutSettings,
  stickerSheets,
  validateStickerProject,
  stickerTemplate,
  type StickerProject,
  type StickerSettings,
  type StickerArtwork,
} from '../lib/stickers';
import {
  base64ToBytes,
  buildStickerHandoff,
  buildStickerPdf,
  bytesToBase64,
  captureStickerProfile,
  readStickerArtwork,
} from '../lib/sticker-output';
import { importStickerSvg } from '../lib/sticker-svg';
import StickerCanvas from './StickerCanvas';
import StickerDesigner from './StickerDesigner';
import { hasCustomCuts } from '../lib/sticker-cuts';
import { newDesign, newElement, type StickerDesign } from '../lib/sticker-design';
import { workspaceShortcut, isTextEditing } from '../lib/workspace-history';
import {
  copySticker,
  pasteSticker,
  pasteStickerDesign,
  type StickerClipboard,
} from '../lib/sticker-clipboard';
import PrintCutWorkflow from './PrintCutWorkflow';
import CutSettingsControls from './CutSettingsControls';
import {
  appendSticker,
  duplicateSticker,
  editSticker,
  removeStickers,
  stickerPoses,
  hasStickerOverlap,
  type StickerPose,
} from '../lib/stickers';

const draftKey = 'criprox-sticker-draft-v1';
function DimensionInput({
  value,
  change,
  min = 0,
  step = 0.5,
}: {
  value: number;
  change: (value: number) => void;
  min?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      step={step}
      min={min}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        change(text === '' ? NaN : Number(text));
        setText(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
export default function StickerStudio({
  open,
  printRequest,
  titleHost,
  actionsHost,
  request,
  onDraft,
  onRemember,
  onAiOpen,
  onBusyChange,
}: {
  open: boolean;
  printRequest: number;
  titleHost: HTMLDivElement | null;
  actionsHost: HTMLDivElement | null;
  request?: { sequence: number; project?: StickerProject };
  onDraft?: (project: StickerProject) => void;
  onRemember?: (project: StickerProject, fresh?: boolean | string) => Promise<void>;
  onAiOpen?: (fresh?: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const clipboard = useRef<StickerClipboard | undefined>(undefined);
  const designClipboard = useRef<StickerArtwork | undefined>(undefined);
  const [designMenu, setDesignMenu] = useState<WorkspaceMenuTarget & { id: string }>();
  const closeDesignMenu = useCallback(() => setDesignMenu(undefined), []);
  const [renaming, setRenaming] = useState<{ id: string; name: string }>();
  const renameDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (renaming) renameDialog.current?.showModal();
  }, [renaming?.id]);
  useEffect(() => {
    if (!open) {
      setDesignMenu(undefined);
      setRenaming(undefined);
    }
  }, [open]);
  const [designer, setDesigner] = useState<{ id?: string; name: string; design: StickerDesign }>();
  const [showCuts, setShowCuts] = useState(false);
  const artworkInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    captureInput = useRef<HTMLInputElement>(null),
    groupedInput = useRef<HTMLInputElement>(null);
  type Snapshot = { project: StickerProject; profile?: RegistrationProfile };
  const history = useWorkspaceHistory<Snapshot>(() => ({ project: newStickerProject() }));
  const { project, profile } = history.value;
  const setProject = (project: StickerProject) =>
    history.replace((current) => ({ ...current, project }));
  const setProfile = (profile: RegistrationProfile | undefined) =>
    history.replace((current) => ({ ...current, profile }));
  const [selected, setSelected] = useState(''),
    [selectedSticker, setSelectedSticker] = useState(-1),
    [busy, setBusy] = useState(''),
    [message, setMessage] = useState(''),
    [loaded, setLoaded] = useState(false),
    [page, setPage] = useState(0),
    [saved, setSaved] = useState('Opening local draft…'),
    [view, setView] = useState<'edit' | 'print'>('edit'),
    [zoom, setZoom] = useState(100);
  useEffect(() => {
    onBusyChange?.(!loaded || !!busy || !!designer);
  }, [loaded, busy, designer, onBusyChange]);
  const layoutTask = useRef<AbortController | undefined>(undefined);
  useAiWorkspace('stickers', {
    read: () => project,
    beforeReplace: async () => {
      if (project.artwork.length) await onRemember?.(project);
    },
    write: (next) => {
      commit(next as StickerProject);
      setDesigner(undefined);
      setSelected('');
      setSelectedSticker(-1);
      setPage(0);
    },
    open: (fresh) => {
      if (fresh) setProfile(undefined);
      setView('edit');
      onAiOpen?.(fresh);
    },
    undo: history.undo,
    redo: history.redo,
    busy: () => !loaded || !!busy || !!designer,
  });
  useEffect(() => () => layoutTask.current?.abort(), []);
  useEffect(() => {
    if (!open) layoutTask.current?.abort();
  }, [open]);
  const writes = useRef(Promise.resolve());
  const poses = useMemo(() => stickerPoses(project), [project]),
    selectedPose = poses[selectedSticker],
    overlaps = useMemo(() => hasStickerOverlap(project), [project]);
  const checkpoint = history.checkpoint;
  function commit(next: StickerProject) {
    history.setValue((current) => ({ ...current, project: next }));
  }
  function undo(redo = false) {
    if (redo) history.redo();
    else history.undo();
  }
  function removeSelectedDesign(id = selected) {
    if (!project.artwork.some((artwork) => artwork.id === id)) return;
    commit({
      ...removeStickers(
        project,
        project.items.flatMap((item, i) => (item === id ? [i] : [])),
      ),
      artwork: project.artwork.filter((artwork) => artwork.id !== id),
    });
    setSelected('');
    setSelectedSticker(-1);
    setMessage('Design and its sheet copies deleted. Ctrl+Z restores them.');
  }
  function edit(patch: Partial<StickerPose>) {
    try {
      commit(editSticker(project, selectedSticker, patch));
      setMessage('');
    } catch (e) {
      setMessage(String(e));
    }
  }
  const lastPersisted = useRef(project);
  const settings = stickerLayoutSettings(project.settings, project.machine),
    template = stickerTemplate(project.settings),
    sheets = stickerSheets(project),
    capacity = template.placements.length,
    sheetIndex = Math.min(page, Math.max(0, sheets.length - 1)),
    matchingProfile =
      !project.poses &&
      project.capture?.key === profile?.key &&
      profile?.key === stickerGeometryKey(project.settings, project.machine)
        ? profile
        : undefined;

  useEffect(() => {
    if (printRequest && !designer) setView('print');
  }, [printRequest]);
  useEffect(() => {
    if (loaded) onDraft?.(project);
  }, [project, loaded, onDraft]);
  const handledRequest = useRef(0);
  useEffect(() => {
    if (!loaded || busy || !request || request.sequence === handledRequest.current) return;
    handledRequest.current = request.sequence;
    void run('Opening sticker project…', async () => {
      await applyStickerProject(request.project ?? newStickerProject());
      setDesigner(undefined);
      setView('edit');
    });
  }, [request?.sequence, loaded, busy]);
  function clipboardAction(action: 'copy' | 'cut' | 'paste') {
    if (action === 'paste') {
      if (designClipboard.current) {
        duplicateDesign(designClipboard.current);
        return;
      }
      if (!clipboard.current) return;
      try {
        const next = pasteSticker(project, clipboard.current, sheetIndex);
        commit(next);
        setSelectedSticker(project.items.length);
        setSelected(next.items.at(-1) || '');
        setMessage('Pasted sticker.');
      } catch (e) {
        setMessage(String(e));
      }
      return;
    }
    if (!selectedPose) {
      const artwork = project.artwork.find((a) => a.id === selected);
      if (!artwork) return;
      designClipboard.current = structuredClone(artwork);
      clipboard.current = undefined;
      if (action === 'cut') removeSelectedDesign();
      setMessage(
        action === 'cut'
          ? 'Design cut. Paste restores its artwork as a new library design; Ctrl+Z restores its sheet copies.'
          : 'Design copied. Paste adds an independent library design.',
      );
      return;
    }
    const clip = copySticker(project, selectedSticker);
    if (!clip) return;
    clipboard.current = clip;
    designClipboard.current = undefined;
    if (action === 'cut') {
      commit(removeStickers(project, [selectedSticker]));
      setSelectedSticker(-1);
      setSelected('');
    }
    setMessage(action === 'cut' ? 'Sticker cut. Use Paste to place it.' : 'Sticker copied.');
  }
  function duplicateDesign(artwork: StickerArtwork) {
    try {
      const next = pasteStickerDesign(project, artwork);
      commit(next);
      setSelected(next.artwork.at(-1)!.id);
      setSelectedSticker(-1);
      setMessage('Design duplicated in the library. Use Add one to place it.');
    } catch (error) {
      setMessage(String(error));
    }
  }
  function menuAction(action: () => void) {
    designMenu?.anchor.focus({ preventScroll: true });
    closeDesignMenu();
    try {
      action();
    } catch (error) {
      setMessage(String(error));
    }
  }
  useEffect(() => {
    if (!open || busy || !loaded || view !== 'edit' || designer) return;
    const handler = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      const action = workspaceShortcut(event, isTextEditing(event.target));
      if (!action) return;
      event.preventDefault();
      if (action === 'undo' || action === 'redo') undo(action === 'redo');
      else if (action === 'delete') {
        if (selectedPose) {
          commit(removeStickers(project, [selectedSticker]));
          setSelectedSticker(-1);
          setSelected('');
          setMessage('Sticker deleted. Ctrl+Z restores it.');
        } else removeSelectedDesign();
      } else clipboardAction(action);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const savedDraft = await get<StickerProject>(draftKey);
        const stored = savedDraft === undefined ? await createStarterProject() : savedDraft;
        if (stored && active) {
          const next = validateStickerProject(stored);
          lastPersisted.current = next;
          setProject(next);
          setSelected(next.artwork[0]?.id || '');
          if (next.capture) {
            const captured = await captureStickerProfile(
              base64ToBytes(next.capture.pdf),
              next,
              next.capture.name,
            );
            if (active) setProfile(captured);
          }
        }
      } catch (error) {
        if (active) setMessage(`Draft or captured marks could not be restored: ${String(error)}`);
      } finally {
        if (active) {
          setLoaded(true);
          setSaved('Local draft ready');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!loaded || project === lastPersisted.current) return;
    lastPersisted.current = project;
    let active = true;
    setSaved('Saving local draft…');
    writes.current = writes.current.catch(() => {}).then(() => set(draftKey, project));
    void writes.current.then(
      () => {
        if (active) setSaved('Draft saved on this device');
      },
      () => {
        if (active) setSaved('Autosave failed — use Save file');
      },
    );
    return () => {
      active = false;
    };
  }, [project, loaded]);

  async function layoutAction(action: 'arrange' | 'fill', id?: string) {
    if (busy || !loaded || layoutTask.current) return;
    if (action === 'fill' && project.capture && !project.poses) {
      commit(fillStickerSheet(project, id));
      return;
    }
    const controller = new AbortController();
    layoutTask.current = controller;
    setBusy(action === 'arrange' ? 'Arranging stickers…' : 'Filling sheet…');
    setMessage('');
    try {
      const result = await runStickerLayout(project, action, {
        selected: id,
        signal: controller.signal,
        progress: setBusy,
      });
      if (!controller.signal.aborted) {
        commit(result.project);
        setPage(action === 'arrange' ? 0 : Math.max(0, stickerSheets(result.project).length - 1));
        setMessage(
          result.limited
            ? 'Layout ready. Complex shapes used the safe grid fallback.'
            : 'Layout ready. Ctrl+Z restores the previous positions.',
        );
      }
    } catch (error) {
      setMessage(
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Layout cancelled. Previous positions kept.'
          : String(error),
      );
    } finally {
      if (layoutTask.current === controller) {
        layoutTask.current = undefined;
        setBusy('');
      }
    }
  }
  async function run(label: string, action: () => Promise<void>) {
    if (busy || !loaded) return;
    setBusy(label);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }
  function update(settings: StickerSettings) {
    try {
      commit(changeStickerSettings(project, settings));
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  function saveBytes(bytes: Uint8Array, suffix: string, mime: string) {
    download(
      new Blob([bytes.slice().buffer], { type: mime }),
      `${filenameStem(project.name, 'stickers')}-${suffix}`,
    );
  }
  async function addArtwork(files: File[], splitGroups = false) {
    let next = project;
    let bytes = project.artwork.reduce((sum, a) => sum + a.image.length, 0);
    for (const file of [...files].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    )) {
      const imported =
        /\.svg$/i.test(file.name) || file.type === 'image/svg+xml'
          ? await importStickerSvg(file, splitGroups)
          : await (async () => {
              const image = await readStickerArtwork(file),
                bitmap = await createImageBitmap(file);
              const width = next.settings.width,
                height = (width * bitmap.height) / bitmap.width;
              bitmap.close();
              return [{ name: file.name, image, sizeMm: { width, height } }];
            })();
      for (const image of imported) {
        bytes += image.image.length;
        if (bytes > 50_000_000 || next.items.length >= 500 || next.artwork.length >= 500)
          throw new Error('Use at most 500 stickers and 50 MB of embedded artwork per project.');
        const a = { id: crypto.randomUUID(), name: image.name.slice(0, 200), image: image.image };
        next = { ...next, artwork: [...next.artwork, a] };
        if (!next.poses && next.settings.layout === 'tapered')
          next = { ...next, items: [...next.items, a.id] };
        else {
          const size = image.sizeMm ?? { width: next.settings.width, height: next.settings.height };
          const scale = Math.min(
            1,
            next.settings.areaWidth / size.width,
            next.settings.areaHeight / size.height,
          );
          next = appendSticker(next, a.id, {
            width: Math.max(1, size.width * scale),
            height: Math.max(1, size.height * scale),
          });
        }
      }
    }
    next = validateStickerProject(next);
    commit(next);
    setSelectedSticker(next.items.length - 1);
    setSelected(next.artwork.at(-1)?.id || '');
    setPage(stickerPoses(next).at(-1)?.sheet ?? 0);
    setMessage(
      `Imported ${next.artwork.length - project.artwork.length} designs. Select each sticker to move, resize, rotate, mirror, or flip it.`,
    );
  }
  async function openProject(file: File) {
    if (file.size > MAX_STICKER_FILE_BYTES) throw new Error('Sticker project exceeds 90 MB.');
    const next = parseStickerProject(await file.text());
    if (project.artwork.length) await onRemember?.(project);
    await applyStickerProject(next);
    await onRemember?.(next, `file:stickers:${file.name}:${file.lastModified}`);
  }
  async function applyStickerProject(next: StickerProject) {
    next = validateStickerProject(next);
    let captured: RegistrationProfile | undefined;
    if (next.capture)
      captured = await captureStickerProfile(
        base64ToBytes(next.capture.pdf),
        next,
        next.capture.name,
      );
    commit(next);
    setSelectedSticker(-1);
    setProfile(captured);
    setSelected(next.artwork[0]?.id || '');
    setPage(0);
    setMessage('Opened local sticker file, including its artwork and any verified capture.');
  }
  async function saveFile() {
    const data = JSON.stringify(validateStickerProject(project));
    if (new TextEncoder().encode(data).byteLength > MAX_STICKER_FILE_BYTES)
      throw new Error('Sticker project exceeds 90 MB.');
    const name = `${filenameStem(project.name, 'stickers')}.skarix.json`;
    if (window.criprox?.saveProject) {
      const result = await window.criprox.saveProject(name, data);
      setMessage(
        result ? 'Saved sticker file with embedded artwork and captured marks.' : 'Save cancelled.',
      );
      if (result) await onRemember?.(project);
    } else {
      download(new Blob([data], { type: 'application/json' }), name);
      setMessage('Sticker file downloaded.');
      await onRemember?.(project);
    }
  }
  function designArtwork(id?: string) {
    const artwork = project.artwork.find((a) => a.id === id);
    const pose = stickerPoses(project)[project.items.indexOf(id || '')];
    const design = artwork?.design
      ? structuredClone(artwork.design)
      : newDesign(pose?.width || project.settings.width, pose?.height || project.settings.height);
    if (artwork && !artwork.design)
      design.elements = [
        {
          ...newElement('image', design),
          image: artwork.image,
          x: 0,
          y: 0,
          width: design.width,
          height: design.height,
        },
      ];
    setDesigner({ id: artwork?.id, name: artwork?.name || 'Custom sticker', design });
  }
  function saveDesign(name: string, design: StickerDesign, image: string) {
    if (!designer) return;
    const id = designer.id || crypto.randomUUID();
    const artwork = { id, name, image, design };
    let next = {
      ...project,
      artwork: designer.id
        ? project.artwork.map((a) => (a.id === id ? artwork : a))
        : [...project.artwork, artwork],
    };
    const bounds = designOutputBounds(design);
    if (!designer.id) next = appendSticker(next, id, bounds);
    else {
      const previous = project.artwork.find((a) => a.id === id)?.design;
      const oldBounds = previous ? designOutputBounds(previous) : design;
      next = {
        ...next,
        version: 2,
        capture: undefined,
        poses: stickerPoses(project).map((pose, i) => {
          if (project.items[i] !== id) return pose;
          const width = (pose.width * bounds.width) / oldBounds.width;
          const height = (pose.height * bounds.height) / oldBounds.height;
          return { ...pose, width, height, radius: Math.min(pose.radius, width / 2, height / 2) };
        }),
      };
    }
    if (hasCustomCuts(design)) next = { ...next, capture: undefined };
    commit(validateStickerProject(next));
    setSelected(id);
    setSelectedSticker(next.items.indexOf(id));
    setDesigner(undefined);
    setMessage('Editable design saved to the sheet.');
  }
  return (
    <section className="sticker-studio" hidden={!open} aria-label="Sticker workspace">
      {open &&
        titleHost &&
        createPortal(
          <>
            <button
              className="breadcrumb"
              disabled={!!designer}
              onClick={() => projectInput.current?.click()}
            >
              Workspace
            </button>{' '}
            <input
              aria-label="Sticker project name"
              maxLength={100}
              value={project.name}
              disabled={!!busy || !loaded || !!designer}
              onChange={(e) => commit({ ...project, name: e.target.value })}
            />
            <span className="local-badge">LOCAL DRAFT</span>
          </>,
          titleHost,
        )}
      {open &&
        actionsHost &&
        createPortal(
          <>
            <span className="top-action-divider" />{' '}
            <button
              className="secondary compact"
              disabled={!!busy || !loaded || !!designer}
              onClick={async () => {
                if (
                  project.artwork.length &&
                  !window.confirm(
                    'Start a new sticker project? Save a file first if you want to keep this draft.',
                  )
                )
                  return;
                try {
                  if (project.artwork.length) await onRemember?.(project);
                  const next = newStickerProject();
                  await onRemember?.(next, true);
                  commit(next);
                } catch (error) {
                  setMessage(String(error));
                  return;
                }
                setSelectedSticker(-1);
                setProfile(undefined);
                setSelected('');
                setPage(0);
                setMessage('New sticker project.');
              }}
            >
              New
            </button>
            <button
              className="secondary compact"
              disabled={!!busy || !loaded || !!designer}
              onClick={() => projectInput.current?.click()}
            >
              <FolderOpen size={16} /> Open
            </button>
            <button
              className="secondary compact"
              disabled={!!busy || !loaded || !!designer}
              onClick={() => void run('Saving sticker file…', saveFile)}
            >
              <Save size={16} /> Save
            </button>
          </>,
          actionsHost,
        )}
      {designer && (
        <StickerDesigner
          key={designer.id || 'new'}
          initial={designer.design}
          name={designer.name}
          active={open}
          cutRadius={project.settings.radius}
          fitCutDefaults={{
            borderWidth: project.settings.borderWidth ?? 1,
            strokeWidth: project.settings.borderStrokeWidth ?? 0,
            strokeColor: project.settings.borderStrokeColor ?? '#222222',
          }}
          onSave={saveDesign}
          onClose={() => setDesigner(undefined)}
        />
      )}
      <nav
        className="sticker-view-tabs"
        hidden={view !== 'print' || !!designer}
        aria-label="Sticker workspace views"
      >
        <button
          className={view === 'edit' ? 'active' : ''}
          aria-pressed={view === 'edit'}
          onClick={() => setView('edit')}
        >
          Edit stickers
        </button>
        <button
          className={view === 'print' ? 'active' : ''}
          aria-pressed={view === 'print'}
          onClick={() => setView('print')}
        >
          Print then cut
        </button>
      </nav>
      <fieldset
        disabled={!!busy || !loaded || !!designer}
        className="sticker-controls"
        hidden={!!designer}
      >
        <div className="sticker-edit-view workspace-editor" hidden={view !== 'edit'}>
          <WorkspaceGrid>
            <WorkspacePanel kind="library">
              <WorkspacePanelHeading title="Your stickers" badge={project.items.length} />
              <div className="workspace-sidebar-content sticker-inputs">
                <div className="workspace-input-actions">
                  <button className="primary" onClick={() => designArtwork()}>
                    Create sticker
                  </button>
                  <button
                    className="secondary"
                    disabled={!selected}
                    onClick={() => designArtwork(selected)}
                  >
                    Edit design
                  </button>
                  <button className="secondary" onClick={() => artworkInput.current?.click()}>
                    <Plus size={15} /> Add artwork
                  </button>
                  <button
                    className="secondary compact"
                    onClick={() => groupedInput.current?.click()}
                  >
                    Import labels from grouped SVG
                  </button>
                  <p className="muted">
                    Select many PNG, JPEG, WebP, or plain SVG files at once. Grouped SVG imports one
                    design per top-level group. SVGs render locally at up to 600 DPI.
                  </p>
                  <div className="list-caption">
                    <span>ARTWORK / DESIGN</span>
                    <button
                      className="text-button"
                      aria-pressed={!selected}
                      onClick={() => {
                        setSelected('');
                        setSelectedSticker(-1);
                      }}
                    >
                      All designs
                    </button>
                  </div>
                  <div className="sticker-artwork-list" aria-label="Sticker designs">
                    {project.artwork.map((artwork) => (
                      <button
                        key={artwork.id}
                        className={
                          'card-select sticker-artwork-row ' +
                          (selected === artwork.id ? 'selected' : '')
                        }
                        aria-pressed={selected === artwork.id}
                        aria-haspopup="menu"
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setSelected(artwork.id);
                          setSelectedSticker(-1);
                          setDesignMenu({
                            id: artwork.id,
                            anchor: event.currentTarget,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key !== 'ContextMenu' &&
                            !(event.shiftKey && event.key === 'F10')
                          )
                            return;
                          event.preventDefault();
                          const rect = event.currentTarget.getBoundingClientRect();
                          setSelected(artwork.id);
                          setSelectedSticker(-1);
                          setDesignMenu({
                            id: artwork.id,
                            anchor: event.currentTarget,
                            x: rect.left,
                            y: rect.bottom,
                          });
                        }}
                        onClick={() => {
                          setSelected(artwork.id);
                          const index = project.items.indexOf(artwork.id);
                          setSelectedSticker(-1);
                          if (index >= 0) setPage(poses[index].sheet);
                        }}
                      >
                        <img src={artwork.image} alt="" />
                        <span>
                          <strong>{artwork.name}</strong>
                          <small>
                            {project.items.filter((id) => id === artwork.id).length} on sheets
                          </small>
                        </span>
                      </button>
                    ))}
                    {!project.artwork.length && (
                      <div className="empty-library">
                        <Layers3 size={28} />
                        <strong>A fresh start</strong>
                        <p>Add images or SVGs to build your sticker sheets.</p>
                      </div>
                    )}
                  </div>
                  <div className="sticker-actions">
                    <button
                      className="secondary compact"
                      disabled={!selected || project.items.length >= 500}
                      onClick={() => {
                        try {
                          const next = appendSticker(project, selected);
                          commit(next);
                          setSelectedSticker(project.items.length);
                          setPage(stickerPoses(next).at(-1)?.sheet ?? 0);
                        } catch (e) {
                          setMessage(String(e));
                        }
                      }}
                    >
                      Add one
                    </button>
                    <button
                      className="primary compact"
                      disabled={
                        !project.artwork.length ||
                        (!project.poses &&
                          project.items.length > 0 &&
                          project.items.length % capacity === 0)
                      }
                      onClick={() => {
                        try {
                          void layoutAction('fill', selected || undefined);
                        } catch (e) {
                          setMessage(String(e));
                        }
                      }}
                    >
                      Fill last sheet
                    </button>
                  </div>
                  <div className="sticker-actions">
                    <button
                      className="text-button"
                      disabled={!project.items.length}
                      onClick={() => {
                        commit(removeStickers(project, [project.items.length - 1]));
                        setSelectedSticker(-1);
                        setSelected('');
                      }}
                    >
                      Remove last sticker
                    </button>
                    <button
                      className="text-button"
                      disabled={!selected}
                      onClick={() => removeSelectedDesign()}
                    >
                      Remove design
                    </button>
                  </div>
                </div>
                <section className="sticker-inspector selection-details">
                  <div className="section-label">SELECTED STICKER</div>
                  {selectedPose ? (
                    <>
                      <p>
                        {project.artwork.find((a) => a.id === project.items[selectedSticker])?.name}
                      </p>
                      <div className="sticker-dimensions">
                        {(['x', 'y', 'width', 'height', 'rotation', 'radius'] as const).map(
                          (key) => (
                            <label key={key}>
                              {
                                {
                                  x: 'X (mm)',
                                  y: 'Y (mm)',
                                  width: 'Width (mm)',
                                  height: 'Height (mm)',
                                  rotation: 'Rotation (°)',
                                  radius: 'Corner radius (mm)',
                                }[key]
                              }
                              <DimensionInput
                                value={selectedPose[key]}
                                min={key === 'rotation' ? -360 : 0}
                                change={(value) => edit({ [key]: value })}
                              />
                            </label>
                          ),
                        )}
                      </div>
                      <div className="sticker-actions">
                        <button
                          className="secondary compact"
                          onClick={() => edit({ rotation: selectedPose.rotation + 90 })}
                        >
                          Rotate 90°
                        </button>
                        <button
                          className="secondary compact"
                          aria-pressed={selectedPose.flipX}
                          onClick={() => edit({ flipX: !selectedPose.flipX })}
                        >
                          Mirror horizontally
                        </button>
                        <button
                          className="secondary compact"
                          aria-pressed={selectedPose.flipY}
                          onClick={() => edit({ flipY: !selectedPose.flipY })}
                        >
                          Flip vertically
                        </button>
                        <button
                          className="secondary compact"
                          onClick={() => {
                            try {
                              commit(duplicateSticker(project, selectedSticker));
                              setSelectedSticker(project.items.length);
                            } catch (e) {
                              setMessage(String(e));
                            }
                          }}
                        >
                          Duplicate
                        </button>
                        <button
                          className="text-button"
                          onClick={() => {
                            commit(removeStickers(project, [selectedSticker]));
                            setSelectedSticker(-1);
                            setSelected('');
                          }}
                        >
                          Delete selected
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="muted">
                      Select a sticker on the canvas to edit it independently.
                    </p>
                  )}
                </section>

                <div className="sticker-actions selection-clipboard">
                  {' '}
                  <button
                    className="secondary compact"
                    disabled={!history.canUndo}
                    onClick={() => undo()}
                  >
                    Undo
                  </button>
                  <button
                    className="secondary compact"
                    disabled={!history.canRedo}
                    onClick={() => undo(true)}
                  >
                    Redo
                  </button>
                  <button
                    className="secondary compact"
                    disabled={!selectedPose && !selected}
                    onClick={() => clipboardAction('cut')}
                    title="Ctrl+X"
                  >
                    Cut
                  </button>
                  <button
                    className="secondary compact"
                    disabled={!selectedPose && !selected}
                    onClick={() => clipboardAction('copy')}
                    title="Ctrl+C"
                  >
                    Copy
                  </button>
                  <button
                    className="secondary compact"
                    disabled={!clipboard.current && !designClipboard.current}
                    onClick={() => clipboardAction('paste')}
                    title="Ctrl+V"
                  >
                    Paste
                  </button>
                </div>
              </div>
              <div className="library-footer">
                {project.artwork.length} designs · Files stay on this device.
              </div>
            </WorkspacePanel>
            <WorkspacePanel kind="preview-panel">
              <div className="preview-toolbar">
                <div className="segmented">
                  <button className="selected" type="button">
                    <Layers3 size={14} /> Print sheet
                  </button>
                </div>
                <ZoomControl value={zoom} onChange={setZoom} />
                <button
                  className="secondary compact"
                  aria-pressed={showCuts}
                  onClick={() => setShowCuts(!showCuts)}
                >
                  Show cuts
                </button>
              </div>
              <div className="preview-canvas sticker-sheet-canvas">
                <div className="sheet-label">
                  <span className="status-dot" />
                  {sheets[sheetIndex]?.placements.length || 0} stickers on this sheet
                  <span className="view-label">PREVIEW ONLY</span>
                </div>
                <StickerCanvas
                  showCuts={showCuts}
                  zoom={zoom / 100}
                  project={project}
                  profile={matchingProfile}
                  page={sheetIndex}
                  selected={selectedSticker}
                  select={(index) => {
                    setSelectedSticker(index);
                    setSelected(project.items[index] || '');
                  }}
                  change={setProject}
                  checkpoint={checkpoint}
                  error={setMessage}
                />

                {overlaps && (
                  <p className="workflow-error">
                    Some sticker shapes overlap. Move them apart or use Auto arrange.
                  </p>
                )}
                <SheetNavigation index={sheetIndex} count={sheets.length} onChange={setPage} />
              </div>
              <div className="preview-footer">
                <span>
                  {project.settings.areaWidth} × {project.settings.areaHeight} mm layout
                </span>
                <span>{project.settings.dpi} DPI print</span>
              </div>
            </WorkspacePanel>
            <WorkspacePanel kind="settings-panel">
              <WorkspacePanelHeading title="Sheet setup" icon={<SlidersHorizontal size={17} />} />
              <div className="settings-content sticker-setup">
                <MachineSelect
                  id="sticker-machine"
                  value={project.machine}
                  allowManual={false}
                  onChange={(machine) =>
                    commit({
                      ...project,
                      machine: machine as StickerProject['machine'],
                      capture: undefined,
                    })
                  }
                />
                <PaperOptions
                  value={project.settings.paper}
                  units="mm"
                  onChange={(paper) => update({ ...project.settings, paper })}
                />
                <div className="settings-divider" />
                <CutSettingsControls
                  value={project.settings}
                  onChange={(patch) => update({ ...project.settings, ...patch })}
                />

                <div className="section-label">LAYOUT & DEFAULT SIZE</div>
                <div className="sticker-dimensions">
                  {(['width', 'height', 'gap', 'radius'] as const).map((key) => (
                    <label key={key}>
                      {
                        {
                          width: 'Width',
                          height: 'Height',
                          gap: 'Spacing',
                          radius: 'Corner radius',
                        }[key]
                      }{' '}
                      (mm)
                      <DimensionInput
                        min={key === 'radius' ? 0 : key === 'gap' ? 1 : 10}
                        value={project.settings[key]}
                        change={(value) => update({ ...project.settings, [key]: value })}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Arrangement
                  <select
                    value={project.settings.layout}
                    onChange={(e) =>
                      update({
                        ...project.settings,
                        layout: e.target.value as StickerSettings['layout'],
                      })
                    }
                  >
                    <option value="grid">Automatic (grid or nested)</option>
                    <option value="tapered">Tapered top and bottom rows</option>
                  </select>
                </label>
                <div className="sticker-dimensions">
                  {(['areaWidth', 'areaHeight'] as const).map((key) => (
                    <label key={key}>
                      Layout {key === 'areaWidth' ? 'width' : 'height'} limit (mm)
                      <DimensionInput
                        step={1}
                        min={20}
                        value={project.settings[key]}
                        change={(value) => update({ ...project.settings, [key]: value })}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Artwork fit
                  <select
                    value={project.settings.fit}
                    onChange={(e) =>
                      update({ ...project.settings, fit: e.target.value as StickerSettings['fit'] })
                    }
                  >
                    <option value="contain">Keep entire image</option>
                    <option value="cover">Trim empty space — keep artwork</option>
                  </select>
                </label>
                <div className="sticker-dimensions">
                  <label>
                    Border width (mm)
                    <DimensionInput
                      value={project.settings.borderWidth ?? 0}
                      step={0.25}
                      change={(borderWidth) => update({ ...project.settings, borderWidth })}
                    />
                  </label>
                  <label>
                    Border stroke (mm)
                    <DimensionInput
                      value={project.settings.borderStrokeWidth ?? 0}
                      step={0.1}
                      change={(borderStrokeWidth) =>
                        update({ ...project.settings, borderStrokeWidth })
                      }
                    />
                  </label>
                </div>
                <label>
                  Border stroke color
                  <input
                    type="color"
                    value={project.settings.borderStrokeColor ?? '#222222'}
                    onInput={(event) =>
                      update({ ...project.settings, borderStrokeColor: event.currentTarget.value })
                    }
                  />
                </label>
                <p className="muted">
                  Imported stickers keep all text and images inside the cut. Border width adds white
                  padding; a stroke of 0 turns the printed border off. Custom designs keep their own
                  artwork and cut outlines.
                </p>
                <div className="sticker-dimensions">
                  <label>
                    Resolution
                    <select
                      value={project.settings.dpi}
                      onChange={(e) =>
                        update({ ...project.settings, dpi: Number(e.target.value) as 300 | 600 })
                      }
                    >
                      <option value={300}>300 DPI</option>
                      <option value={600}>600 DPI</option>
                    </select>
                  </label>
                </div>
                <p className="muted">
                  Fill and Auto arrange nest closed cut shapes with the selected spacing between
                  their edges. Cuts use custom paths when provided, otherwise the rounded rectangle.
                  Automatic contour tracing and bleed are not included.
                </p>

                <div className="sticker-actions">
                  {' '}
                  <button
                    className="secondary compact"
                    disabled={!project.items.length}
                    onClick={() => {
                      try {
                        void layoutAction('arrange');
                      } catch (e) {
                        setMessage(String(e));
                      }
                    }}
                  >
                    Auto arrange
                  </button>
                </div>
              </div>
            </WorkspacePanel>
          </WorkspaceGrid>
        </div>
        <div className="sticker-print-view" hidden={view !== 'print'}>
          {overlaps && (
            <p className="workflow-error sticker-step">
              Some sticker shapes overlap. Check the layout before exporting; touching silhouettes
              can merge into a single cut.
            </p>
          )}
          <PrintCutWorkflow
            active={open && view === 'print' && !designer}
            generatedInput={{ kind: 'stickers', project }}
            generated
            cutSettings={project.settings}
            onCutSettingsChange={(patch) => update({ ...project.settings, ...patch })}
            kind="stickers"
            machine={project.machine}
            count={project.items.length}
            paper={project.settings.paper}
            jobKey={JSON.stringify([
              project.machine,
              project.settings,
              project.items,
              project.poses,
            ])}
            registered={!!matchingProfile}
            prepareLabel={'Save PDF + matching cut job'}
            onPrepare={() =>
              void run('Preparing sheets…', async () => {
                const result = await generateMarkedPrint({ kind: 'stickers', project }, setBusy);
                saveBytes(
                  await generatedPrintBundle(result),
                  'marked-print.zip',
                  'application/zip',
                );
                setMessage(
                  result.warnings.join(' ') ||
                    'Saved PDF with generated registration marks and matching cut coordinates.',
                );
              })
            }
          />
          <section className="sticker-step">
            <h3>Optional Design Space export and captured templates</h3>
            <p>
              Export artwork to print and cut in Design Space, or capture a full template once for
              experimental PDF reuse.
            </p>
            <div className="sticker-actions">
              <button
                className="secondary"
                disabled={!project.items.length}
                onClick={() =>
                  void run('Exporting artwork…', async () =>
                    saveBytes(
                      await buildStickerHandoff(project, setBusy),
                      'design-space.zip',
                      'application/zip',
                    ),
                  )
                }
              >
                <Download size={15} /> Export artwork + cut reference
              </button>
              <button
                className="secondary"
                disabled={!!project.poses}
                onClick={() =>
                  void run('Creating setup PNG…', async () =>
                    saveBytes(await setupPng(settings, template), 'setup.png', 'image/png'),
                  )
                }
              >
                Save setup PNG
              </button>
              <button
                className="secondary"
                disabled={!!project.poses}
                onClick={() => captureInput.current?.click()}
              >
                Capture Design Space PDF
              </button>
              <button
                className="primary"
                disabled={!matchingProfile || !project.items.length}
                onClick={() =>
                  void run('Creating registered PDF…', async () => {
                    if (matchingProfile)
                      saveBytes(
                        await buildStickerPdf(project, matchingProfile, setBusy),
                        'registered.pdf',
                        'application/pdf',
                      );
                  })
                }
              >
                <Download size={15} /> Save print PDF
              </button>
              <button
                className="secondary"
                disabled={!!busy || !matchingProfile || !project.items.length}
                onClick={() =>
                  void run('Preparing captured sheets…', async () => {
                    if (!matchingProfile) return;
                    const pdf = await buildStickerPdf(project, matchingProfile, setBusy);
                    const result = await printPdf(
                      pdf,
                      'simplex',
                      setBusy,
                      new AbortController().signal,
                    );
                    if (result.status === 'cancelled') return;
                  })
                }
              >
                Print captured sheets…
              </button>
            </div>
            <p className="muted">
              Upload the setup PNG as one flat Print Then Cut image, set {template.width.toFixed(3)}{' '}
              × {template.height.toFixed(3)} mm, and save that project. Select{' '}
              {MACHINE_NAMES[project.machine]} and{' '}
              {project.settings.paper === 'a4' ? 'A4' : 'US Letter'}, turn bleed off, and save the
              complete print page as PDF. Capture it here. Geometry changes require a new capture.
              Blank slots on partial registered pages still get cut.
            </p>
            <p>
              {matchingProfile
                ? 'Captured template measured successfully. Physical cutting has not been validated.'
                : 'Use Prepare print sheets for freely arranged stickers. This optional captured-template workflow requires fixed slots.'}
            </p>
          </section>
        </div>
      </fieldset>
      <input
        hidden
        ref={artworkInput}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length) void run('Importing artwork…', () => addArtwork(files));
        }}
      />
      <input
        hidden
        ref={groupedInput}
        type="file"
        accept="image/svg+xml,.svg"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void run('Importing label groups…', () => addArtwork([file], true));
        }}
      />
      <input
        hidden
        ref={projectInput}
        type="file"
        accept=".json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void run('Opening sticker file…', () => openProject(file));
        }}
      />
      <input
        hidden
        ref={captureInput}
        type="file"
        accept="application/pdf,.pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file)
            void run('Measuring captured template…', async () => {
              if (file.size > 25_000_000) throw new Error('Use a captured PDF under 25 MB.');
              const pdf = new Uint8Array(await file.arrayBuffer()),
                captured = await captureStickerProfile(pdf, project, file.name);
              setProfile(captured);
              setProject({
                ...project,
                capture: {
                  key: stickerGeometryKey(project.settings, project.machine),
                  name: file.name.slice(0, 200),
                  pdf: bytesToBase64(pdf),
                },
              });
              setMessage(
                'Template measured and saved with the local project. Print a test sheet at actual size.',
              );
            });
        }}
      />
      <div className="sticker-footer">
        {busy && layoutTask.current && (
          <button className="secondary compact" onClick={() => layoutTask.current?.abort()}>
            Cancel layout
          </button>
        )}
        <span role="status" aria-live="polite">
          {busy || message || saved}
        </span>
        <span className="muted">
          Ctrl Z · Undo &nbsp; Ctrl Y · Redo &nbsp; Ctrl X / C / V · Cut / Copy / Paste &nbsp;
          Delete · Remove
        </span>
      </div>
      {open && designMenu && project.artwork.some((a) => a.id === designMenu.id) && (
        <WorkspaceContextMenu
          menu={designMenu}
          name={project.artwork.find((a) => a.id === designMenu.id)!.name}
          close={closeDesignMenu}
        >
          <button role="menuitem" onClick={() => menuAction(() => designArtwork(designMenu.id))}>
            Edit design
          </button>
          <button
            role="menuitem"
            onClick={() =>
              menuAction(() =>
                setRenaming({
                  id: designMenu.id,
                  name: project.artwork.find((a) => a.id === designMenu.id)!.name,
                }),
              )
            }
          >
            Rename
          </button>
          <button
            role="menuitem"
            disabled={project.artwork.length >= 500}
            onClick={() =>
              menuAction(() =>
                duplicateDesign(project.artwork.find((a) => a.id === designMenu.id)!),
              )
            }
          >
            Duplicate design
          </button>
          <button role="menuitem" onClick={() => menuAction(() => clipboardAction('cut'))}>
            Cut design
          </button>
          <button role="menuitem" onClick={() => menuAction(() => clipboardAction('copy'))}>
            Copy design
          </button>
          <button
            role="menuitem"
            disabled={!clipboard.current && !designClipboard.current}
            onClick={() => menuAction(() => clipboardAction('paste'))}
          >
            Paste
          </button>
          <hr />
          <button
            role="menuitem"
            disabled={project.items.length >= 500}
            onClick={() =>
              menuAction(() => {
                const next = appendSticker(project, designMenu.id);
                commit(next);
                setSelectedSticker(project.items.length);
                setPage(stickerPoses(next).at(-1)?.sheet ?? 0);
              })
            }
          >
            Add one to sheet
          </button>
          <button
            role="menuitem"
            disabled={project.items.length >= 500}
            onClick={() =>
              menuAction(() => {
                void layoutAction('fill', designMenu.id);
              })
            }
          >
            Fill last sheet
          </button>
          <button
            role="menuitem"
            className="sheet-card-menu-delete"
            disabled={!project.items.includes(designMenu.id)}
            onClick={() =>
              menuAction(() => {
                commit(
                  removeStickers(
                    project,
                    project.items.flatMap((id, i) => (id === designMenu.id ? [i] : [])),
                  ),
                );
                setSelectedSticker(-1);
                setMessage(
                  'All copies removed from the sheets. The design stays in the library. Ctrl+Z restores them.',
                );
              })
            }
          >
            Delete all copies
          </button>
          <button
            role="menuitem"
            className="sheet-card-menu-delete"
            onClick={() => menuAction(() => removeSelectedDesign(designMenu.id))}
          >
            Delete design
          </button>
          <button
            role="menuitem"
            className="sheet-card-menu-delete"
            onClick={() =>
              menuAction(() => {
                commit({
                  ...removeStickers(
                    project,
                    project.items.map((_, i) => i),
                  ),
                  artwork: [],
                  capture: undefined,
                });
                setSelected('');
                setSelectedSticker(-1);
                setMessage('All designs and sheet copies deleted. Ctrl+Z restores them.');
              })
            }
          >
            Delete all designs
          </button>
          <small>
            Delete all designs clears the library and its sheet copies. Ctrl+Z restores deleted
            items.
          </small>
        </WorkspaceContextMenu>
      )}
      {renaming && (
        <dialog
          ref={renameDialog}
          className="modal"
          aria-labelledby="rename-sticker-title"
          onCancel={() => setRenaming(undefined)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!renaming.name.trim()) return;
              commit({
                ...project,
                artwork: project.artwork.map((a) =>
                  a.id === renaming.id ? { ...a, name: renaming.name.trim() } : a,
                ),
              });
              setRenaming(undefined);
              setMessage('Design renamed.');
            }}
          >
            <div className="modal-heading">
              <h2 id="rename-sticker-title">Rename design</h2>
            </div>
            <label>
              Design name
              <input
                autoFocus
                maxLength={200}
                value={renaming.name}
                onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
              />
            </label>
            <div className="modal-footer">
              <button type="button" className="secondary" onClick={() => setRenaming(undefined)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={!renaming.name.trim()}>
                Save name
              </button>
            </div>
          </form>
        </dialog>
      )}
    </section>
  );
}
