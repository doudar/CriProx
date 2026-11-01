import {
  WorkspaceGrid,
  WorkspacePanel,
  WorkspacePanelHeading,
  SheetNavigation,
  ZoomControl,
  MachineSelect,
  PaperOptions,
} from './components/WorkspaceChrome';
import { createPortal } from 'react-dom';
import { MachineGuideShapes, MachineGuideLegend } from './components/MachineGuides';
import { machineGuide, outsidePlanningGuide } from './lib/machine-guides';
import { polygonPath, shapePolygon } from './lib/generated-registration';
import {
  canMoveProjectToFolder,
  explorerProjects,
  PROJECT_DRAG_TYPE,
  projectFolder,
  type ProjectSort,
} from './lib/project-explorer';
import { templateFilenameStem } from './lib/filenames';
import { enableArtboardPanning } from './lib/artboard-pan';
import { enableProjectDragging, type ProjectDragCallbacks } from './lib/project-drag';
import RegisteredPrint from './components/RegisteredPrint';
import StickerStudio from './components/StickerStudio';
import StickerDesigner from './components/StickerDesigner';
import { useAiDesignBridge, useAiWorkspace } from './lib/use-ai-design';
import { type StickerDesign } from './lib/sticker-design';
import HomeScreen, { type HomeProject } from './components/HomeScreen';
import { WORKSPACES, type WorkspaceId } from './lib/workspaces';
import {
  listRecentProjects,
  readRecentProject,
  rememberRecentProject,
  projectSummary,
  type RecentProject,
} from './lib/recent-projects';
import { validateStickerProject, type StickerProject } from './lib/stickers';
import { useWorkspaceHistory } from './lib/use-workspace-history';
import { workspaceShortcut, isTextEditing } from './lib/workspace-history';
import PrintCutWorkflow from './components/PrintCutWorkflow';
import CutSettingsControls from './components/CutSettingsControls';
import FrontBleedControl from './components/FrontBleedControl';
import MpcArtworkSearch from './components/MpcArtworkSearch';
import ArtworkTrimControl from './components/ArtworkTrimControl';
import ManualGuideControls from './components/ManualGuideControls';
import SettingsModal from './components/SettingsModal';
import { INITIAL_UPDATE_STATE } from './components/UpdatesPanel';
import CardSearchResults from './components/CardSearchResults';
import SetBrowser from './components/SetBrowser';
import PreconBrowser from './components/PreconBrowser';
import TokenBrowser from './components/TokenBrowser';
import SheetCardMenu, { type SheetCardMenuTarget } from './components/SheetCardMenu';
import { useDialogBackdropDismiss } from './lib/dialog-backdrop';
import type { PreconEntry } from './lib/precons';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { get, set } from 'idb-keyval';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  FolderInput,
  GalleryHorizontalEnd,
  Grid2X2,
  GripVertical,
  ImagePlus,
  Layers3,
  Link2,
  LoaderCircle,
  Minus,
  Moon,
  Maximize2,
  Plus,
  RotateCcw,
  Ruler,
  Save,
  Scissors,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Card, Entry, PrintDpi, Project, Settings } from './lib/types';
import {
  DEFAULT_SETTINGS,
  fixedBleedMm,
  PRINT_DPI_OPTIONS,
  STANDARD_CARD_RADIUS_MM,
} from './lib/types';
import {
  FACTORY_PROJECT_DEFAULTS,
  projectFromDefaults,
  sheetSettingsMatch,
  validateProjectDefaults,
  withSheetSettingsDefaults,
  type ProjectDefaults,
} from './lib/project-defaults';
import { grid, type Sheet } from './lib/layout';
import { parseDeck } from './lib/deck';
import { importDeckSource } from './lib/deck-source';
import { resolveDeck, searchCards, variants } from './lib/scryfall';
import { exportBundle } from './lib/export';
import { saveProjectAs } from './lib/save-project';
import {
  openManagedProject as loadManagedProject,
  saveManagedProject,
} from './lib/managed-project';
import { validateProject } from './lib/project';
import sampleCards from './sample.json';
import { formatDimensions } from './lib/units';
import { mpcArtworkAsCard, mpcArtworkType } from './lib/mpc';
import { availableSheetProfiles, paperWorkflow } from './lib/paper-workflow';
import { manualCutLineBounds } from './lib/manual-cut';
import { manualGuideDashMm, manualGuidePathsByKind, manualGuideWidthMm } from './lib/cut-guides';
import {
  fixedSheets,
  fullTemplate,
  registrationKey,
  templateId,
  type RegistrationProfile,
} from './lib/registration';
import {
  captureProfile,
  registeredOutputFrame,
  REGISTERED_ART_MASK_PAD_MM,
} from './lib/registered-pdf';
import { sheetPreviewFrame } from './lib/sheet-preview';
import { registrationPreviewImage } from './lib/registration-preview-image';
import { looksLikeMpcPrintCanvas, usesMpcTrim, withMpcTrim } from './lib/artwork';
import {
  applyColorTheme,
  getInitialColorTheme,
  saveColorTheme,
  type ColorTheme,
} from './lib/theme';
import {
  addCardToEntries,
  copyEntryOnSheet,
  deleteEntryCopy,
  doubleSidedCardCount,
  editEntryCopy,
  isDoubleSidedCard,
  type EntryArtworkPatch,
  type EntryCopy,
} from './lib/entries';

// The original Design Space ZIP export remains available for a future workflow,
// but registered PDF creation is the only export action shown in the interface.
const ENABLE_DESIGN_SPACE_EXPORT = false;
const PROJECT_DEFAULTS_KEY = 'criprox-project-defaults';

const createSample = (): Project => ({
  version: 1,
  name: 'The essentials',
  settings: { ...DEFAULT_SETTINGS },
  entries: sampleCards.map((card) => ({ id: crypto.randomUUID(), card, quantity: 1, face: 0 })),
});
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';
async function cardFromArtwork(file: File, base?: Card): Promise<Card> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20000000)
    throw new Error(`${file.name}: choose a PNG, JPG, or WebP under 20 MB.`);
  const bitmap = await createImageBitmap(file);
  const trim = looksLikeMpcPrintCanvas(bitmap.width, bitmap.height) ? 'mpc' : undefined;
  bitmap.close();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
  const name = base?.name || file.name.replace(/\.[^.]+$/, '');
  return {
    id: crypto.randomUUID(),
    name,
    set: base ? 'custom' : 'local',
    setName: base ? 'Custom artwork' : 'Your artwork',
    collector: '',
    oracleId: base?.oracleId,
    demo: base?.demo,
    faces: [{ name, image: data, preview: data, trim }],
  };
}
function UnitToggle({
  value,
  change,
}: {
  value: Settings['units'];
  change: (units: Settings['units']) => void;
}) {
  return (
    <div className="segmented unit-toggle" aria-label="Display units">
      <button className={value === 'in' ? 'selected' : ''} onClick={() => change('in')}>
        Inches
      </button>
      <button className={value === 'mm' ? 'selected' : ''} onClick={() => change('mm')}>
        Millimeters
      </button>
    </div>
  );
}

function WindowControls() {
  const controls = window.criprox?.windowControls;
  const isMac = window.criprox?.platform === 'darwin';
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!controls) return;
    let active = true;
    controls
      .isMaximized()
      .then((value) => active && setMaximized(value))
      .catch(() => {});
    const unsubscribe = controls.onMaximizedChange(setMaximized);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [controls]);
  if (!controls) return null;
  const closeButton = (
    <button
      className="window-control window-close"
      aria-label="Close window"
      title="Close"
      onClick={() => void controls.close()}
    >
      <X size={17} />
    </button>
  );
  const minimizeButton = (
    <button
      className="window-control window-minimize"
      aria-label="Minimize window"
      title="Minimize"
      onClick={() => void controls.minimize()}
    >
      <Minus size={16} />
    </button>
  );
  const maximizeButton = (
    <button
      className="window-control window-maximize"
      aria-label={maximized ? 'Restore window' : 'Maximize window'}
      title={maximized ? 'Restore' : 'Maximize'}
      onClick={() => void controls.toggleMaximize()}
    >
      {maximized ? <Copy className="restore-icon" size={13} /> : <Maximize2 size={14} />}
    </button>
  );
  return (
    <div className={`window-controls ${isMac ? 'mac' : 'desktop'}`} aria-label="Window controls">
      {isMac ? (
        <>
          {closeButton}
          {minimizeButton}
          {maximizeButton}
        </>
      ) : (
        <>
          {minimizeButton}
          {maximizeButton}
          {closeButton}
        </>
      )}
    </div>
  );
}
function Modal({
  title,
  subtitle,
  children,
  close,
  wide = false,
  className = '',
  initialFocus,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
  className?: string;
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropDismiss = useDialogBackdropDismiss(close);
  useEffect(() => {
    ref.current?.showModal();
    initialFocus?.current?.focus();
  }, [initialFocus]);
  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`}
      onCancel={close}
      {...backdropDismiss}
      aria-labelledby="dialog-title"
    >
      <div className="modal-heading">
        <div>
          <h2 id="dialog-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ProjectsModal({
  snapshot,
  activeProjectId,
  busy,
  close,
  refresh,
  reveal,
  open,
  remove,
  saveCurrent,
  importBackup,
  exportBackup,
  newProject,
  createFolder,
  deleteFolder,
  move,
}: {
  snapshot: ProjectLibrarySnapshot | null;
  activeProjectId: string | null;
  busy: boolean;
  close: () => void;
  refresh: () => void;
  reveal: () => void;
  open: (projectId: string) => void;
  remove: (project: ProjectSummary) => void;
  saveCurrent: (folder: string) => void;
  importBackup: () => void;
  exportBackup: () => void;
  newProject: () => void;
  createFolder: (parent: string, name: string) => Promise<string>;
  deleteFolder: (folder: string) => Promise<void>;
  move: (projectId: string, folder: string) => Promise<void>;
}) {
  const [deleteCandidate, setDeleteCandidate] = useState<ProjectSummary | null>(null);
  const [folder, setFolder] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ProjectSort>('updated');
  const [allProjects, setAllProjects] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [moveCandidate, setMoveCandidate] = useState<ProjectSummary | null>(null);
  const [destination, setDestination] = useState('');
  const [creatingMoveFolder, setCreatingMoveFolder] = useState(false);
  const [moveFolderName, setMoveFolderName] = useState('');
  const [error, setError] = useState('');
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const dragProjectId = useRef<string | null>(null);
  const dropPending = useRef(false);
  const moveDestination = useRef<HTMLSelectElement | null>(null);
  const librarySearch = useRef<HTMLInputElement | null>(null);
  const projectContent = useRef<HTMLDivElement | null>(null);
  const projectBrowser = useRef<HTMLDivElement | null>(null);
  const pointerDragCallbacks = useRef<ProjectDragCallbacks | null>(null);
  const folders = useMemo(() => snapshot?.folders ?? [], [snapshot]);
  const currentFolder = folders.find((item) => item.id === folder);
  const folderProjectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of snapshot?.projects ?? []) {
      const parts = projectFolder(item.id).split('/').filter(Boolean);
      for (let depth = 1; depth <= parts.length; depth++) {
        const path = parts.slice(0, depth).join('/');
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }
    }
    return counts;
  }, [snapshot]);
  const searching = Boolean(query.trim());
  const visibleProjects = useMemo(
    () => explorerProjects(snapshot?.projects ?? [], folder, query, allProjects, sort),
    [snapshot, folder, query, allProjects, sort],
  );
  const visibleFolders = folders.filter((item) =>
    searching
      ? query
          .trim()
          .toLocaleLowerCase()
          .split(/\s+/)
          .every((word) => item.id.toLocaleLowerCase().includes(word))
      : item.parent === folder,
  );
  const clearDrag = () => {
    dragProjectId.current = null;
    setDraggedProjectId(null);
    setDropFolder(null);
  };
  const canDrop = (target: string) =>
    !busy &&
    !dropPending.current &&
    canMoveProjectToFolder(snapshot, dragProjectId.current, target);
  const dropClass = (target: string) =>
    draggedProjectId && canDrop(target)
      ? ` explorer-drop-ready${dropFolder === target ? ' explorer-drop-over' : ''}`
      : '';
  const moveDroppedProject = async (projectId: string, target: string) => {
    if (busy || dropPending.current || !canMoveProjectToFolder(snapshot, projectId, target)) return;
    dropPending.current = true;
    setError('');
    setMoveCandidate(null);
    setDeleteCandidate(null);
    try {
      await move(projectId, target);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      dropPending.current = false;
    }
  };
  const dropHandlers = (target: string) => ({
    'data-project-folder': target,
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragProjectId.current || !event.dataTransfer.types.includes(PROJECT_DRAG_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      const allowed = canDrop(target);
      event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
      setDropFolder(allowed ? target : null);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
        return;
      setDropFolder((current) => (current === target ? null : current));
    },
    onDrop: async (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const projectId = dragProjectId.current;
      const allowed =
        canDrop(target) && event.dataTransfer.getData(PROJECT_DRAG_TYPE) === projectId;
      clearDrag();
      if (!allowed || !projectId) return;
      await moveDroppedProject(projectId, target);
    },
  });
  pointerDragCallbacks.current = {
    canDrag: (id) =>
      !busy && !dropPending.current && Boolean(snapshot?.projects.some((item) => item.id === id)),
    canDrop: (id, target) =>
      !busy && !dropPending.current && canMoveProjectToFolder(snapshot, id, target),
    start: (id) => {
      dragProjectId.current = id;
      setDraggedProjectId(id);
      setDropFolder(null);
      setError('');
    },
    hover: setDropFolder,
    finish: clearDrag,
    drop: (id, target) => void moveDroppedProject(id, target),
  };
  useEffect(() => {
    if (!projectContent.current || !projectBrowser.current) return;
    return enableProjectDragging(projectContent.current, projectBrowser.current, {
      canDrag: (id) => pointerDragCallbacks.current!.canDrag(id),
      canDrop: (id, target) => pointerDragCallbacks.current!.canDrop(id, target),
      start: (id) => pointerDragCallbacks.current!.start(id),
      hover: (target) => pointerDragCallbacks.current!.hover(target),
      finish: () => pointerDragCallbacks.current!.finish(),
      drop: (id, target) => pointerDragCallbacks.current!.drop(id, target),
    });
  }, []);
  const draggedProject = snapshot?.projects.find((item) => item.id === draggedProjectId);
  const navigate = (next: string) => {
    setFolder(next);
    setQuery('');
    setAllProjects(false);
    setDeleteCandidate(null);
    setMoveCandidate(null);
    setCreatingFolder(false);
    setError('');
  };
  useEffect(() => {
    if (!snapshot) return;
    setFolder((current) => {
      let next = current;
      while (next && !snapshot.folders?.some((item) => item.id === next))
        next = projectFolder(next);
      return next;
    });
  }, [snapshot]);
  const fileExplorerName =
    window.criprox?.platform === 'darwin'
      ? 'Finder'
      : window.criprox?.platform === 'win32'
        ? 'File Explorer'
        : 'file manager';
  const formatUpdated = (value: string) =>
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    );
  return (
    <Modal
      title="Projects"
      subtitle="Organize your decks into folders and find any saved project."
      close={close}
      wide
      className="projects-modal"
    >
      <div className="projects-content" ref={projectContent}>
        <div className="library-location">
          <span className="library-location-icon">
            <FolderOpen size={18} />
          </span>
          <div>
            <strong>{snapshot?.isDefault ? 'CriProx projects' : 'Custom projects folder'}</strong>
            <span title={snapshot?.root}>{snapshot?.root || 'Finding your projects folder…'}</span>
          </div>
          <button
            className="secondary compact library-location-open"
            disabled={busy || !snapshot}
            onClick={() => reveal()}
          >
            <ExternalLink size={14} /> Open in {fileExplorerName}
          </button>
        </div>
        <div className="explorer-toolbar">
          <div className="explorer-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              ref={librarySearch}
              aria-label="Search projects and folders"
              placeholder="Search the entire library…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                className="icon-button"
                aria-label="Clear library search"
                onClick={() => {
                  setQuery('');
                  librarySearch.current?.focus();
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <select
            aria-label="Sort projects"
            value={sort}
            onChange={(event) => setSort(event.target.value as ProjectSort)}
          >
            <option value="updated">Recently saved</option>
            <option value="name">Name A–Z</option>
            <option value="cards">Most cards</option>
          </select>
          <button
            className="secondary compact"
            disabled={busy || !snapshot || folder.split('/').filter(Boolean).length >= 8}
            onClick={() => {
              setCreatingFolder(!creatingFolder);
              setFolderName('');
              setError('');
            }}
          >
            <FolderPlus size={14} /> New folder
          </button>
        </div>
        <nav className="explorer-breadcrumbs" aria-label="Library folders">
          <button
            className={dropClass('')}
            {...dropHandlers('')}
            aria-current={folder === '' ? 'page' : undefined}
            onClick={() => navigate('')}
            disabled={busy}
          >
            Library
          </button>
          {folder
            .split('/')
            .filter(Boolean)
            .map((part, index, parts) => (
              <span key={index}>
                <ChevronRight size={12} />
                <button
                  className={dropClass(parts.slice(0, index + 1).join('/'))}
                  {...dropHandlers(parts.slice(0, index + 1).join('/'))}
                  disabled={busy}
                  aria-current={index === parts.length - 1 ? 'page' : undefined}
                  onClick={() => navigate(parts.slice(0, index + 1).join('/'))}
                >
                  {part}
                </button>
              </span>
            ))}
        </nav>
        <p className="explorer-drag-hint" role="status">
          {draggedProject
            ? dropFolder !== null
              ? `Move “${draggedProject.name}” to ${dropFolder || 'Library'}`
              : `Drop “${draggedProject.name}” onto a highlighted folder, or hold near the list’s edges to scroll.`
            : 'Drag projects onto a folder or breadcrumb to move them. Hold near the list’s edges to scroll.'}
        </p>
        {creatingFolder && (
          <form
            className="explorer-inline-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setError('');
              try {
                const next = await createFolder(folder, folderName.trim());
                navigate(next);
              } catch (failure) {
                setError(errorText(failure));
              }
            }}
          >
            <label htmlFor="library-folder-name">New folder in {folder || 'Library'}</label>
            <div>
              <input
                id="library-folder-name"
                autoFocus
                maxLength={80}
                required
                value={folderName}
                placeholder="e.g. Commander decks"
                disabled={busy}
                onChange={(event) => setFolderName(event.target.value)}
              />
              <button className="primary compact" disabled={busy || !folderName.trim()}>
                Create folder
              </button>
              <button
                type="button"
                className="secondary compact"
                disabled={busy}
                onClick={() => {
                  setCreatingFolder(false);
                  setError('');
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {error && (
          <p className="explorer-error" role="alert">
            {error}
          </p>
        )}
        <div className="projects-section-heading">
          <div>
            <h3>
              {searching ? 'Search results' : allProjects ? 'All projects' : 'Saved projects'}
            </h3>
            <span role="status">
              {snapshot
                ? `${visibleProjects.length} of ${snapshot.projects.length} projects`
                : 'Loading…'}
            </span>
          </div>
          <div className="explorer-heading-actions">
            {!searching && (
              <label className="explorer-all">
                <input
                  type="checkbox"
                  checked={allProjects}
                  onChange={(event) => setAllProjects(event.target.checked)}
                />{' '}
                All projects
              </label>
            )}
            {activeProjectId && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => navigate(projectFolder(activeProjectId))}
              >
                Show current
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Refresh projects"
              title="Refresh projects"
              disabled={busy}
              onClick={refresh}
            >
              <RotateCcw className={busy ? 'spin' : ''} size={15} />
            </button>
          </div>
        </div>
        <div className="project-browser" aria-busy={busy} ref={projectBrowser}>
          {visibleFolders.map((item) => {
            const count = folderProjectCounts.get(item.id) ?? 0;
            return (
              <div className="project-browser-entry" key={`folder-${item.id}`}>
                <div className="explorer-folder-row">
                  <button
                    className={`project-browser-item explorer-folder${dropClass(item.id)}`}
                    {...dropHandlers(item.id)}
                    disabled={busy}
                    onClick={() => navigate(item.id)}
                  >
                    <span className="project-browser-icon">
                      <FolderOpen size={20} />
                    </span>
                    <span className="project-browser-copy">
                      <strong>{item.name}</strong>
                      <span>
                        {searching ? `${item.parent || 'Library'} · ` : ''}
                        {count
                          ? `${count} project${count === 1 ? '' : 's'}`
                          : item.empty
                            ? 'Empty folder'
                            : 'Contains items'}
                      </span>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                  {item.empty === true && (
                    <button
                      className="icon-button project-delete-button explorer-folder-delete"
                      aria-label={`Delete empty folder ${item.name}`}
                      title="Delete empty folder"
                      disabled={busy}
                      onClick={async () => {
                        setError('');
                        try {
                          await deleteFolder(item.id);
                          if (destination === item.id) {
                            setDestination(item.parent);
                            setCreatingMoveFolder(false);
                          }
                        } catch (failure) {
                          setError(errorText(failure));
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {visibleProjects.map((item) => {
            const current = item.id === activeProjectId;
            return (
              <div className="project-browser-entry" key={item.id}>
                <article
                  className={`project-browser-item ${current ? 'current' : ''}${draggedProjectId === item.id ? ' explorer-dragging' : ''}`}
                  aria-label={item.name}
                  data-project-id={item.id}
                  draggable={!busy && !dropPending.current}
                  onDragStart={(event) => {
                    if (
                      busy ||
                      dropPending.current ||
                      (event.target instanceof Element &&
                        event.target.closest('button, input, select, a'))
                    ) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.setData(PROJECT_DRAG_TYPE, item.id);
                    event.dataTransfer.effectAllowed = 'move';
                    dragProjectId.current = item.id;
                    setDraggedProjectId(item.id);
                    setDropFolder(null);
                    setError('');
                  }}
                  onDragEnd={clearDrag}
                >
                  <span
                    className="explorer-drag-handle"
                    aria-hidden="true"
                    title="Drag to move this project"
                  >
                    <GripVertical size={14} />
                  </span>
                  <span className="project-browser-icon">
                    <GalleryHorizontalEnd size={20} aria-hidden="true" />
                  </span>
                  <div className="project-browser-copy">
                    <strong title={item.name}>{item.name}</strong>
                    {(searching || allProjects) && (
                      <button
                        className="text-button explorer-project-location"
                        disabled={busy}
                        onClick={() => navigate(projectFolder(item.id))}
                      >
                        {projectFolder(item.id) || 'Library'}
                      </button>
                    )}
                    <span>
                      {item.cardCount} card{item.cardCount === 1 ? '' : 's'}
                      <i />
                      <Clock3 size={11} /> {formatUpdated(item.updatedAt)}
                    </span>
                  </div>
                  {current && <span className="current-project-badge">CURRENT</span>}
                  <div className="project-browser-actions">
                    <button
                      className="secondary compact"
                      disabled={busy || current}
                      onClick={() => open(item.id)}
                    >
                      {current ? 'Open' : 'Open project'}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Move ${item.name} to folder`}
                      title="Move to folder"
                      disabled={busy}
                      onClick={() => {
                        setMoveCandidate(item);
                        setDestination(projectFolder(item.id));
                        setCreatingMoveFolder(false);
                        setMoveFolderName('');
                        setDeleteCandidate(null);
                        setError('');
                      }}
                    >
                      <FolderInput size={15} />
                    </button>
                    <button
                      className="icon-button project-delete-button"
                      aria-label={`Delete ${item.name}`}
                      title="Move project to Trash"
                      disabled={busy}
                      onClick={() => {
                        setDeleteCandidate(item);
                        setMoveCandidate(null);
                        setError('');
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
                {moveCandidate?.id === item.id && (
                  <form
                    className="explorer-inline-form explorer-move"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      setError('');
                      try {
                        let target = destination;
                        if (creatingMoveFolder) {
                          target = await createFolder(destination, moveFolderName.trim());
                          // Keep the created folder selected if moving fails, so retrying
                          // never attempts to create the same folder again.
                          setDestination(target);
                          setCreatingMoveFolder(false);
                          setMoveFolderName('');
                        }
                        await move(item.id, target);
                        setMoveCandidate(null);
                      } catch (failure) {
                        setError(errorText(failure));
                      }
                    }}
                  >
                    <label htmlFor="project-move-destination">Move “{item.name}” to</label>
                    <div>
                      <select
                        id="project-move-destination"
                        ref={moveDestination}
                        autoFocus
                        value={destination}
                        disabled={busy}
                        onChange={(event) => {
                          const next = event.target.value;
                          setError('');
                          if (next === '/new-folder/') {
                            setCreatingMoveFolder(true);
                            setMoveFolderName('');
                          } else {
                            setDestination(next);
                            if (next.split('/').filter(Boolean).length >= 8)
                              setCreatingMoveFolder(false);
                          }
                        }}
                      >
                        <option value="">Library</option>
                        {folders.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.id}
                          </option>
                        ))}
                        <option
                          value="/new-folder/"
                          disabled={destination.split('/').filter(Boolean).length >= 8}
                        >
                          ＋ New folder…
                        </option>
                      </select>
                      <button
                        className="primary compact"
                        disabled={
                          busy ||
                          (creatingMoveFolder
                            ? !moveFolderName.trim()
                            : destination === projectFolder(item.id))
                        }
                      >
                        {creatingMoveFolder ? 'Create & move' : 'Move project'}
                      </button>
                      <button
                        className="secondary compact"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setMoveCandidate(null);
                          setError('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    {creatingMoveFolder && (
                      <div className="explorer-new-destination">
                        <label htmlFor="project-move-folder-name">
                          New folder in {destination || 'Library'}
                        </label>
                        <div>
                          <FolderPlus size={16} aria-hidden="true" />
                          <input
                            id="project-move-folder-name"
                            autoFocus
                            required
                            maxLength={80}
                            placeholder="Folder name"
                            value={moveFolderName}
                            disabled={busy}
                            onChange={(event) => setMoveFolderName(event.target.value)}
                          />
                          <button
                            className="icon-button"
                            type="button"
                            aria-label="Cancel new folder"
                            title="Cancel new folder"
                            disabled={busy}
                            onClick={() => {
                              setCreatingMoveFolder(false);
                              setError('');
                              moveDestination.current?.focus();
                            }}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    )}
                  </form>
                )}
                {deleteCandidate?.id === item.id && (
                  <div className="project-delete-confirm" role="alert">
                    <span>
                      Move <strong>{item.name}</strong> and its saved artwork to Trash?
                    </span>
                    <div>
                      <button
                        className="secondary compact"
                        disabled={busy}
                        onClick={() => setDeleteCandidate(null)}
                      >
                        Cancel
                      </button>
                      <button
                        className="danger-button compact"
                        disabled={busy}
                        onClick={() => {
                          remove(item);
                          setDeleteCandidate(null);
                        }}
                      >
                        <Trash2 size={14} /> Move to Trash
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {snapshot && !visibleProjects.length && !visibleFolders.length && (
            <div className="empty-project-browser">
              <FolderOpen size={30} strokeWidth={1.3} />
              <strong>
                {searching ? 'No matching projects or folders' : 'No saved projects here yet'}
              </strong>
              <span>
                {searching
                  ? 'Try another project name or folder name.'
                  : 'Save a new project here, create a subfolder, or move a project from the library.'}
              </span>
              {(searching || folder || allProjects) && (
                <div className="empty-project-browser-actions">
                  <button
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => navigate('')}
                  >
                    Back to library
                  </button>
                  {!searching && !allProjects && currentFolder?.empty === true && (
                    <button
                      className="secondary compact project-delete-button"
                      disabled={busy}
                      onClick={async () => {
                        setError('');
                        try {
                          await deleteFolder(currentFolder.id);
                          navigate(currentFolder.parent);
                        } catch (failure) {
                          setError(errorText(failure));
                        }
                      }}
                    >
                      <Trash2 size={14} /> Delete folder
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {!snapshot && (
            <div className="empty-project-browser">
              <LoaderCircle className="spin" size={26} />
              <span>Finding saved projects…</span>
            </div>
          )}
        </div>
      </div>
      <div className="modal-footer projects-footer">
        <div>
          <button className="secondary compact" disabled={busy} onClick={importBackup}>
            <Upload size={14} /> Import JSON backup
          </button>
          <button className="secondary compact" disabled={busy} onClick={exportBackup}>
            <Download size={14} /> Export JSON backup
          </button>
          <button className="secondary compact" disabled={busy} onClick={newProject}>
            <FilePlus2 size={14} /> New project
          </button>
        </div>
        <button className="primary compact" disabled={busy} onClick={() => saveCurrent(folder)}>
          {busy ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
          {activeProjectId
            ? 'Save current project'
            : folder
              ? 'Save new project here'
              : 'Save current project'}
        </button>
      </div>
    </Modal>
  );
}
function ImportModal({
  add,
  remaining,
  close,
}: {
  add: (entries: Entry[]) => void;
  remaining: number;
  close: () => void;
}) {
  const [mode, setMode] = useState<'link' | 'list'>('link'),
    [link, setLink] = useState(''),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const parsed = parseDeck(text);
  const deckText = (cards: typeof parsed.cards) =>
    cards
      .map(
        (card) =>
          `${card.quantity} ${card.name}${card.set ? ` (${card.set.toUpperCase()})${card.collector ? ` ${card.collector}` : ''}` : ''}`,
      )
      .join('\n');

  async function resolveCards(cards: typeof parsed.cards, retryText: string) {
    if (cards.reduce((n, card) => n + card.quantity, 0) > remaining) {
      setError(`There is room for ${remaining} more cards in this project.`);
      return;
    }
    setBusy('Finding your cards…');
    const result = await resolveDeck(cards, setBusy);
    if (result.found.length)
      add(
        result.found.map(({ card, line }) => ({
          id: crypto.randomUUID(),
          card,
          quantity: line.quantity,
          face: 0,
        })),
      );
    if (result.missing.length) {
      const foundLines = new Set(result.found.map((found) => found.line.line));
      setMode('list');
      setText(
        retryText
          .split(/\r?\n/)
          .filter((_, index) => !foundLines.has(index + 1))
          .join('\n'),
      );
      setError(
        `${result.found.length} entries added. Could not find:\n${result.missing.join('\n')}\nCheck spelling or the set and collector number, then retry.`,
      );
    } else {
      close();
    }
  }

  async function importCards() {
    setError('');
    if (parsed.errors.length) {
      setError(parsed.errors.join('\n'));
      return;
    }
    if (!parsed.cards.length) {
      setError('Paste at least one card name.');
      return;
    }
    try {
      await resolveCards(parsed.cards, text);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy('');
    }
  }

  async function importLink() {
    setError('');
    setBusy('Loading deck…');
    try {
      const deck = await importDeckSource(link);
      await resolveCards(deck.cards, deckText(deck.cards));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy('');
    }
  }
  return (
    <Modal
      title="Import a deck"
      subtitle="Use a Moxfield or Archidekt link, or paste a card list."
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="import-content">
        <div className="segmented import-source-toggle" aria-label="Deck import source">
          <button
            className={mode === 'link' ? 'selected' : ''}
            aria-pressed={mode === 'link'}
            disabled={!!busy}
            onClick={() => {
              setMode('link');
              setError('');
            }}
          >
            <Link2 size={14} /> Deck link
          </button>
          <button
            className={mode === 'list' ? 'selected' : ''}
            aria-pressed={mode === 'list'}
            disabled={!!busy}
            onClick={() => {
              setMode('list');
              setError('');
            }}
          >
            <Upload size={14} /> Card list
          </button>
        </div>
        {mode === 'link' ? (
          <>
            <div className="field-heading">
              <label htmlFor="deck-link">Public or unlisted deck link</label>
            </div>
            <div className="deck-link-field">
              <Link2 size={16} />
              <input
                id="deck-link"
                autoFocus
                type="url"
                value={link}
                disabled={!!busy}
                onChange={(event) => setLink(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && link.trim() && !busy) void importLink();
                }}
                placeholder="https://moxfield.com/decks/…"
              />
            </div>
            <div className="import-hint">
              <span>Moxfield and Archidekt links are supported</span>
              <span>Maybeboards excluded</span>
            </div>
          </>
        ) : (
          <>
            <div className="field-heading">
              <label htmlFor="decklist">Card list</label>
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() =>
                  setText('1 Sol Ring\n1 Command Tower\n2 Arcane Signet\n1 Swords to Plowshares')
                }
              >
                Try an example
              </button>
            </div>
            <textarea
              id="decklist"
              autoFocus
              rows={10}
              value={text}
              disabled={!!busy}
              onChange={(event) => setText(event.target.value)}
              placeholder={'1 Sol Ring\n4 Lightning Bolt\n1 Counterspell (MH2) 267'}
            />
            <div className="import-hint">
              <span>Quantity + card name · optional (SET) number</span>
              <span>{parsed.cards.reduce((n, card) => n + card.quantity, 0)} cards</span>
            </div>
          </>
        )}
        <div className="soft-info">
          <Sparkles size={17} />
          <span>
            Card data comes from Scryfall. Linked decks keep their selected printings when
            available, and you can choose a different printing after import.
          </span>
        </div>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <span className="muted">Up to 500 cards per project</span>
        <button
          className="primary"
          disabled={!!busy || !(mode === 'link' ? link : text).trim()}
          onClick={mode === 'link' ? importLink : importCards}
        >
          {busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}{' '}
          {busy || (mode === 'link' ? 'Import deck' : 'Add to project')}
        </button>
      </div>
    </Modal>
  );
}
function CardSearchModal({
  add,
  addEntries,
  remaining,
  close,
}: {
  add: (card: Card) => void;
  addEntries: (entries: Entry[]) => void;
  remaining: number;
  close: () => void;
}) {
  const [mode, setMode] = useState<'search' | 'sets' | 'precons' | 'tokens'>('search');
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(''),
    [cards, setCards] = useState<Card[]>([]),
    [next, setNext] = useState<string>(),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [searched, setSearched] = useState(''),
    [added, setAdded] = useState<Record<string, number>>({});

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (!term) {
      setError('Enter a card name to search.');
      return;
    }
    setBusy('Searching cards…');
    setError('');
    try {
      const result = await searchCards(term);
      setCards(result.cards);
      setNext(result.next);
      setSearched(term);
    } catch (reason) {
      setCards([]);
      setNext(undefined);
      setSearched(term);
      setError(errorText(reason));
    } finally {
      setBusy('');
    }
  }

  async function loadMore() {
    if (!next) return;
    setBusy('Loading more cards…');
    setError('');
    try {
      const result = await searchCards(searched, next);
      setCards((current) => [
        ...current,
        ...result.cards.filter((card) => !current.some((candidate) => candidate.id === card.id)),
      ]);
      setNext(result.next);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy('');
    }
  }

  function addCard(card: Card) {
    if (remaining <= 0) return;
    add(card);
    const key = card.id;
    setAdded((current) => ({ ...current, [key]: (current[key] || 0) + 1 }));
  }

  function addPrecon(entries: PreconEntry[]) {
    if (entries.reduce((sum, entry) => sum + entry.quantity, 0) > remaining) return;
    addEntries(
      entries.map(({ card, quantity }) => ({ id: crypto.randomUUID(), card, quantity, face: 0 })),
    );
    setAdded((current) => {
      const updated = { ...current };
      for (const entry of entries)
        updated[entry.card.id] = (updated[entry.card.id] || 0) + entry.quantity;
      return updated;
    });
  }

  return (
    <Modal
      wide
      className="card-search-modal"
      initialFocus={searchInput}
      title="Find a card"
      subtitle="Search cards, browse sets or tokens, or explore commander precon decks."
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="card-search-content">
        <div className="card-catalog-toggle" role="group" aria-label="Find cards by">
          <button
            className={mode === 'search' ? 'primary compact' : 'secondary compact'}
            aria-pressed={mode === 'search'}
            disabled={!!busy}
            onClick={() => setMode('search')}
          >
            <Search size={15} /> Search cards
          </button>
          <button
            className={mode === 'sets' ? 'primary compact' : 'secondary compact'}
            aria-pressed={mode === 'sets'}
            disabled={!!busy}
            onClick={() => setMode('sets')}
          >
            <Layers3 size={15} /> Browse sets
          </button>
          <button
            className={mode === 'precons' ? 'primary compact' : 'secondary compact'}
            aria-pressed={mode === 'precons'}
            disabled={!!busy}
            onClick={() => setMode('precons')}
          >
            <Layers3 size={15} /> Commander precons
          </button>
          <button
            className={mode === 'tokens' ? 'primary compact' : 'secondary compact'}
            aria-pressed={mode === 'tokens'}
            disabled={!!busy}
            onClick={() => setMode('tokens')}
          >
            <Grid2X2 size={15} /> Tokens
          </button>
        </div>
        {Object.values(added).reduce((sum, count) => sum + count, 0) > 0 && (
          <div className="card-search-summary" aria-live="polite">
            <span>
              {Object.values(added).reduce((sum, count) => sum + count, 0)} added this session
            </span>
          </div>
        )}
        {mode === 'sets' ? (
          <SetBrowser add={addCard} added={added} remaining={remaining} />
        ) : mode === 'precons' ? (
          <PreconBrowser add={addCard} addDeck={addPrecon} added={added} remaining={remaining} />
        ) : mode === 'tokens' ? (
          <TokenBrowser add={addCard} added={added} remaining={remaining} />
        ) : (
          <>
            <form className="card-search-form" onSubmit={search}>
              <div className="search-field">
                <Search size={17} />
                <input
                  ref={searchInput}
                  autoFocus
                  aria-label="Search Scryfall cards and tokens"
                  placeholder="Search by card or token name…"
                  value={query}
                  disabled={!!busy}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <button className="primary" disabled={!!busy || !query.trim()} type="submit">
                {busy && !cards.length ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Search size={16} />
                )}
                Search
              </button>
            </form>
            <div className="card-search-summary" aria-live="polite">
              {searched && !error && (
                <span>
                  {cards.length} {cards.length === 1 ? 'result' : 'results'} for “{searched}”
                </span>
              )}
            </div>
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
            {!searched && !busy && (
              <div className="card-search-empty">
                <Search size={31} strokeWidth={1.3} />
                <strong>Search the card catalog</strong>
                <span>Try “Sol Ring”, “Goblin”, or “Goblin token” to see only tokens.</span>
              </div>
            )}
            {!!cards.length && (
              <CardSearchResults cards={cards} added={added} remaining={remaining} add={addCard} />
            )}
            {busy && (
              <div className="loading">
                <LoaderCircle className="spin" size={18} /> {busy}
              </div>
            )}
            {next && !busy && (
              <button className="secondary load-more" onClick={() => void loadMore()}>
                Load more results
              </button>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <span className="muted">
          {remaining > 0
            ? `Room for ${remaining} more card${remaining === 1 ? '' : 's'}`
            : 'This project has reached the 500-card limit'}
        </span>
        <button className="secondary" disabled={!!busy} onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  );
}
function GuideVideo({ src, poster, label }: { src: string; poster: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !reducedMotion.matches) {
          void video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { threshold: 0.65 },
    );
    const handleMotionPreference = () => {
      if (reducedMotion.matches) video.pause();
    };
    observer.observe(video);
    reducedMotion.addEventListener('change', handleMotionPreference);
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener('change', handleMotionPreference);
    };
  }, []);
  return (
    <div className="guide-video-shell">
      <video
        ref={ref}
        aria-label={label}
        controls
        loop
        muted
        playsInline
        poster={poster}
        preload="metadata"
      >
        <source src={src} type="video/mp4" />
      </video>
    </div>
  );
}
function Guide({ close }: { close: () => void }) {
  const steps = [
    {
      title: 'Download the reusable template',
      description:
        'Open Create print PDF, choose your machine and paper, then download the one-time setup image. Keep the exact dimensions shown with that template.',
      video: {
        src: './tutorials/download-template.mp4',
        poster: './tutorials/download-template.jpg',
        label: 'Walkthrough: download the reusable template from CriProx',
      },
    },
    {
      title: 'Set it up in Design Space',
      description:
        'Upload the setup image as a flat Print Then Cut image, preserve its transparency, and set both dimensions to the exact values supplied by CriProx.',
      video: {
        src: './tutorials/design-space-setup.mp4',
        poster: './tutorials/design-space-setup.jpg',
        label: 'Walkthrough: upload and size the template in Design Space',
      },
    },
    {
      title: 'Capture Cricut’s print',
      description:
        'Make the project and save Cricut’s print as a one-page portrait PDF at actual size. Import that PDF into CriProx so the app can verify and save its registration marks.',
      video: {
        src: './tutorials/capture-registration.mp4',
        poster: './tutorials/capture-registration.jpg',
        label: 'Walkthrough: print the setup from Design Space and capture it in CriProx',
      },
    },
    {
      title: 'Save, print, and run the saved cut',
      description:
        'Save the card-sheet PDF from CriProx, open it in a dedicated PDF application, and print at 100% / Actual size with no fit or shrink scaling. CriProx does not print directly so it can preserve the selected output quality. Return to the same saved Design Space project, choose Already Printed or skip printing when available, and cut the sheet.',
    },
  ];
  return (
    <Modal
      title="Registered PDF printing"
      subtitle="Capture Cricut’s registration once, then reuse it."
      close={close}
      wide
    >
      <div className="guide-content">
        <div className="guide-banner">
          <Scissors size={28} />
          <div>
            <strong>Your artwork, inside Cricut’s captured marks.</strong>
            <p>
              CriProx places your cards into a verified template captured from Design Space and
              saves a full-quality PDF. The saved Cricut project supplies the matching cut paths.
            </p>
          </div>
        </div>
        {steps.map(({ title, description, video }, i) => (
          <div className="guide-step" key={title}>
            <span>{i + 1}</span>
            <div className="guide-step-body">
              <h3>{title}</h3>
              <p>{description}</p>
              {video && <GuideVideo {...video} />}
            </div>
          </div>
        ))}
        <div className="soft-info">
          <CircleHelp size={20} />
          <span>
            Keep the Design Space project, machine, paper, dimensions, and mat position unchanged.
            Recapture the template after any setting change that affects the marks or cut layout.
          </span>
        </div>
        <p className="guide-limit">
          Run a size-check page after capturing a template. Printer scaling, materials, machine
          calibration, and manual back-side feeding can affect alignment.
        </p>
        <a
          className="external-link"
          href="https://help.cricut.com/hc/en-us/articles/360009387274-How-to-Print-Then-Cut-in-Design-Space"
          target="_blank"
          rel="noreferrer"
        >
          Official Cricut Print Then Cut instructions <ExternalLink size={14} />
        </a>
      </div>
      <div className="modal-footer">
        <span className="muted">One measured test saves a stack of paper.</span>
        <button className="primary" onClick={close}>
          Back to studio <ArrowRight size={16} />
        </button>
      </div>
    </Modal>
  );
}
function ExportModal({
  project,
  sheets,
  current,
  close,
  notify,
}: {
  project: Project;
  sheets: Sheet[];
  current: number;
  close: () => void;
  notify: (text: string) => void;
}) {
  const [scope, setScope] = useState<'all' | 'current'>('all'),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const selected = scope === 'all' ? sheets : [sheets[current]];
  async function run(calibration = false) {
    setBusy('Preparing export…');
    setError('');
    try {
      const first = project.entries[0];
      const calibrationSheets: Sheet[] = [
        {
          index: 0,
          width: project.settings.width,
          height: project.settings.height,
          placements: [
            {
              entry: first,
              copy: 0,
              x: 0,
              y: 0,
              width: project.settings.width,
              height: project.settings.height,
              rotated: false,
            },
          ],
        },
      ];
      await exportBundle(project, calibration ? calibrationSheets : selected, setBusy, calibration);
      notify(
        calibration
          ? 'Size-check package downloaded.'
          : 'Export package downloaded. Start with START-HERE.txt.',
      );
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }
  return (
    <Modal
      title="Ready for Design Space"
      subtitle="Artwork and cutting geometry, together in one package."
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="export-content">
        <div className="package-visual">
          <div className="file-icon">
            <ImagePlus size={28} />
            <span>PNG</span>
          </div>
          <Plus size={20} />
          <div className="file-icon svg">
            <Scissors size={28} />
            <span>SVG</span>
          </div>
          <div>
            <strong>A little precision, packed.</strong>
            <p>
              {project.settings.dpi} DPI artwork · vector cut reference
              <br />
              Exact dimensions · step-by-step guide
            </p>
          </div>
        </div>
        <label className="field-label" htmlFor="scope">
          Sheets to export
        </label>
        <select
          id="scope"
          value={scope}
          disabled={!!busy}
          onChange={(e) => setScope(e.target.value as typeof scope)}
        >
          <option value="all">All sheets ({sheets.length})</option>
          <option value="current">Current sheet ({current + 1})</option>
        </select>
        <div className="dimension-list">
          {selected.slice(0, 6).map((s) => (
            <div key={s.index}>
              <span>
                Sheet {s.index + 1} · {s.placements.length} cards
              </span>
              <strong>{formatDimensions(s.width, s.height, project.settings.units)}</strong>
            </div>
          ))}
          {selected.length > 6 && (
            <span className="muted">+ {selected.length - 6} more sheets</span>
          )}
        </div>
        <div className="soft-info">
          <ShieldCheck size={20} />
          <span>
            Print through Design Space so Cricut creates the correct sensor marks. This export does
            not include registration marks.
          </span>
        </div>
        {project.settings.profile === 'expanded' && (
          <div className="warning-box">
            Six-card {paperWorkflow(project.settings).outputPaper} output uses the experimental
            Tabloid setup in Design Space. Select {paperWorkflow(project.settings).outputPaper} at
            100% / Actual size in the system print dialog and confirm one page with all four sensor
            marks before printing.
          </div>
        )}
        {(project.settings.profile === 'seven' || project.settings.profile === 'eight') && (
          <div className="warning-box">
            This registered layout is experimental. Confirm one page, all four sensor marks, and a
            measured test cut before using card stock.
          </div>
        )}
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <button className="text-button calibration" disabled={!!busy} onClick={() => run(true)}>
          <Ruler size={17} /> Download a size-check card first
        </button>
      </div>
      <div className="modal-footer">
        <span className="muted">
          {selected.length} sheet{selected.length === 1 ? '' : 's'} · ZIP package
        </span>
        <button className="primary" disabled={!!busy} onClick={() => run()}>
          {busy ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}{' '}
          {busy || 'Download package'}
        </button>
      </div>
    </Modal>
  );
}
function CardArtwork({
  entry,
  label,
  large = false,
}: {
  entry: Entry;
  label: boolean;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false),
    face = entry.card.faces[entry.face],
    src = face[large ? 'image' : 'preview'];
  useEffect(() => {
    setFailed(false);
  }, [src]);
  return (
    <>
      <img
        className={usesMpcTrim(face) ? 'mpc-source-art' : undefined}
        src={src}
        alt={face.name}
        onError={() => setFailed(true)}
      />
      {failed && (
        <div className="art-fallback">
          <ImagePlus size={22} />
          <span>{entry.card.name}</span>
          <small>Artwork unavailable</small>
        </div>
      )}
      {label && <span className="proxy-label">PLAYTEST • NOT FOR SALE</span>}
    </>
  );
}
function ArtworkInspector({
  entry,
  copy,
  customArt,
  proxyLabel,
  backsEnabled,
  close,
  choosePrinting,
  chooseCustomArt,
  uploadCustomArt,
  chooseMpcArt,
  changeFace,
  changeArtworkTrim,
}: {
  entry: Entry;
  copy: number;
  customArt: Card[];
  proxyLabel: boolean;
  backsEnabled: boolean;
  close: () => void;
  choosePrinting: (card: Card) => void;
  chooseCustomArt: (card: Card) => void;
  uploadCustomArt: (file: File) => Promise<void>;
  chooseMpcArt: (card: Card) => void;
  changeFace: (face: number) => void;
  changeArtworkTrim: (enabled: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const mpcType = mpcArtworkType(entry.card);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [source, setSource] = useState<'scryfall' | 'mpc'>('scryfall'),
    [cards, setCards] = useState<Card[]>([]),
    [next, setNext] = useState<string>(),
    [loadingPrintings, setLoadingPrintings] = useState(false),
    [printingError, setPrintingError] = useState(''),
    [filter, setFilter] = useState('');
  useEffect(() => {
    // Each card opens on Scryfall, while changing the artwork source for the
    // current card keeps that source selected after an artwork is applied.
    setSource('scryfall');
  }, [entry.id]);
  useEffect(() => {
    let active = true;
    setCards([]);
    setNext(undefined);
    setFilter('');
    setPrintingError('');
    if (!entry.card.oracleId) return;
    setLoadingPrintings(true);
    variants(entry.card)
      .then((result) => {
        if (!active) return;
        setCards(result.cards);
        setNext(result.next);
      })
      .catch((reason) => {
        if (active) setPrintingError(errorText(reason));
      })
      .finally(() => {
        if (active) setLoadingPrintings(false);
      });
    return () => {
      active = false;
    };
  }, [entry.card]);
  async function loadMorePrintings() {
    if (!next) return;
    setLoadingPrintings(true);
    setPrintingError('');
    try {
      const result = await variants(entry.card, next);
      setCards((current) => [...current, ...result.cards]);
      setNext(result.next);
    } catch (reason) {
      setPrintingError(errorText(reason));
    } finally {
      setLoadingPrintings(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await uploadCustomArt(file);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <Modal
      wide
      className="artwork-modal"
      title={entry.card.name}
      subtitle={`${entry.card.setName}${entry.card.collector ? ` · #${entry.card.collector}` : ''}`}
      close={close}
    >
      <div className="art-inspector">
        <div className="inspector-preview">
          <div className="inspector-card">
            <CardArtwork entry={entry} label={proxyLabel} large />
          </div>
          <span>Print preview · front artwork</span>
        </div>
        <div className="inspector-controls">
          <div className="section-label">CARD ARTWORK</div>
          <h3>Choose what prints</h3>
          <p>
            {entry.quantity > 1
              ? `Editing copy ${copy + 1} of ${entry.quantity}. Artwork changes apply only to this copy.`
              : 'Change this card’s artwork without changing its position on the sheet.'}
          </p>
          {entry.card.faces.length > 1 && (
            <>
              <label className="inspector-face">
                Card face
                <select value={entry.face} onChange={(e) => changeFace(Number(e.target.value))}>
                  {entry.card.faces.map((face, index) => (
                    <option key={face.name} value={index}>
                      {face.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="warning-box double-sided-warning" role="status">
                This is a double-sided card.{' '}
                {backsEnabled
                  ? `${entry.card.faces[entry.face === 0 ? 1 : 0].name} will print as its matching reverse face.`
                  : 'Enable Print card backs to include its matching reverse face.'}
              </div>
            </>
          )}
          <ArtworkTrimControl face={entry.card.faces[entry.face]} change={changeArtworkTrim} />
          <div className="art-source-toggle" role="tablist" aria-label="Artwork source">
            <button
              role="tab"
              aria-selected={source === 'scryfall'}
              className={source === 'scryfall' ? 'selected' : ''}
              onClick={() => setSource('scryfall')}
            >
              Scryfall
            </button>
            <button
              role="tab"
              aria-selected={source === 'mpc'}
              className={source === 'mpc' ? 'selected' : ''}
              onClick={() => setSource('mpc')}
            >
              MPC Autofill
            </button>
          </div>
          {source === 'scryfall' ? (
            <div className="art-source-panel">
              <div className="search-field">
                <Search size={16} />
                <input
                  aria-label="Filter Scryfall printings"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by set or collector number…"
                />
              </div>
              {printingError && (
                <div role="alert" className="error-box">
                  {printingError}
                  <button className="text-button" onClick={() => void loadMorePrintings()}>
                    Retry
                  </button>
                </div>
              )}
              <div className="variant-grid inspector-variant-grid">
                {cards
                  .filter((card) =>
                    `${card.setName} ${card.set} ${card.collector}`
                      .toLowerCase()
                      .includes(filter.toLowerCase()),
                  )
                  .map((card) => (
                    <button
                      key={card.id}
                      className={`variant-card ${entry.card.id === card.id ? 'chosen' : ''}`}
                      onClick={() => choosePrinting(card)}
                    >
                      <img src={card.faces[0].preview} alt={card.name} loading="lazy" />
                      <strong>{card.setName}</strong>
                      <span>
                        {card.set.toUpperCase()} · #{card.collector}
                        {entry.card.id === card.id && ' · Selected'}
                      </span>
                    </button>
                  ))}
              </div>
              {!loadingPrintings && !printingError && !cards.length && (
                <p className="empty-message">
                  {entry.card.oracleId
                    ? 'No Scryfall printings found for this card.'
                    : 'Scryfall printings are unavailable for local artwork.'}
                </p>
              )}
              {loadingPrintings && (
                <div className="loading">
                  <LoaderCircle className="spin" size={18} /> Finding Scryfall printings…
                </div>
              )}
              {next && !loadingPrintings && (
                <button className="secondary load-more" onClick={() => void loadMorePrintings()}>
                  Load more printings
                </button>
              )}
            </div>
          ) : (
            <div className="art-source-panel">
              <MpcArtworkSearch
                key={`${entry.id}:${entry.face}:${mpcType}`}
                type={mpcType}
                initialQuery={
                  mpcType === 'TOKEN' ? entry.card.faces[entry.face].name : entry.card.name
                }
                openByDefault
                hideTrigger
                choose={(artwork) => chooseMpcArt(mpcArtworkAsCard(artwork, entry.card.name))}
              />
            </div>
          )}
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <div className="custom-art-panel">
            <div className="custom-art-heading">
              <div>
                <strong>Custom artwork</strong>
                <span>Upload your own image or reuse artwork already in this project.</span>
              </div>
              <button className="secondary" disabled={busy} onClick={() => input.current?.click()}>
                {busy ? <LoaderCircle className="spin" size={15} /> : <ImagePlus size={15} />}
                {busy ? 'Reading…' : 'Upload art'}
              </button>
            </div>
            {customArt.length > 0 && (
              <div className="project-art-grid">
                {customArt.map((card) => (
                  <button key={card.id} onClick={() => chooseCustomArt(card)}>
                    <span className="project-art-image">
                      <img
                        className={usesMpcTrim(card.faces[0]) ? 'mpc-source-art' : undefined}
                        src={card.faces[0].preview}
                        alt={card.name}
                      />
                    </span>
                    <span>{card.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <div className="modal-footer">
        <span className="muted">Artwork changes apply only to this card copy.</span>
        <button className="secondary" onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  );
}
function useCapturedRegistration(settings: Settings, refresh: number) {
  const key = registrationKey(settings);
  const [saved, setSaved] = useState<{ key: string; profile: RegistrationProfile }>();
  useEffect(() => {
    let active = true;
    setSaved(undefined);
    if (settings.machine === 'manual' || settings.profile === 'nine') return;
    void (async () => {
      let cached: RegistrationProfile | undefined;
      const show = async (profile: RegistrationProfile) => {
        const preview = await registrationPreviewImage(profile, settings).catch(
          () => profile.preview,
        );
        if (active) setSaved({ key, profile: { ...profile, preview } });
      };
      try {
        let value = await get<RegistrationProfile>(`registration:${key}`);
        if (value?.version === 1 && value.key === key && value.pdf instanceof Uint8Array) {
          registeredOutputFrame(value, settings);
          if ((value.previewWidth ?? 380) < 800) {
            try {
              const upgraded = await captureProfile(value.pdf, settings, value.name);
              upgraded.capturedAt = value.capturedAt;
              value = upgraded;
              await set(`registration:${key}`, upgraded).catch(() => {});
            } catch {
              // The saved thumbnail remains usable if a legacy PDF cannot be rerendered.
            }
          }
          cached = value;
          await show(value);
        }
      } catch {
        // The project library can still provide the captured template.
      }
      try {
        const library = window.criprox?.registrationTemplates;
        if (!library) return;
        const stored = await library.load(
          templateId(settings),
          fullTemplate(settings).placements.length,
          templateFilenameStem(settings),
        );
        if (!stored || (cached?.name === stored.name && cached.capturedAt === stored.capturedAt))
          return;
        const profile = await captureProfile(new Uint8Array(stored.pdf), settings, stored.name);
        profile.capturedAt = stored.capturedAt;
        await set(`registration:${key}`, profile).catch(() => {});
        await show(profile);
      } catch {
        // Keep a valid local capture, or show the generated print layout.
      }
    })();
    return () => {
      active = false;
    };
  }, [key, refresh]);
  return saved?.key === key ? saved.profile : undefined;
}

function SheetPreview({
  legendHost,
  sheet,
  settings,
  mode,
  showCuts,
  zoom,
  registrationRefresh,
  select,
  inspect,
}: {
  legendHost: HTMLElement | null;
  sheet?: Sheet;
  settings: Settings;
  mode: string;
  showCuts: boolean;
  zoom: number;
  registrationRefresh: number;
  select: (target: EntryCopy) => void;
  inspect: (target: EntryCopy) => void;
}) {
  const captured = useCapturedRegistration(settings, registrationRefresh),
    frame = sheetPreviewFrame(settings, captured),
    paper = frame.paper,
    area = fullTemplate(settings),
    manualNine = settings.profile === 'nine',
    manualHandCut = manualNine && settings.machine === 'manual',
    registered = settings.machine !== 'manual' && !manualNine,
    cutOnly = mode === 'cuts' && !registered,
    sheetPosition = {
      left: `${(frame.left / paper.w) * 100}%`,
      top: `${(frame.top / paper.h) * 100}%`,
      transform: 'none',
    },
    guidePaths =
      manualHandCut && sheet
        ? manualGuidePathsByKind(
            manualCutLineBounds(sheet, settings),
            { width: paper.w, height: paper.h },
            settings,
          )
        : { page: [], card: [] };
  return (
    <div className="paper-stage">
      <div
        className="paper"
        style={{
          width: `calc(var(--paper-width, 390px) * ${zoom / 100})`,
          aspectRatio: `${paper.w} / ${paper.h}`,
        }}
      >
        {registered && captured && frame.master && (
          <>
            <img
              className="registered-master"
              src={captured.preview}
              alt=""
              draggable={false}
              style={{
                left: `${(frame.master.left / paper.w) * 100}%`,
                top: `${(frame.master.top / paper.h) * 100}%`,
                width: `${(frame.master.width / paper.w) * 100}%`,
                height: `${(frame.master.height / paper.h) * 100}%`,
              }}
            />
            <div
              className="registration-art-mask"
              style={{
                left: `${((frame.left - REGISTERED_ART_MASK_PAD_MM) / paper.w) * 100}%`,
                top: `${((frame.top - REGISTERED_ART_MASK_PAD_MM) / paper.h) * 100}%`,
                width: `${((area.width + 2 * REGISTERED_ART_MASK_PAD_MM) / paper.w) * 100}%`,
                height: `${((area.height + 2 * REGISTERED_ART_MASK_PAD_MM) / paper.h) * 100}%`,
              }}
            />
          </>
        )}
        {sheet ? (
          <div
            className="sheet-art"
            style={{
              width: `${(sheet.width / paper.w) * 100}%`,
              height: `${(sheet.height / paper.h) * 100}%`,
              ...sheetPosition,
            }}
          >
            {sheet.placements.map((p, i) => (
              <button
                key={`${p.entry.id}-${p.copy}`}
                aria-label={`Select ${p.entry.card.name}, copy ${p.copy + 1}`}
                data-entry-id={p.entry.id}
                data-copy={p.copy}
                aria-haspopup="menu"
                title={
                  cutOnly
                    ? 'Select card · Right-click for actions'
                    : 'Open artwork preview · Right-click for actions'
                }
                className={`placed-card ${cutOnly ? 'cut-only' : ''}`}
                onDragStart={(event) => event.preventDefault()}
                style={{
                  left: `${(p.x / sheet.width) * 100}%`,
                  top: `${(p.y / sheet.height) * 100}%`,
                  width: `${(p.width / sheet.width) * 100}%`,
                  height: `${(p.height / sheet.height) * 100}%`,
                  borderRadius: `${(settings.radius / p.width) * 100}% / ${(settings.radius / p.height) * 100}%`,
                }}
                onClick={() => (cutOnly ? select : inspect)({ entryId: p.entry.id, copy: p.copy })}
              >
                {cutOnly ? (
                  <span>
                    {String(i + 1).padStart(2, '0')}
                    <small>
                      {formatDimensions(settings.width, settings.height, settings.units)}
                    </small>
                  </span>
                ) : (
                  <div
                    className="card-front"
                    style={
                      p.rotated
                        ? {
                            width: `${(p.height / p.width) * 100}%`,
                            height: `${(p.width / p.height) * 100}%`,
                            transform: 'rotate(90deg)',
                            transformOrigin: 'top left',
                            left: '100%',
                          }
                        : {}
                    }
                  >
                    <CardArtwork entry={p.entry} label={settings.proxyLabel} />
                  </div>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-paper">
            <Layers3 size={38} strokeWidth={1} />
            <strong>Make room for your next deck.</strong>
            <span>Drop images here or use Add artwork.</span>
          </div>
        )}
        {showCuts && sheet && (
          <svg
            className="sheet-guide-overlay"
            viewBox={`0 0 ${paper.w} ${paper.h}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Card cut paths"
          >
            {sheet.placements.map((p, i) => (
              <path
                key={`${p.entry.id}-${p.copy}`}
                d={polygonPath(
                  shapePolygon({
                    itemId: `card-${i}`,
                    x: frame.left + p.x,
                    y: frame.top + p.y,
                    width: p.width,
                    height: p.height,
                    radius: settings.radius,
                    rotation: 0,
                  }),
                )}
                fill="none"
                stroke="#ec268f"
                strokeWidth={1}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            ))}
          </svg>
        )}
        {manualHandCut && (guidePaths.page.length > 0 || guidePaths.card.length > 0) && (
          <svg
            className="sheet-guide-overlay"
            viewBox={`0 0 ${paper.w} ${paper.h}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {[
              { paths: guidePaths.page, color: settings.manualGuidePageColor },
              { paths: guidePaths.card, color: settings.manualGuideColor },
            ].map(({ paths, color }, group) =>
              paths.map((path, index) => (
                <polyline
                  key={`${group}-${index}`}
                  points={path.map(({ x, y }) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth={manualGuideWidthMm(settings)}
                  strokeDasharray={
                    settings.manualGuideLineStyle === 'dashed'
                      ? manualGuideDashMm(settings).join(' ')
                      : undefined
                  }
                />
              )),
            )}
          </svg>
        )}
        <svg className="machine-guide-overlay" viewBox={`0 0 ${paper.w} ${paper.h}`}>
          <MachineGuideShapes
            machine={settings.machine}
            paper={settings.paper}
            area={{ x: frame.left, y: frame.top, width: area.width, height: area.height }}
            captured={!!captured}
            optical={registered}
          />
        </svg>
      </div>
      {legendHost &&
        createPortal(
          <MachineGuideLegend
            machine={settings.machine}
            paper={settings.paper}
            area={{ x: frame.left, y: frame.top, width: area.width, height: area.height }}
            captured={!!captured}
            optical={registered}
            conflicts={
              sheet?.placements.filter((p) =>
                outsidePlanningGuide(
                  { x: p.x + frame.left, y: p.y + frame.top, width: p.width, height: p.height },
                  machineGuide(settings.machine, settings.paper),
                ),
              ).length ?? 0
            }
          />,
          legendHost,
        )}
    </div>
  );
}

function DonationLink() {
  return (
    <a
      className="donation-link"
      href="https://ko-fi.com/go2engle"
      target="_blank"
      rel="noreferrer"
      aria-label="Donation"
    >
      <span className="donation-coin" aria-hidden="true">
        <svg viewBox="0 0 48 48" focusable="false">
          <defs>
            <linearGradient
              id="donation-coin-face"
              x1="13"
              y1="9"
              x2="35"
              y2="39"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#ffe38a" />
              <stop offset="0.5" stopColor="#f4b83f" />
              <stop offset="1" stopColor="#d89025" />
            </linearGradient>
          </defs>
          <ellipse cx="24" cy="27" rx="17" ry="16" fill="#a9661d" opacity="0.45" />
          <circle
            cx="24"
            cy="23"
            r="17"
            fill="url(#donation-coin-face)"
            stroke="#ad6b1b"
            strokeWidth="1.5"
          />
          <circle
            cx="24"
            cy="23"
            r="12.5"
            fill="none"
            stroke="#ffe596"
            strokeWidth="1.5"
            opacity="0.9"
          />
          <path d="M16.5 21.5h13v4.1c0 3.2-2.5 5.7-6.5 5.7s-6.5-2.5-6.5-5.7v-4.1Z" fill="#8c531d" />
          <path
            d="M29.5 23h1.2c1.4 0 2.2.7 2.2 1.8s-.8 1.8-2.2 1.8h-1.2"
            fill="none"
            stroke="#8c531d"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M19.5 19c-.7-1.4.2-2.1-.3-3.3M24 19c-.7-1.4.2-2.1-.3-3.3"
            fill="none"
            stroke="#8c531d"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M18.5 34.5h11"
            stroke="#fff0b0"
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.75"
          />
        </svg>
      </span>
      <span className="donation-tooltip" role="tooltip">
        Donation
      </span>
    </a>
  );
}

export default function App() {
  useAiDesignBridge();
  const [cardDesigner, setCardDesigner] = useState<{
    target: EntryCopy;
    name: string;
    design: StickerDesign;
  }>();
  const [colorTheme, setColorTheme] = useState<ColorTheme>(getInitialColorTheme);
  const {
    value: project,
    setValue: setProject,
    reset: resetProject,
    undo: undoCards,
    redo: redoCards,
  } = useWorkspaceHistory<Project>(createSample);
  const [workspace, setWorkspace] = useState<'home' | WorkspaceId>('home'),
    [stickerPrintRequest, setStickerPrintRequest] = useState(0);
  const [showCardCuts, setShowCardCuts] = useState(false);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const stickerDraft = useRef<StickerProject | undefined>(undefined);
  const [initialRecentIds] = useState<Partial<Record<WorkspaceId, string>>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('criprox-recent-active') || '{}');
      return Object.fromEntries(
        Object.entries(stored).filter(
          ([key, value]) => WORKSPACES.some((mode) => mode.id === key) && typeof value === 'string',
        ),
      );
    } catch {
      return {};
    }
  });
  const recentIds = useRef(initialRecentIds);
  function setRecentId(mode: WorkspaceId, id?: string) {
    if (id) recentIds.current[mode] = id;
    else delete recentIds.current[mode];
    try {
      localStorage.setItem('criprox-recent-active', JSON.stringify(recentIds.current));
    } catch {}
  }
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]),
    [homeBusy, setHomeBusy] = useState(false);
  const [stickerDraftSummary, setStickerDraftSummary] =
    useState<ReturnType<typeof projectSummary>>();
  const [stickerRequest, setStickerRequest] = useState<{
    sequence: number;
    project?: StickerProject;
  }>();
  const homeInput = useRef<HTMLInputElement>(null);
  const updateStickerDraft = useCallback((next: StickerProject) => {
    const first = !stickerDraft.current;
    stickerDraft.current = next;
    if (first || workspaceRef.current === 'home')
      setStickerDraftSummary(projectSummary(next, 'stickers'));
  }, []);
  const recordRecent = useCallback(
    async (next: Project | StickerProject, mode: WorkspaceId, fresh: boolean | string = false) => {
      if (typeof fresh === 'string') setRecentId(mode, fresh);
      else if (fresh) setRecentId(mode);
      const items = await rememberRecentProject(next, mode, recentIds.current[mode]);
      setRecentId(mode, items[0].id);
      setRecentProjects(items);
    },
    [],
  );
  const recordStickerRecent = useCallback(
    (next: StickerProject, fresh: boolean | string = false) =>
      recordRecent(next, 'stickers', fresh),
    [recordRecent],
  );
  const [stickerTitleHost, setStickerTitleHost] = useState<HTMLDivElement | null>(null),
    [stickerActionsHost, setStickerActionsHost] = useState<HTMLDivElement | null>(null);
  const cardClipboard = useRef<Entry | undefined>(undefined);
  const [guideLegendHost, setGuideLegendHost] = useState<HTMLDivElement | null>(null);
  const [projectDefaults, setProjectDefaults] = useState<ProjectDefaults>(FACTORY_PROJECT_DEFAULTS),
    [savingSheetDefaults, setSavingSheetDefaults] = useState(false),
    [loaded, setLoaded] = useState(false),
    [saved, setSaved] = useState('Opening workspace…');
  const [modal, setModal] = useState<
    | 'search'
    | 'import'
    | 'guide'
    | 'export'
    | 'new'
    | 'clear'
    | 'registered'
    | 'print-cut'
    | 'projects'
    | 'settings'
    | null
  >(null);
  const [returnToPrintCut, setReturnToPrintCut] = useState(false);
  const [selected, setSelected] = useState<EntryCopy | null>(null),
    [inspecting, setInspecting] = useState<EntryCopy | null>(null),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [mode, setMode] = useState('art'),
    [zoom, setZoom] = useState(100),
    [registrationRefresh, setRegistrationRefresh] = useState(0),
    [toast, setToast] = useState(''),
    [updateState, setUpdateState] = useState<UpdateState>(INITIAL_UPDATE_STATE),
    [updateOpening, setUpdateOpening] = useState(false),
    [settingsPage, setSettingsPage] = useState('New project defaults'),
    [reminder, setReminder] = useState(() => {
      try {
        return JSON.parse(localStorage.getItem('criprox-release-reminder') || 'null') as {
          version: string;
          until: number;
        } | null;
      } catch {
        return null;
      }
    }),
    [reminderClock, setReminderClock] = useState(Date.now()),
    [uploading, setUploading] = useState(false),
    [draggingArtwork, setDraggingArtwork] = useState(false),
    [projectLibrary, setProjectLibrary] = useState<ProjectLibrarySnapshot | null>(null),
    [libraryBusy, setLibraryBusy] = useState(false),
    [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
      localStorage.getItem('criprox-active-project'),
    );
  const [cardMenu, setCardMenu] = useState<SheetCardMenuTarget | null>(null);
  useAiWorkspace('cards', {
    read: () => project,
    write: (next, fresh) => {
      if (fresh) {
        setActiveProjectId(null);
        localStorage.removeItem('criprox-active-project');
        setRecentId('cards');
      }
      setProject(next as Project);
      setSelected(null);
      setPage(0);
    },
    open: () => {
      setModal(null);
      setWorkspace('cards');
    },
    undo: undoCards,
    redo: redoCards,
    busy: () => !loaded || uploading || libraryBusy || !!cardDesigner,
  });
  const [deletingCard, setDeletingCard] = useState<SheetCardMenuTarget | null>(null);
  const deleteCardCancel = useRef<HTMLButtonElement>(null);
  useEffect(() => setDeletingCard(null), [project, page, mode, modal]);
  const closeCardMenu = useCallback(() => setCardMenu(null), []);
  useEffect(closeCardMenu, [project, page, zoom, mode, modal, closeCardMenu]);
  const imageInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    paperViewport = useRef<HTMLDivElement>(null),
    artworkDragDepth = useRef(0),
    zoomAnchor = useRef<{
      x: number;
      y: number;
      paperX: number;
      paperY: number;
    } | null>(null),
    zoomInitialized = useRef(false),
    paperSize = useRef<{ width: number; height: number } | null>(null);
  const saveQueue = useRef(Promise.resolve());
  function changeZoom(update: (current: number) => number, point?: { x: number; y: number }) {
    const viewport = paperViewport.current;
    const paper = viewport?.querySelector<HTMLElement>('.paper');
    if (viewport && paper) {
      const viewportRect = viewport.getBoundingClientRect();
      const x = point?.x ?? viewportRect.left + viewportRect.width / 2;
      const y = point?.y ?? viewportRect.top + viewportRect.height / 2;
      const paperRect = paper.getBoundingClientRect();
      zoomAnchor.current = {
        x,
        y,
        paperX: (x - paperRect.left) / paperRect.width,
        paperY: (y - paperRect.top) / paperRect.height,
      };
    }
    setZoom(update);
  }
  useLayoutEffect(() => {
    const viewport = paperViewport.current;
    const paper = viewport?.querySelector<HTMLElement>('.paper');
    if (!viewport || !paper) return;

    if (!zoomInitialized.current) {
      viewport.scrollLeft = paper.offsetWidth / 2;
      viewport.scrollTop = paper.offsetHeight / 2;
      zoomInitialized.current = true;
    } else if (zoomAnchor.current) {
      const { x, y, paperX, paperY } = zoomAnchor.current;
      const paperRect = paper.getBoundingClientRect();
      viewport.scrollLeft += paperRect.left + paperX * paperRect.width - x;
      viewport.scrollTop += paperRect.top + paperY * paperRect.height - y;
    }
    const paperRect = paper.getBoundingClientRect();
    paperSize.current = { width: paperRect.width, height: paperRect.height };
    zoomAnchor.current = null;
  }, [zoom]);
  useEffect(() => {
    const viewport = paperViewport.current;
    const paper = viewport?.querySelector<HTMLElement>('.paper');
    if (!viewport || !paper) return;

    const observer = new ResizeObserver(() => {
      const rect = paper.getBoundingClientRect();
      const previous = paperSize.current;
      if (previous) {
        viewport.scrollLeft += (rect.width - previous.width) / 2;
        viewport.scrollTop += (rect.height - previous.height) / 2;
      }
      paperSize.current = { width: rect.width, height: rect.height };
    });
    observer.observe(paper);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const viewport = paperViewport.current;
    if (!viewport) return;

    const openMenu = (event: Pick<MouseEvent, 'target' | 'clientX' | 'clientY'>) => {
      const anchor = (event.target as Element).closest<HTMLButtonElement>('.placed-card');
      if (!anchor) return;
      const target = { entryId: anchor.dataset.entryId!, copy: Number(anchor.dataset.copy) };
      setSelected(target);
      setCardMenu({ target, anchor, x: event.clientX, y: event.clientY });
    };
    const keyboardMenu = (event: KeyboardEvent) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      const anchor = (event.target as Element).closest<HTMLButtonElement>('.placed-card');
      if (!anchor) return;
      event.preventDefault();
      const bounds = anchor.getBoundingClientRect();
      openMenu({
        target: anchor,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      });
    };
    viewport.addEventListener('keydown', keyboardMenu);
    const dispose = enableArtboardPanning(viewport, openMenu);
    return () => {
      dispose();
      viewport.removeEventListener('keydown', keyboardMenu);
    };
  }, []);
  useEffect(() => {
    const viewport = paperViewport.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      const pixels =
        event.deltaY *
        (event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? viewport.clientHeight
            : 1);
      // Limit unusually large wheel events while keeping trackpad scrolling smooth.
      const delta = Math.max(-200, Math.min(200, pixels));
      changeZoom((current) => Math.max(70, Math.min(400, current * Math.exp(-delta / 1000))), {
        x: event.clientX,
        y: event.clientY,
      });
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, []);
  useEffect(() => {
    applyColorTheme(colorTheme);
    saveColorTheme(colorTheme);
  }, [colorTheme]);
  const rememberActiveProject = useCallback((projectId: string | null) => {
    setActiveProjectId(projectId);
    if (projectId) localStorage.setItem('criprox-active-project', projectId);
    else localStorage.removeItem('criprox-active-project');
  }, []);
  const refreshProjectLibrary = useCallback(async () => {
    const projects = window.criprox?.projects;
    if (!projects) return;
    setLibraryBusy(true);
    try {
      const snapshot = await projects.list();
      setProjectLibrary(snapshot);
      setActiveProjectId((current) => {
        if (!current || snapshot.projects.some((item) => item.id === current)) return current;
        localStorage.removeItem('criprox-active-project');
        return null;
      });
    } catch (error) {
      setToast(errorText(error));
    } finally {
      setLibraryBusy(false);
    }
  }, []);
  useEffect(() => {
    void listRecentProjects()
      .then(setRecentProjects)
      .catch(() => {});
  }, []);
  function chooseWorkspace(id: WorkspaceId) {
    setWorkspace(id);
    setModal(null);
    setCardMenu(null);
  }
  async function showHome() {
    setWorkspace('home');
    setModal(null);
    setCardMenu(null);
    setHomeBusy(true);
    if (stickerDraft.current)
      setStickerDraftSummary(projectSummary(stickerDraft.current, 'stickers'));
    try {
      if (workspace === 'cards' && project.entries.length) await recordRecent(project, 'cards');
      if (workspace === 'stickers' && stickerDraft.current?.artwork.length)
        await recordRecent(stickerDraft.current, 'stickers');
      await refreshProjectLibrary();
    } catch (error) {
      setToast(errorText(error));
    } finally {
      setHomeBusy(false);
    }
  }
  async function newWorkspace(id: WorkspaceId) {
    setHomeBusy(true);
    try {
      if (id === 'cards') {
        if (project.entries.length) await recordRecent(project, 'cards');
        setRecentId('cards');
        startFreshProject();
        chooseWorkspace('cards');
      } else {
        if (stickerDraft.current?.artwork.length)
          await recordRecent(stickerDraft.current, 'stickers');
        setRecentId('stickers');
        setStickerRequest((r) => ({ sequence: (r?.sequence ?? 0) + 1 }));
        chooseWorkspace('stickers');
      }
    } catch (error) {
      setToast(errorText(error));
    } finally {
      setHomeBusy(false);
    }
  }
  async function openHomeRecent(item: HomeProject) {
    setHomeBusy(true);
    try {
      if (item.source === 'library') {
        await openManagedProject(item.id);
        return;
      }
      const next = await readRecentProject(item.id);
      if (item.workspace === 'cards') {
        const cards = validateProject(next);
        if (project.entries.length) await recordRecent(project, 'cards');
        setRecentId('cards', item.id);
        resetProject(cards);
        rememberActiveProject(null);
        setPage(0);
        setSelected(null);
        setInspecting(null);
      } else {
        const stickers = validateStickerProject(next);
        if (stickerDraft.current?.artwork.length)
          await recordRecent(stickerDraft.current, 'stickers');
        setRecentId('stickers', item.id);
        setStickerRequest((r) => ({ sequence: (r?.sequence ?? 0) + 1, project: stickers }));
      }
      chooseWorkspace(item.workspace);
    } catch (error) {
      setToast(errorText(error));
    } finally {
      setHomeBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    async function restoreWorkspace() {
      let workspaceFailed = false,
        defaultsFailed = false;
      try {
        const value = await get('criprox-project');
        if (active && value) resetProject(validateProject(value));
      } catch {
        workspaceFailed = true;
      }
      try {
        const value = await get(PROJECT_DEFAULTS_KEY);
        if (active && value) setProjectDefaults(validateProjectDefaults(value));
      } catch {
        defaultsFailed = true;
      }
      if (!active) return;
      if (workspaceFailed)
        setToast(
          'Saved workspace could not be restored. Open a saved project backup to recover it.',
        );
      else if (defaultsFailed)
        setToast('Saved project defaults could not be restored. Factory defaults will be used.');
      setLoaded(true);
    }
    void restoreWorkspace();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    void refreshProjectLibrary();
  }, [refreshProjectLibrary]);
  useEffect(() => {
    const releases = window.criprox?.releases;
    if (!releases) return;
    let active = true;
    const unsubscribe = releases.onState((state) => {
      if (active) setUpdateState(state);
    });
    releases
      .check()
      .then((state) => {
        if (active) setUpdateState(state);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!reminder || reminder.until <= Date.now()) return;
    const timer = setTimeout(
      () => setReminderClock(Date.now()),
      Math.min(reminder.until - Date.now(), 24 * 60 * 60 * 1000),
    );
    return () => clearTimeout(timer);
  }, [reminder]);
  useEffect(() => {
    if (!loaded) return;
    setSaved('Saving…');
    const timer = setTimeout(() => {
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(() => set('criprox-project', project));
      saveQueue.current
        .then(() => setSaved('Saved on this device'))
        .catch(() => setSaved('Could not autosave · save a backup'));
    }, 400);
    return () => clearTimeout(timer);
  }, [project, loaded]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 6000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const sheets = useMemo(
    () => fixedSheets(project.entries, project.settings),
    [project.entries, project.settings],
  );
  const currentPage = Math.min(page, Math.max(0, sheets.length - 1)),
    sheet = sheets[currentPage];
  const count = project.entries.reduce((n, e) => n + e.quantity, 0),
    g = grid(project.settings),
    doubleSidedCount = doubleSidedCardCount(project.entries),
    sharedBackRequired = count > doubleSidedCount;
  const activeEntry = project.entries.find((e) => e.id === selected?.entryId);
  const menuEntry = project.entries.find((e) => e.id === cardMenu?.target.entryId);
  const deletingEntry = project.entries.find((e) => e.id === deletingCard?.target.entryId);
  const emptySlots = sheet ? g.capacity - sheet.placements.length : 0;
  const fillHint =
    emptySlots === 0
      ? 'This page is already full.'
      : count + emptySlots > 500
        ? 'Filling this page would exceed the 500-card limit.'
        : `Fill ${emptySlots} empty slot${emptySlots === 1 ? '' : 's'} with this artwork.`;
  const inspectedEntry = project.entries.find((e) => e.id === inspecting?.entryId);
  const customArt = project.entries
    .filter(
      (entry) => entry.id !== inspecting?.entryId && ['local', 'custom'].includes(entry.card.set),
    )
    .filter(
      (entry, index, entries) =>
        entries.findIndex((candidate) => candidate.card.id === entry.card.id) === index,
    )
    .map((entry) => entry.card);
  const filtered = project.entries.filter((e) =>
    `${e.card.name} ${e.card.setName}`.toLowerCase().includes(search.toLowerCase()),
  );
  useEffect(() => {
    if (workspace !== 'cards' || !loaded || modal || libraryBusy || cardDesigner) return;
    const handler = (event: KeyboardEvent) => {
      const action = workspaceShortcut(event, isTextEditing(event.target));
      if (!action) return;
      event.preventDefault();
      if (action === 'undo' || action === 'redo') {
        (action === 'undo' ? undoCards : redoCards)();
        setSelected(null);
        setInspecting(null);
        setCardMenu(null);
        return;
      }
      if (action === 'paste') {
        if (!cardClipboard.current) return;
        if (project.entries.reduce((n, e) => n + e.quantity, 0) >= 500) {
          setToast('A project can contain at most 500 cards.');
          return;
        }
        const entry = { ...cardClipboard.current, id: crypto.randomUUID(), quantity: 1 };
        add([entry]);
        setSelected({ entryId: entry.id, copy: 0 });
        setToast('Card pasted.');
        return;
      }
      const target = selected ?? inspecting;
      if (!target) return;
      const entry = project.entries.find((e) => e.id === target.entryId);
      if (!entry) return;
      if (action !== 'delete') cardClipboard.current = { ...entry, quantity: 1 };
      if (action === 'cut' || action === 'delete') {
        setProject((p) => ({ ...p, entries: deleteEntryCopy(p.entries, target) }));
        setSelected(null);
        setInspecting(null);
        setCardMenu(null);
      }
      setToast(
        action === 'delete'
          ? 'Card deleted. Ctrl+Z restores it.'
          : action === 'cut'
            ? 'Card cut. Use Paste to place it.'
            : 'Card copied.',
      );
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  function settings(patch: Partial<Settings>) {
    setProject((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  }
  async function saveSheetSettingsAsDefaults() {
    const next = withSheetSettingsDefaults(projectDefaults, project.settings);
    setSavingSheetDefaults(true);
    try {
      await set(PROJECT_DEFAULTS_KEY, next);
      setProjectDefaults(next);
      setToast('Sheet setup defaults saved for new projects.');
    } catch {
      setToast('Could not save sheet setup defaults on this device.');
    } finally {
      setSavingSheetDefaults(false);
    }
  }
  async function saveEditedProjectDefaults(source: ProjectDefaults, apply: boolean) {
    const next = validateProjectDefaults(source);
    await set(PROJECT_DEFAULTS_KEY, next);
    setProjectDefaults(next);
    if (apply) {
      const fresh = projectFromDefaults(next);
      setProject((current) => ({
        ...current,
        settings: fresh.settings,
        backArtwork: fresh.backArtwork,
      }));
      setPage(0);
    }
    setToast(
      apply
        ? 'Defaults saved and applied to the current project.'
        : 'Defaults saved for new projects.',
    );
  }
  function loadSheetSettingsDefaults() {
    settings(projectDefaults.settings);
    setPage(0);
    setToast('Saved sheet setup applied to the current project.');
  }
  function startFreshProject() {
    setRecentId('cards');
    setWorkspace('cards');
    resetProject(projectFromDefaults(projectDefaults));
    rememberActiveProject(null);
    setSelected(null);
    setInspecting(null);
    setPage(0);
    setSearch('');
    setModal(null);
  }
  function editEntry(id: string, patch: Partial<Entry>) {
    setProject((p) => ({
      ...p,
      entries: p.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }
  function inspect(target: EntryCopy) {
    setSelected(target);
    setInspecting(target);
  }
  function copyOnSheet(target: EntryCopy, action: 'duplicate' | 'fill') {
    const ids = { added: crypto.randomUUID(), remainder: crypto.randomUUID() };
    setProject((current) => {
      const entries = copyEntryOnSheet(
        current.entries,
        current.settings,
        target,
        currentPage,
        action,
        ids,
      );
      return entries === current.entries ? current : { ...current, entries };
    });
  }
  function cancelDeleteCard() {
    const anchor = deletingCard?.anchor;
    setDeletingCard(null);
    requestAnimationFrame(() => anchor?.focus({ preventScroll: true }));
  }
  function confirmDeleteCard() {
    if (!deletingCard) return;
    const target = deletingCard.target;
    setProject((current) => {
      const entries = deleteEntryCopy(current.entries, target);
      return entries === current.entries ? current : { ...current, entries };
    });
    setSelected(null);
    setInspecting(null);
    setDeletingCard(null);
    setPage(Math.min(currentPage, Math.max(0, Math.ceil((count - 1) / g.capacity) - 1)));
    setToast('Card deleted.');
    requestAnimationFrame(() =>
      paperViewport.current
        ?.querySelector<HTMLButtonElement>('.placed-card')
        ?.focus({ preventScroll: true }),
    );
  }
  function editCopy(target: EntryCopy, patch: EntryArtworkPatch) {
    const entry = project.entries.find((candidate) => candidate.id === target.entryId);
    if (!entry || target.copy < 0 || target.copy >= entry.quantity) return;
    if (entry.quantity === 1) {
      editEntry(entry.id, patch);
      return;
    }
    const editedId = crypto.randomUUID(),
      remainderId = crypto.randomUUID();
    setProject((current) => ({
      ...current,
      entries: editEntryCopy(current.entries, target, patch, {
        edited: editedId,
        remainder: remainderId,
      }),
    }));
    const edited = { entryId: editedId, copy: 0 };
    setSelected((current) =>
      current?.entryId === target.entryId && current.copy === target.copy ? edited : current,
    );
    setInspecting((current) =>
      current?.entryId === target.entryId && current.copy === target.copy ? edited : current,
    );
  }
  function applyArtwork(target: EntryCopy, entry: Entry, artwork: Card) {
    const face = artwork.faces[0],
      doubleSided = isDoubleSidedCard(entry.card);
    const faces = doubleSided
      ? entry.card.faces.map((existing, index) =>
          index === entry.face ? { ...face, name: existing.name } : existing,
        )
      : [{ ...face, name: entry.card.name }];
    editCopy(target, {
      face: doubleSided ? entry.face : 0,
      card: {
        ...entry.card,
        id: artwork.id,
        set: artwork.set,
        setName: artwork.setName,
        collector: artwork.collector,
        faces,
      },
    });
  }
  function add(entries: Entry[]) {
    setProject((p) => {
      if (
        p.entries.reduce((n, e) => n + e.quantity, 0) +
          entries.reduce((n, e) => n + e.quantity, 0) >
        500
      )
        return p;
      return { ...p, entries: [...p.entries, ...entries] };
    });
  }
  function addCard(card: Card) {
    setProject((current) => {
      const entries = addCardToEntries(current.entries, card, crypto.randomUUID());
      return entries === current.entries ? current : { ...current, entries };
    });
  }
  function quantity(entry: Entry, delta: number) {
    if (entry.quantity + delta < 1 || entry.quantity + delta > 100) return;
    if (delta > 0 && count >= 500) {
      setToast('Projects can contain up to 500 cards.');
      return;
    }
    editEntry(entry.id, { quantity: entry.quantity + delta });
  }
  async function uploadImages(files: FileList | null) {
    if (!files?.length) return;
    if (files.length + count > 500) {
      setToast('Projects can contain up to 500 cards.');
      return;
    }
    setUploading(true);
    try {
      const entries: Entry[] = [];
      for (const file of Array.from(files)) {
        const card = await cardFromArtwork(file);
        entries.push({
          id: crypto.randomUUID(),
          quantity: 1,
          face: 0,
          card,
        });
      }
      add(entries);
      const detected = entries.filter((entry) => usesMpcTrim(entry.card.faces[0])).length;
      setToast(
        `${entries.length} artwork file${entries.length === 1 ? '' : 's'} added.${
          detected
            ? ` MPC-style print bleed detected on ${detected}; review the toggle in Card Artwork if needed.`
            : ''
        }`,
      );
    } catch (e) {
      setToast(errorText(e));
    } finally {
      setUploading(false);
      if (imageInput.current) imageInput.current.value = '';
    }
  }
  function artworkDragEnter(event: DragEvent<HTMLElement>) {
    if (!loaded || uploading || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    artworkDragDepth.current += 1;
    setDraggingArtwork(true);
  }
  function artworkDragOver(event: DragEvent<HTMLElement>) {
    if (!loaded || uploading || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }
  function artworkDragLeave() {
    if (!artworkDragDepth.current) return;
    artworkDragDepth.current = Math.max(0, artworkDragDepth.current - 1);
    if (!artworkDragDepth.current) setDraggingArtwork(false);
  }
  function artworkDrop(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    artworkDragDepth.current = 0;
    setDraggingArtwork(false);
    if (loaded && !uploading) void uploadImages(event.dataTransfer.files);
  }
  async function uploadBackArtwork(file?: File) {
    if (!file) return;
    const card = await cardFromArtwork(file);
    setProject((current) => ({
      ...current,
      backArtwork: {
        ...card.faces[0],
        name: 'Card back',
      },
    }));
    setToast(
      usesMpcTrim(card.faces[0])
        ? 'Card-back artwork saved. MPC-style print bleed was detected; review the toggle if needed.'
        : 'Card-back artwork saved.',
    );
  }
  function chooseBackArtwork(face: Project['backArtwork']) {
    if (!face) return;
    setProject((current) => ({ ...current, backArtwork: face }));
    setToast('MPC Autofill card back selected.');
  }
  function changeBackArtworkTrim(enabled: boolean) {
    setProject((current) =>
      current.backArtwork
        ? { ...current, backArtwork: withMpcTrim(current.backArtwork, enabled) }
        : current,
    );
    setToast(`MPC-style source bleed ${enabled ? 'enabled' : 'disabled'} for the card back.`);
  }
  async function exportProjectBackup() {
    try {
      const didSave = await saveProjectAs(project);
      if (didSave) await recordRecent(project, 'cards');
      setToast(didSave ? 'Project backup exported.' : 'Export cancelled.');
    } catch (error) {
      setToast(errorText(error));
    }
  }
  async function saveCurrentProject(folder = '') {
    const projects = window.criprox?.projects;
    if (!projects) {
      await exportProjectBackup();
      return;
    }
    setLibraryBusy(true);
    try {
      const result = await saveManagedProject(projects, activeProjectId, project, folder);
      rememberActiveProject(result.project.id);
      setProjectLibrary(result.snapshot);
      setToast('Project saved to your CriProx projects folder.');
    } catch (error) {
      setToast(errorText(error));
    } finally {
      setLibraryBusy(false);
    }
  }
  async function openManagedProject(projectId: string) {
    const projects = window.criprox?.projects;
    if (!projects) return;
    setLibraryBusy(true);
    try {
      const next = validateProject(await loadManagedProject(projects, projectId));
      if (project.entries.length) await recordRecent(project, 'cards');
      resetProject(next);
      rememberActiveProject(projectId);
      setRecentId('cards');
      setPage(0);
      setSelected(null);
      setInspecting(null);
      setModal(null);
      chooseWorkspace('cards');
      setToast('Project opened.');
    } catch (error) {
      setToast(errorText(error));
    } finally {
      setLibraryBusy(false);
    }
  }
  async function deleteManagedProject(item: ProjectSummary) {
    const projects = window.criprox?.projects;
    if (!projects) return;
    setLibraryBusy(true);
    try {
      const snapshot = await projects.delete(item.id);
      setProjectLibrary(snapshot);
      const wasCurrent = item.id === activeProjectId;
      if (wasCurrent) rememberActiveProject(null);
      setToast(
        wasCurrent
          ? `“${item.name}” moved to Trash. Your open workspace is now a local draft.`
          : `“${item.name}” moved to Trash.`,
      );
    } catch (error) {
      setToast(errorText(error));
    } finally {
      setLibraryBusy(false);
    }
  }
  async function createProjectFolder(parent: string, name: string) {
    const projects = window.criprox?.projects;
    if (!projects) throw new Error('Project folders are unavailable.');
    setLibraryBusy(true);
    try {
      const result = await projects.createFolder(parent, name);
      setProjectLibrary(result.snapshot);
      return result.folder;
    } finally {
      setLibraryBusy(false);
    }
  }
  async function deleteProjectFolder(folder: string) {
    const projects = window.criprox?.projects;
    if (!projects) throw new Error('Project folders are unavailable.');
    setLibraryBusy(true);
    try {
      setProjectLibrary(await projects.deleteFolder(folder));
      setToast(`Empty folder “${folder.split('/').pop()}” deleted.`);
    } finally {
      setLibraryBusy(false);
    }
  }
  async function moveManagedProject(projectId: string, folder: string) {
    const projects = window.criprox?.projects;
    if (!projects) throw new Error('Project folders are unavailable.');
    setLibraryBusy(true);
    try {
      const result = await projects.move(projectId, folder);
      setProjectLibrary(result.snapshot);
      if (projectId === activeProjectId) rememberActiveProject(result.project.id);
      setToast(`“${result.project.name}” moved to ${folder || 'Library'}.`);
    } finally {
      setLibraryBusy(false);
    }
  }
  async function changeProjectsDirectory() {
    const projects = window.criprox?.projects;
    if (!projects) return;
    setLibraryBusy(true);
    try {
      const snapshot = await projects.chooseDirectory();
      if (snapshot) {
        setProjectLibrary(snapshot);
        rememberActiveProject(null);
        setToast('Projects folder updated. Save this project to add it to the new folder.');
      }
    } catch (error) {
      setToast(errorText(error));
    } finally {
      setLibraryBusy(false);
    }
  }
  async function importDocumentsProjectLibrary() {
    const projects = window.criprox?.projects;
    if (!projects) return;
    setLibraryBusy(true);
    try {
      const result = await projects.importDocuments();
      setProjectLibrary(result.snapshot);
      setToast(
        result.imported
          ? `${result.imported} project${result.imported === 1 ? '' : 's'} copied from Documents. Originals were kept.`
          : 'No older projects were found in Documents/CriProx.',
      );
    } catch (error) {
      setToast(errorText(error));
    } finally {
      setLibraryBusy(false);
    }
  }
  async function revealProjectsDirectory() {
    setLibraryBusy(true);
    try {
      await window.criprox?.projects?.reveal();
    } catch (error) {
      setToast(errorText(error));
    } finally {
      setLibraryBusy(false);
    }
  }
  async function openProject(file?: File) {
    if (!file) return;
    try {
      if (file.size > 100000000) throw new Error('Project files must be under 100 MB.');
      const value = JSON.parse(await file.text());
      if (value.kind === 'criprox-stickers') {
        const next = validateStickerProject(value);
        if (stickerDraft.current?.artwork.length)
          await recordRecent(stickerDraft.current, 'stickers');
        await recordRecent(next, 'stickers', `file:stickers:${file.name}:${file.lastModified}`);
        setStickerRequest((r) => ({ sequence: (r?.sequence ?? 0) + 1, project: next }));
        chooseWorkspace('stickers');
        return;
      }
      const next = validateProject(value);
      if (project.entries.length) await recordRecent(project, 'cards');
      await recordRecent(next, 'cards', `file:cards:${file.name}:${file.lastModified}`);
      resetProject(next);
      rememberActiveProject(null);
      setPage(0);
      setSelected(null);
      setInspecting(null);
      chooseWorkspace('cards');
      setToast('Project opened.');
    } catch (e) {
      setToast(errorText(e));
    } finally {
      if (projectInput.current) projectInput.current.value = '';
      if (homeInput.current) homeInput.current.value = '';
    }
  }
  const snoozedUpdate =
    updateState.update &&
    reminder?.version === updateState.update.latestVersion &&
    reminder.until > reminderClock
      ? updateState.update
      : null;
  const releaseUpdate = snoozedUpdate ? null : updateState.update;
  function reviewUpdate() {
    setSettingsPage('Updates');
    setModal('settings');
  }
  function dismissRelease() {
    if (!releaseUpdate) return;
    const next = { version: releaseUpdate.latestVersion, until: Date.now() + 24 * 60 * 60 * 1000 };
    localStorage.setItem('criprox-release-reminder', JSON.stringify(next));
    setReminder(next);
  }
  async function updateAction(action: 'checkNow' | 'download' | 'cancel' | 'viewRelease') {
    const releases = window.criprox?.releases;
    if (!releases) return;
    try {
      if (action === 'viewRelease') {
        if (updateState.update) await releases.open(updateState.update.releaseUrl);
      } else setUpdateState(await releases[action]());
    } catch {
      setToast('Could not complete the update action. Try again.');
    }
  }
  async function openUpdateInstaller() {
    if (updateOpening || libraryBusy || !loaded) return;
    setUpdateOpening(true);
    try {
      // A previous autosave failure must not prevent retrying the current workspace save.
      await saveQueue.current.catch(() => {});
      await set('criprox-project', project);
      await window.criprox?.releases?.openInstaller().then(setUpdateState);
    } catch {
      setToast('Could not save the workspace or open the installer. Save your work and try again.');
    } finally {
      setUpdateOpening(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <WindowControls />
        <a
          className="brand"
          href="#"
          aria-label="CriProx Home"
          onClick={(event) => {
            event.preventDefault();
            void showHome();
          }}
        >
          <span className="brand-icon">
            <Layers3 size={22} />
          </span>
          <span>
            Cri<span className="brand-accent">Prox</span>
            <small>SHEET STUDIO</small>
          </span>
        </a>
        <label className="workspace-switch">
          Workspace
          <select
            aria-label="Workspace"
            value={workspace}
            onChange={(e) => {
              if (e.target.value === 'home') void showHome();
              else chooseWorkspace(e.target.value as WorkspaceId);
            }}
          >
            <option value="home">Home</option>
            {WORKSPACES.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.name}
              </option>
            ))}
          </select>
        </label>
        <div className="workspace-title" hidden={workspace !== 'cards'}>
          <button
            className="breadcrumb"
            onClick={() =>
              window.criprox?.projects ? setModal('projects') : projectInput.current?.click()
            }
          >
            {window.criprox?.projects ? 'Projects' : 'Workspace'} <ChevronRight size={12} />
          </button>
          <input
            aria-label="Project name"
            maxLength={100}
            value={project.name}
            onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))}
          />
          <span className="local-badge">{activeProjectId ? 'SAVED PROJECT' : 'LOCAL DRAFT'}</span>
        </div>
        <div
          className="workspace-title"
          hidden={workspace !== 'stickers'}
          ref={setStickerTitleHost}
        />
        <div className="top-actions">
          <button
            className="secondary compact"
            hidden={workspace === 'home'}
            disabled={!loaded}
            onClick={() =>
              workspace === 'stickers'
                ? setStickerPrintRequest((v) => v + 1)
                : setModal('print-cut')
            }
          >
            <Scissors size={16} />
            Print then cut
          </button>
          <button
            className="primary compact print-action"
            hidden={workspace !== 'cards'}
            disabled={!loaded}
            onClick={() => setModal('registered')}
          >
            <Download size={16} />
            <span className="print-action-long">
              {project.settings.profile === 'nine' ? 'Create manual cut' : 'Create print PDF'}
            </span>
            <span className="print-action-short">
              {project.settings.profile === 'nine' ? '9-cut' : 'PDF'}
            </span>
          </button>
          <button
            className="icon-button top-help-action"
            title="Help and video tutorials"
            aria-label="Help and video tutorials"
            onClick={() => setModal('guide')}
          >
            <CircleHelp size={18} />
          </button>
          <button
            className="icon-button theme-toggle"
            title={`Use ${colorTheme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label={`Use ${colorTheme === 'dark' ? 'light' : 'dark'} mode`}
            aria-pressed={colorTheme === 'dark'}
            onClick={() => setColorTheme((theme) => (theme === 'dark' ? 'light' : 'dark'))}
          >
            {colorTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {(window.criprox?.projects || window.criprox?.ai) && (
            <button
              className="icon-button"
              title="Settings"
              aria-label="Settings"
              disabled={!loaded}
              onClick={() => {
                setSettingsPage('New project defaults');
                setModal('settings');
              }}
            >
              <Settings2 size={18} />
            </button>
          )}
          <div
            className="card-file-actions"
            hidden={workspace !== 'stickers'}
            ref={setStickerActionsHost}
          />
          <div className="card-file-actions" hidden={workspace !== 'cards'}>
            <span className="top-action-divider" />
            <button
              className="icon-button"
              title="New project"
              aria-label="New project"
              disabled={!loaded}
              onClick={() => setModal('new')}
            >
              <FilePlus2 size={18} />
            </button>
            <button
              className="secondary compact"
              disabled={!loaded}
              onClick={() =>
                window.criprox?.projects ? setModal('projects') : projectInput.current?.click()
              }
            >
              <FolderOpen size={16} /> {window.criprox?.projects ? 'Projects' : 'Open'}
            </button>
            <button
              className="secondary compact"
              disabled={!loaded || libraryBusy}
              onClick={() => void saveCurrentProject()}
            >
              {libraryBusy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
              {activeProjectId ? 'Save' : 'Save project'}
            </button>
          </div>
        </div>
      </header>
      {releaseUpdate && (
        <aside className="release-notice" role="status" aria-live="polite">
          <span className="release-notice-icon">
            <Download size={19} />
          </span>
          <div>
            <strong>CriProx {releaseUpdate.latestVersion} is available</strong>
            <span>
              {updateState.status === 'ready'
                ? 'Your verified download is ready to install.'
                : updateState.status === 'downloading' || updateState.status === 'verifying'
                  ? 'Your update is downloading. You can keep working.'
                  : `You’re using ${releaseUpdate.currentVersion}. Review and download the update.`}
            </span>
          </div>
          <button className="primary compact" onClick={reviewUpdate}>
            Review update <Download size={13} />
          </button>
          <button className="text-button compact" onClick={dismissRelease}>
            Remind me later
          </button>
        </aside>
      )}
      {workspace === 'home' && (
        <HomeScreen
          busy={!loaded || homeBusy || libraryBusy}
          drafts={[
            projectSummary(project, 'cards'),
            ...(stickerDraftSummary ? [stickerDraftSummary] : []),
          ]}
          recent={[
            ...recentProjects.map((p) => ({ ...p, source: 'cache' as const })),
            ...(projectLibrary?.projects ?? []).map((p) => ({
              id: p.id,
              workspace: 'cards' as const,
              name: p.name,
              count: p.cardCount,
              updatedAt: p.updatedAt,
              source: 'library' as const,
            })),
          ]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 12)}
          choose={chooseWorkspace}
          create={(id) => void newWorkspace(id)}
          open={() => homeInput.current?.click()}
          openRecent={(item) => void openHomeRecent(item)}
          browse={window.criprox?.projects ? () => setModal('projects') : undefined}
        />
      )}
      <div className="app-body" hidden={workspace !== 'cards'}>
        <main>
          <WorkspaceGrid>
            <WorkspacePanel kind="library">
              <WorkspacePanelHeading
                title="Your cards"
                badge={count}
                actions={
                  <div className="library-heading-actions">
                    <button
                      className="text-button clear-deck"
                      disabled={!loaded || !count}
                      onClick={() => setModal('clear')}
                    >
                      <Trash2 size={13} /> Clear
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Find a card"
                      disabled={!loaded || count >= 500}
                      onClick={() => setModal('search')}
                    >
                      <Plus size={19} />
                    </button>
                  </div>
                }
              />
              <div className="library-controls">
                <button
                  className="primary find-card-button"
                  disabled={!loaded || count >= 500}
                  onClick={() => setModal('search')}
                >
                  <Search size={16} /> Find a card
                </button>
                <button
                  className="secondary import-button"
                  disabled={!loaded}
                  onClick={() => setModal('import')}
                >
                  <Upload size={16} /> Import deck
                </button>
                <button
                  className="secondary artwork-button"
                  disabled={uploading || !loaded}
                  onClick={() => imageInput.current?.click()}
                >
                  {uploading ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <ImagePlus size={16} />
                  )}{' '}
                  Add artwork
                </button>
                <div className="search-field">
                  <Search size={15} />
                  <input
                    aria-label="Search your cards"
                    placeholder="Find a card in your deck…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="list-caption">
                <span>CARD / PRINTING</span>
                <span>QTY</span>
              </div>
              <div className="card-list">
                {filtered.map((entry) => (
                  <div
                    key={entry.id}
                    className={`library-card ${selected?.entryId === entry.id ? 'selected' : ''}`}
                  >
                    <button
                      className="card-select"
                      onClick={() => inspect({ entryId: entry.id, copy: 0 })}
                      aria-label={`Inspect ${entry.card.name}`}
                    >
                      <span className="card-select-image">
                        <img
                          className={
                            usesMpcTrim(entry.card.faces[entry.face]) ? 'mpc-source-art' : undefined
                          }
                          src={entry.card.faces[entry.face].preview}
                          alt=""
                        />
                      </span>
                      <div>
                        <strong>{entry.card.name}</strong>
                        <span>
                          {entry.card.set.toUpperCase()}
                          {entry.card.collector && ` · #${entry.card.collector}`}
                        </span>
                      </div>
                    </button>
                    <div className="card-bottom">
                      <button
                        className="printing-button"
                        onClick={() => inspect({ entryId: entry.id, copy: 0 })}
                      >
                        {entry.card.oracleId ? 'Change artwork' : 'Local artwork'}{' '}
                        <ChevronDown size={12} />
                      </button>
                      <div className="quantity">
                        <button
                          aria-label={`Decrease ${entry.card.name}`}
                          disabled={entry.quantity <= 1}
                          onClick={() => quantity(entry, -1)}
                        >
                          <Minus size={11} />
                        </button>
                        <span>{entry.quantity}</span>
                        <button
                          aria-label={`Increase ${entry.card.name}`}
                          disabled={entry.quantity >= 100}
                          onClick={() => quantity(entry, 1)}
                        >
                          <Plus size={11} />
                        </button>
                      </div>
                    </div>
                    <button
                      className="remove-card"
                      aria-label={`Remove ${entry.card.name}`}
                      onClick={() =>
                        setProject((p) => ({
                          ...p,
                          entries: p.entries.filter((e) => e.id !== entry.id),
                        }))
                      }
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {!filtered.length && (
                  <div className="empty-library">
                    <Layers3 size={28} />
                    <strong>{search ? 'No matching cards' : 'A fresh start'}</strong>
                    <p>
                      {search
                        ? 'Try another card name.'
                        : 'Paste your deck or upload card images to begin.'}
                    </p>
                    {!search && (
                      <button
                        className="text-button"
                        onClick={() => {
                          resetProject(createSample());
                          setPage(0);
                        }}
                      >
                        Load example cards
                      </button>
                    )}
                  </div>
                )}
              </div>
              {activeEntry && selected && (
                <div className="selection-details">
                  <div className="section-label">SELECTED CARD</div>
                  <strong>{activeEntry.card.name}</strong>
                  <p>{activeEntry.card.setName}</p>
                  {activeEntry.card.faces[activeEntry.face].design && (
                    <button
                      className="secondary"
                      onClick={() =>
                        setCardDesigner({
                          target: selected,
                          name: activeEntry.card.name,
                          design: structuredClone(activeEntry.card.faces[activeEntry.face].design!),
                        })
                      }
                    >
                      Edit card design
                    </button>
                  )}
                  {activeEntry.card.faces.length > 1 && (
                    <>
                      <label>
                        Card face
                        <select
                          aria-label="Card face"
                          value={activeEntry.face}
                          onChange={(e) => editCopy(selected, { face: Number(e.target.value) })}
                        >
                          {activeEntry.card.faces.map((face, i) => (
                            <option key={i} value={i}>
                              {face.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="warning-box double-sided-warning" role="status">
                        Double-sided card.{' '}
                        {project.settings.backsEnabled
                          ? `${activeEntry.card.faces[activeEntry.face === 0 ? 1 : 0].name} is set as its reverse.`
                          : 'Turn on Print card backs to print its reverse face.'}
                      </div>
                    </>
                  )}
                  <button
                    className="text-button"
                    disabled={count >= 500}
                    onClick={() => add([{ ...activeEntry, id: crypto.randomUUID(), quantity: 1 }])}
                  >
                    <Copy size={13} /> Duplicate as separate entry
                  </button>
                </div>
              )}
              <div className="library-footer">
                <ShieldCheck size={15} />
                <span>Your project stays on this device.</span>
              </div>
            </WorkspacePanel>
            <WorkspacePanel kind="preview-panel">
              <div className="preview-toolbar">
                {project.settings.machine !== 'manual' && project.settings.profile !== 'nine' ? (
                  <div className="segmented" aria-label="Preview mode">
                    <button className="selected" type="button">
                      <Layers3 size={14} /> Print sheet
                    </button>
                  </div>
                ) : (
                  <div className="segmented" aria-label="Preview mode">
                    <button
                      className={mode === 'art' ? 'selected' : ''}
                      onClick={() => setMode('art')}
                    >
                      <Layers3 size={14} /> Artwork
                    </button>
                    <button
                      className={mode === 'cuts' ? 'selected' : ''}
                      onClick={() => setMode('cuts')}
                    >
                      <Scissors size={14} />{' '}
                      {project.settings.machine === 'manual' ? 'Cut guides' : 'Cut paths'}
                    </button>
                  </div>
                )}
                <ZoomControl value={zoom} onChange={(value) => changeZoom(() => value)} />
                <button
                  className="secondary compact"
                  aria-pressed={showCardCuts}
                  onClick={() => setShowCardCuts((value) => !value)}
                >
                  Show cuts
                </button>
              </div>
              <div
                className="preview-canvas"
                onDragEnter={artworkDragEnter}
                onDragOver={artworkDragOver}
                onDragLeave={artworkDragLeave}
                onDrop={artworkDrop}
              >
                {draggingArtwork && (
                  <div className="artwork-drop-overlay" aria-hidden="true">
                    <ImagePlus size={32} />
                    <strong>Drop artwork to add it</strong>
                    <span>PNG, JPG, or WebP · up to 20 MB each</span>
                  </div>
                )}
                <div className="sheet-label">
                  <span className="status-dot" />{' '}
                  {count
                    ? `${sheet.placements.length} cards on this sheet`
                    : 'Your canvas is ready'}
                  <span className="view-label">PREVIEW ONLY</span>
                </div>
                <div
                  className="paper-viewport"
                  ref={paperViewport}
                  title="Scroll to zoom · Drag to pan · Right-click a card for actions"
                >
                  <SheetPreview
                    legendHost={guideLegendHost}
                    sheet={sheet}
                    settings={project.settings}
                    mode={mode}
                    showCuts={showCardCuts}
                    zoom={zoom}
                    registrationRefresh={registrationRefresh}
                    select={setSelected}
                    inspect={inspect}
                  />
                </div>
                <div className="card-guide-legend" ref={setGuideLegendHost} />
                <SheetNavigation
                  index={currentPage}
                  count={count ? sheets.length : 0}
                  onChange={setPage}
                />
              </div>
              <div className="preview-footer">
                <span>
                  <span className="legend-line" /> Planning area
                </span>
                <span>
                  <Ruler size={14} />{' '}
                  {formatDimensions(
                    project.settings.width,
                    project.settings.height,
                    project.settings.units,
                  )}{' '}
                  cards
                </span>
                <span>{project.settings.dpi} DPI print</span>
              </div>
            </WorkspacePanel>
            <WorkspacePanel kind="settings-panel">
              <WorkspacePanelHeading
                title="Sheet setup"
                icon={<SlidersHorizontal size={17} />}
                actions={
                  <button
                    className="icon-button"
                    aria-label="Reset sheet settings to project defaults"
                    title="Reset sheet settings to project defaults"
                    onClick={loadSheetSettingsDefaults}
                  >
                    <RotateCcw size={15} />
                  </button>
                }
              />
              <div className="settings-content">
                <MachineSelect
                  id="machine"
                  value={project.settings.machine}
                  onChange={(machine) => {
                    settings({
                      machine,
                      ...(machine === 'manual'
                        ? {
                            profile: 'nine' as const,
                            width: 63,
                            height: 88,
                            gap: 1,
                            radius: STANDARD_CARD_RADIUS_MM,
                            bleed: project.settings.bleed > 0 ? 0.5 : 0,
                            manualCutCorrectionX: 0,
                            manualCutCorrectionY: 0,
                          }
                        : {}),
                      ...((project.settings.profile === 'seven' ||
                        project.settings.profile === 'eight') &&
                      machine === 'joy-xtra'
                        ? {
                            profile: 'expanded' as const,
                            gap: 1,
                            bleed:
                              project.settings.bleed > 0
                                ? fixedBleedMm({ profile: 'expanded' })
                                : 0,
                          }
                        : {}),
                    });
                  }}
                />
                <PaperOptions
                  value={project.settings.paper}
                  units={project.settings.units}
                  onChange={(paper) =>
                    settings({
                      paper,
                      ...(paper === 'a4' && project.settings.profile === 'seven'
                        ? {
                            profile: 'expanded' as const,
                            gap: 1,
                            bleed:
                              project.settings.bleed > 0
                                ? fixedBleedMm({ profile: 'expanded' })
                                : 0,
                          }
                        : {}),
                    })
                  }
                />
                <div className="setting-group unit-setting">
                  <label>Display units</label>
                  <UnitToggle
                    value={project.settings.units}
                    change={(units) => settings({ units })}
                  />
                  <p className="field-note">Changes labels only. Cut geometry stays exact.</p>
                </div>
                {project.settings.machine !== 'manual' && (
                  <CutSettingsControls value={project.settings} onChange={settings} />
                )}
                <div className="settings-divider" />
                <div className="section-label">
                  <Grid2X2 size={14} /> LAYOUT & DIMENSIONS
                </div>
                <div className="setting-group">
                  <label htmlFor="profile">
                    Sheet area <span className="mini-badge">{g.capacity} UP</span>
                  </label>
                  <select
                    id="profile"
                    value={project.settings.profile}
                    onChange={(e) => {
                      const profile = e.target.value as Settings['profile'];
                      settings(
                        profile === 'seven' || profile === 'eight'
                          ? {
                              profile,
                              width: 63,
                              height: 88,
                              gap: profile === 'eight' ? 1 : 0.1,
                              radius: STANDARD_CARD_RADIUS_MM,
                              bleed: project.settings.bleed > 0 ? fixedBleedMm({ profile }) : 0,
                            }
                          : profile === 'nine'
                            ? {
                                profile,
                                width: 63,
                                height: 88,
                                gap: 1,
                                radius: STANDARD_CARD_RADIUS_MM,
                                bleed: project.settings.bleed > 0 ? fixedBleedMm({ profile }) : 0,
                              }
                            : {
                                profile,
                                ...(project.settings.profile === 'seven' ||
                                project.settings.profile === 'eight'
                                  ? {
                                      gap: 1,
                                      bleed:
                                        project.settings.bleed > 0
                                          ? fixedBleedMm({ profile: 'expanded' })
                                          : 0,
                                    }
                                  : {}),
                              },
                      );
                      setPage(0);
                    }}
                  >
                    {availableSheetProfiles(project.settings).map((profile) => (
                      <option key={profile} value={profile}>
                        {profile === 'expanded'
                          ? '6 cards · Print and Cut'
                          : profile === 'seven'
                            ? '7 cards · Print and Cut · Experimental'
                            : profile === 'eight'
                              ? '8 cards · Print and Cut · Experimental'
                              : `9 cards · ${project.settings.machine === 'manual' ? 'Manual cutting' : 'Manual Alignment · Experimental'}`}
                      </option>
                    ))}
                  </select>
                  <p className="field-note">
                    {project.settings.profile === 'seven'
                      ? `${formatDimensions(189.2, 214.2, project.settings.units)} 2–3–2 layout. Choose Tabloid in Design Space, then US Letter at 100% in the system print dialog.`
                      : project.settings.profile === 'eight'
                        ? `${formatDimensions(177, 255, project.settings.units)} 2×4 landscape-card layout with 1 mm gaps. Capture a portrait Tabloid PDF; CriProx reframes its marks onto ${paperWorkflow(project.settings).outputPaper} at 100% / Actual size.`
                        : project.settings.profile === 'nine'
                          ? project.settings.machine === 'manual'
                            ? `${formatDimensions(191, 266, project.settings.units)} 3×3 layout. Set cut guides below, then print the PDF at 100%.`
                            : `${formatDimensions(191, 266, project.settings.units)} 3×3 layout. Print the PDF at 100%, then use the matched Basic Cut PNG with manual mat placement.`
                          : `${formatDimensions(180, 220, project.settings.units)} candidate area. Choose Tabloid (11 × 17 in) in Design Space, then ${paperWorkflow(project.settings).systemPaper} at 100% / Actual size in the system print dialog.`}
                  </p>
                </div>
                {project.settings.machine === 'manual' && (
                  <ManualGuideControls settings={project.settings} change={settings} />
                )}
                <div className="settings-divider" />
                <div className="section-label">
                  <Settings2 size={14} /> PRINT DETAILS
                </div>
                <div className="setting-group">
                  <label htmlFor="resolution">Resolution</label>
                  <select
                    id="resolution"
                    value={project.settings.dpi}
                    onChange={(e) => settings({ dpi: Number(e.target.value) as PrintDpi })}
                  >
                    {PRINT_DPI_OPTIONS.map((dpi) => (
                      <option key={dpi} value={dpi}>
                        {dpi} DPI ·{' '}
                        {dpi === 300
                          ? 'standard'
                          : dpi === 600
                            ? 'high quality'
                            : dpi === 900
                              ? 'extra high'
                              : 'maximum detail'}
                      </option>
                    ))}
                  </select>
                  <p className="field-note">
                    Higher settings preserve more detail from high-resolution artwork. 900 and 1200
                    DPI take longer and create much larger print files.
                  </p>
                </div>
                <FrontBleedControl settings={project.settings} change={settings} />
                <label className="switch-row">
                  <span>
                    Print card backs
                    <small>Optional · manual refeed by default</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={project.settings.backsEnabled}
                    onChange={(e) => settings({ backsEnabled: e.target.checked })}
                  />
                  <span className="switch" />
                </label>
                {doubleSidedCount > 0 && (
                  <div className="warning-box double-sided-warning" role="status">
                    {doubleSidedCount} double-sided card{doubleSidedCount === 1 ? '' : 's'}{' '}
                    selected.{' '}
                    {project.settings.backsEnabled
                      ? 'Each matching reverse face will print in its mirrored back position; shared artwork remains for single-sided cards.'
                      : 'Enable Print card backs to include the matching reverse faces.'}
                  </div>
                )}
                {project.settings.backsEnabled && (
                  <button
                    className="text-button back-configure"
                    onClick={() => setModal('registered')}
                  >
                    {sharedBackRequired && !project.backArtwork
                      ? 'Add shared card-back artwork'
                      : 'Configure back printing'}{' '}
                    <ArrowRight size={12} />
                  </button>
                )}
                <label className="switch-row">
                  <span>
                    Playtest label<small>A small label along the bottom edge</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={project.settings.proxyLabel}
                    onChange={(e) => settings({ proxyLabel: e.target.checked })}
                  />
                  <span className="switch" />
                </label>
                <div className="sheet-save-defaults">
                  <div className="sheet-default-actions">
                    <button
                      className="secondary compact"
                      type="button"
                      disabled={
                        savingSheetDefaults ||
                        sheetSettingsMatch(project.settings, projectDefaults.settings)
                      }
                      onClick={() => void saveSheetSettingsAsDefaults()}
                    >
                      <Save size={14} />
                      {savingSheetDefaults ? 'Saving…' : 'Save sheet setup defaults'}
                    </button>
                    <button
                      className="secondary compact"
                      type="button"
                      disabled={
                        savingSheetDefaults ||
                        sheetSettingsMatch(project.settings, projectDefaults.settings)
                      }
                      onClick={loadSheetSettingsDefaults}
                    >
                      <RotateCcw size={14} /> Load sheet setup defaults
                    </button>
                  </div>
                  <p className="field-note">
                    {sheetSettingsMatch(project.settings, projectDefaults.settings)
                      ? 'Sheet setup already matches the saved defaults.'
                      : 'Save all sheet setup options for new projects, or load your saved setup here.'}
                  </p>
                </div>
              </div>
            </WorkspacePanel>
          </WorkspaceGrid>
          <div className="bottom-status">
            <span>
              <Check size={14} />
              {saved}
            </span>
            <span className="status-summary">
              {count} cards <i /> {sheets.length} sheets <i /> {g.capacity} cards per full sheet
              {sheet && (
                <>
                  <i />
                  <span className="dimension-summary">
                    <span>Current artwork area:</span>
                    <strong>
                      {formatDimensions(sheet.width, sheet.height, project.settings.units)}
                    </strong>
                    <span className="dimension-hint">
                      Display units do not change the printed size.
                    </span>
                  </span>
                </>
              )}
            </span>
            <span className="app-credit">
              <span className="app-credit-copy">
                CriProx v{__APP_VERSION__} · Made for playtesting{' '}
              </span>
              <span className="little-spark">✧</span>
              {snoozedUpdate && (
                <button
                  className="footer-update-reminder"
                  aria-label={`Review CriProx ${snoozedUpdate.latestVersion} update`}
                  title={`CriProx ${snoozedUpdate.latestVersion} is available. Review update.`}
                  onClick={reviewUpdate}
                >
                  <Download size={13} />
                  {updateState.status === 'ready' ? 'Update ready' : 'Update available'}
                </button>
              )}
              <DonationLink />
            </span>
          </div>
        </main>
      </div>
      <StickerStudio
        open={workspace === 'stickers'}
        printRequest={stickerPrintRequest}
        titleHost={stickerTitleHost}
        actionsHost={stickerActionsHost}
        request={stickerRequest}
        onDraft={updateStickerDraft}
        onRemember={recordStickerRecent}
        onAiOpen={() => {
          setModal(null);
          setWorkspace('stickers');
        }}
      />
      {cardDesigner && (
        <Modal
          title="Edit custom card design"
          close={() => setCardDesigner(undefined)}
          wide
          className="card-design-modal"
        >
          <div className="card-design-editor">
            <StickerDesigner
              initial={cardDesigner.design}
              name={cardDesigner.name}
              active
              cutRadius={project.settings.radius}
              saveLabel="Save card design"
              fixedCanvas
              onClose={() => setCardDesigner(undefined)}
              onSave={(name, design, image) => {
                const entry = project.entries.find((e) => e.id === cardDesigner.target.entryId);
                if (entry)
                  editCopy(cardDesigner.target, {
                    card: {
                      ...entry.card,
                      name,
                      faces: entry.card.faces.map((face, i) =>
                        i === entry.face
                          ? {
                              name,
                              image,
                              preview: image,
                              design: { ...design, cropToCuts: false },
                            }
                          : face,
                      ),
                    },
                  });
                setCardDesigner(undefined);
              }}
            />
          </div>
        </Modal>
      )}
      <input
        hidden
        ref={homeInput}
        type="file"
        accept=".json,.criprox.json"
        onChange={(event) => void openProject(event.target.files?.[0])}
      />
      <input
        hidden
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(e) => uploadImages(e.target.files)}
      />
      <input
        hidden
        ref={projectInput}
        type="file"
        accept=".json"
        onChange={(e) => openProject(e.target.files?.[0])}
      />
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {modal === 'projects' && window.criprox?.projects && (
        <ProjectsModal
          snapshot={projectLibrary}
          activeProjectId={activeProjectId}
          busy={libraryBusy}
          close={() => setModal(null)}
          refresh={() => void refreshProjectLibrary()}
          reveal={() => void revealProjectsDirectory()}
          open={(projectId) => void openManagedProject(projectId)}
          remove={(item) => void deleteManagedProject(item)}
          saveCurrent={(folder) => void saveCurrentProject(folder)}
          createFolder={createProjectFolder}
          deleteFolder={deleteProjectFolder}
          move={moveManagedProject}
          importBackup={() => {
            setModal(null);
            projectInput.current?.click();
          }}
          exportBackup={() => void exportProjectBackup()}
          newProject={() => setModal('new')}
        />
      )}
      {modal === 'settings' && (window.criprox?.projects || window.criprox?.ai) && (
        <SettingsModal
          initialPage={settingsPage}
          updateState={updateState}
          updateAction={(action) => void updateAction(action)}
          openInstaller={() => void openUpdateInstaller()}
          installBusy={updateOpening || libraryBusy || !loaded}
          defaults={projectDefaults}
          project={project}
          snapshot={projectLibrary}
          busy={libraryBusy}
          colorTheme={colorTheme}
          close={() => setModal(null)}
          changeTheme={setColorTheme}
          saveDefaults={saveEditedProjectDefaults}
          readArtwork={async (file) => (await cardFromArtwork(file)).faces[0]}
          changeDirectory={() => void changeProjectsDirectory()}
          importDocuments={() => void importDocumentsProjectLibrary()}
          reveal={() => void revealProjectsDirectory()}
        />
      )}

      {modal === 'print-cut' && (
        <Modal title="Print then cut" close={() => setModal(null)} wide className="print-cut-modal">
          <PrintCutWorkflow
            kind="cards"
            generatedInput={{ kind: 'cards', project }}
            cutSettings={project.settings}
            onCutSettingsChange={settings}
            generated={project.settings.profile !== 'nine'}
            machine={project.settings.machine}
            count={count}
            paper={project.settings.paper}
            registered={
              project.settings.machine !== 'manual' && project.settings.profile !== 'nine'
            }
            jobKey={JSON.stringify([
              project.settings,
              project.entries.map((e) => [e.id, e.quantity, e.face]),
            ])}
            prepareLabel="Prepare card print PDF"
            onPrepare={() => {
              setReturnToPrintCut(true);
              setModal('registered');
            }}
          />
        </Modal>
      )}
      {modal === 'registered' && (
        <RegisteredPrint
          project={project}
          close={() => {
            setModal(returnToPrintCut ? 'print-cut' : null);
            setReturnToPrintCut(false);
            setRegistrationRefresh((value) => value + 1);
          }}
          onCapture={() => setRegistrationRefresh((value) => value + 1)}
          openGuide={() => setModal('guide')}
          notify={setToast}
          updateSettings={settings}
          updateBackArtwork={uploadBackArtwork}
          selectBackArtwork={chooseBackArtwork}
          updateBackTrim={changeBackArtworkTrim}
        />
      )}
      {modal === 'import' && (
        <ImportModal close={() => setModal(null)} add={add} remaining={500 - count} />
      )}
      {modal === 'search' && (
        <CardSearchModal
          close={() => setModal(null)}
          add={addCard}
          addEntries={add}
          remaining={500 - count}
        />
      )}
      {modal === 'guide' && <Guide close={() => setModal(null)} />}
      {ENABLE_DESIGN_SPACE_EXPORT && modal === 'export' && count > 0 && (
        <ExportModal
          project={project}
          sheets={sheets}
          current={currentPage}
          close={() => setModal(null)}
          notify={setToast}
        />
      )}
      {modal === 'new' && (
        <Modal
          title="Start a fresh project?"
          subtitle="Save the current project first if you want to keep this deck. Your new-project defaults will be applied."
          close={() => setModal(null)}
        >
          <div className="modal-footer">
            <button className="secondary" onClick={() => setModal(null)}>
              <ArrowLeft size={16} /> Keep editing
            </button>
            <button className="primary" onClick={startFreshProject}>
              <FilePlus2 size={16} /> Start fresh
            </button>
          </div>
        </Modal>
      )}
      {modal === 'clear' && (
        <Modal
          title="Clear the deck list?"
          subtitle={`Remove all ${count} card${count === 1 ? '' : 's'} from this project.`}
          close={() => setModal(null)}
        >
          <div className="confirm-copy">
            Your sheet dimensions, print settings, captured Cricut template, and card-back setup
            will stay in place.
          </div>
          <div className="modal-footer">
            <button className="secondary" onClick={() => setModal(null)}>
              Keep cards
            </button>
            <button
              className="danger-button"
              onClick={() => {
                setProject((current) => ({ ...current, entries: [] }));
                setSelected(null);
                setInspecting(null);
                setPage(0);
                setSearch('');
                setModal(null);
                setToast('Deck list cleared.');
              }}
            >
              <Trash2 size={16} /> Clear deck
            </button>
          </div>
        </Modal>
      )}
      {cardMenu && menuEntry && loaded && (
        <SheetCardMenu
          menu={cardMenu}
          name={menuEntry.card.name}
          duplicateDisabled={count >= 500}
          fillDisabled={emptySlots === 0 || count + emptySlots > 500}
          fillHint={fillHint}
          close={closeCardMenu}
          inspect={() => inspect(cardMenu.target)}
          copy={(action) => copyOnSheet(cardMenu.target, action)}
          remove={() => setDeletingCard(cardMenu)}
        />
      )}
      {deletingCard && deletingEntry && (
        <Modal
          title="Delete this card?"
          subtitle={`Are you sure you want to delete one copy of ${deletingEntry.card.name}?`}
          close={cancelDeleteCard}
          initialFocus={deleteCardCancel}
        >
          <div className="confirm-copy">
            Only this copy will be removed. Any other copies will stay in your project.
          </div>
          <div className="modal-footer">
            <button ref={deleteCardCancel} className="secondary" onClick={cancelDeleteCard}>
              Cancel
            </button>
            <button className="danger-button" onClick={confirmDeleteCard}>
              <Trash2 size={16} /> Delete card
            </button>
          </div>
        </Modal>
      )}
      {inspectedEntry && inspecting && (
        <ArtworkInspector
          entry={inspectedEntry}
          copy={inspecting.copy}
          customArt={customArt}
          proxyLabel={project.settings.proxyLabel}
          backsEnabled={project.settings.backsEnabled}
          close={() => setInspecting(null)}
          choosePrinting={(card) => {
            editCopy(inspecting, { card, face: 0 });
            setToast('Scryfall printing applied to one copy.');
          }}
          chooseCustomArt={(card) => {
            applyArtwork(inspecting, inspectedEntry, card);
            setToast('Custom artwork applied to one copy.');
          }}
          uploadCustomArt={async (file) => {
            const artwork = await cardFromArtwork(file, inspectedEntry.card);
            applyArtwork(inspecting, inspectedEntry, artwork);
            setToast(
              usesMpcTrim(artwork.faces[0])
                ? 'Custom artwork applied. MPC-style print bleed was detected; review the toggle if needed.'
                : 'Custom artwork applied to one copy.',
            );
          }}
          chooseMpcArt={(card) => {
            applyArtwork(inspecting, inspectedEntry, card);
            setToast('MPC Autofill artwork applied to one copy.');
          }}
          changeFace={(face) => editCopy(inspecting, { face })}
          changeArtworkTrim={(enabled) => {
            const faces = inspectedEntry.card.faces.map((face, index) =>
              index === inspectedEntry.face ? withMpcTrim(face, enabled) : face,
            );
            editCopy(inspecting, { card: { ...inspectedEntry.card, faces } });
            setToast(
              `MPC-style source bleed ${enabled ? 'enabled' : 'disabled'} for this card face.`,
            );
          }}
        />
      )}
    </div>
  );
}
