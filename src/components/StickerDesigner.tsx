import {
  alignLayers,
  layerLocked,
  layerHidden,
  snapCoordinate,
  type Alignment,
} from '../lib/design-layer-tools';
import { applyMaterialPreset, saveMaterialPreset } from '../lib/design-materials';
import {
  layerLabel,
  layerAncestors,
  selectionViewBox,
  layerHitRegions,
} from '../lib/design-workflow';
import { AppearancePanel } from './AppearancePanel';
import { renderDesignContent } from '../lib/design-render';
import {
  groupLayers,
  ungroupLayer,
  removeLayer,
  descendants,
  duplicateLayer,
} from '../lib/design-groups';
import { multiply, inverse, identity, transformPoint } from '../lib/design-appearance';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WorkspaceGrid,
  WorkspacePanel,
  WorkspacePanelHeading,
  ZoomControl,
} from './WorkspaceChrome';
import { useWorkspaceHistory } from '../lib/use-workspace-history';
import { isTextEditing, workspaceShortcut } from '../lib/workspace-history';
import {
  SHAPES,
  FONTS,
  PALETTES,
  newElement,
  elementPath,
  elementMatrix,
  parentMatrix,
  renderStickerDesign,
  validateStickerDesign,
  type StickerDesign,
  type DesignElement,
} from '../lib/sticker-design';
import { readStickerArtwork } from '../lib/sticker-output';
import './StickerDesigner.css';
import { designCutPaths, hasCustomCuts } from '../lib/sticker-cuts';
import { fitDesignCut, reorderDesignLayer, type FitCutOptions } from '../lib/sticker-fit-cut';
import { ScrubbableNumberInput } from './ScrubbableNumberInput';
import { GripVertical, Eye, EyeOff, Lock, Unlock, ChevronRight, ChevronDown } from 'lucide-react';

import type { AiEditorResolution } from '../lib/ai-design';

export type StickerDesignerController = {
  save: (request?: AiEditorResolution) => Promise<void>;
  cancel: () => void;
  busy: () => boolean;
  revision: () => string;
};

export default function StickerDesigner({
  initial,
  name: initialName,
  active,
  cutRadius,
  fitCutDefaults,
  onSave,
  onClose,
  saveLabel = 'Save design to sheet',
  fixedCanvas = false,
  onEditorController,
}: {
  initial: StickerDesign;
  name: string;
  active: boolean;
  cutRadius: number;
  fitCutDefaults?: FitCutOptions;
  onSave: (name: string, design: StickerDesign, image: string) => void;
  onClose: () => void;
  saveLabel?: string;
  fixedCanvas?: boolean;
  onEditorController?: (controller: StickerDesignerController | undefined) => void;
}) {
  const history = useWorkspaceHistory(() => initial),
    design = history.value;
  const [name, setName] = useState(initialName),
    [selected, setSelected] = useState(''),
    [groupSelection, setGroupSelection] = useState<string[]>([]),
    [tool, setTool] = useState<'select' | 'line' | 'draw' | 'polygon'>('select'),
    [operation, setOperation] = useState<'print' | 'cut'>('print'),
    [polygon, setPolygon] = useState<{ x: number; y: number }[]>([]),
    [vertex, setVertex] = useState(0),
    [palette, setPalette] = useState<keyof typeof PALETTES>('Essentials'),
    [ink, setInk] = useState('#7560cf'),
    [showCuts, setShowCuts] = useState(false),
    [zoom, setZoom] = useState(100),
    [detailZoom, setDetailZoom] = useState(100),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [space, setSpace] = useState({ width: 500, height: 500 });
  const artworkMarkup = useMemo(() => renderDesignContent(design, 'editor'), [design]);
  const [fitOptions, setFitOptions] = useState<FitCutOptions>(
    initial.fitCut ?? fitCutDefaults ?? { borderWidth: 1, strokeWidth: 0, strokeColor: '#222222' },
  );
  const [pendingFit, setPendingFit] = useState<FitCutOptions | null>(null);
  const fitting = pendingFit !== null;
  useEffect(() => {
    if (!pendingFit)
      setFitOptions(
        design.fitCut ??
          fitCutDefaults ?? { borderWidth: 1, strokeWidth: 0, strokeColor: '#222222' },
      );
  }, [design.fitCut, pendingFit, fitCutDefaults]);
  useEffect(() => {
    if (!pendingFit) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await fitDesignCut(design, pendingFit);
        if (cancelled) return;
        history.setValue(next);
        setSelected('');
        setShowCuts(true);
        setError('');
      } catch (error) {
        if (!cancelled) setError(String(error));
      } finally {
        if (!cancelled) setPendingFit(null);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pendingFit, design, history.setValue]);
  function changeFitOptions(next: FitCutOptions) {
    setFitOptions(next);
    setPendingFit(next);
  }
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const [addToolsOpen, setAddToolsOpen] = useState(true);
  useEffect(() => setAddToolsOpen(!selected), [selected]);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const visibleLayers = useMemo(() => {
    const rows: DesignElement[] = [];
    const visit = (parentId: string | null) => {
      for (const e of [...design.elements]
        .reverse()
        .filter((e) => (e.parentId || null) === parentId)) {
        rows.push(e);
        if (e.kind === 'group' && !collapsedGroups.includes(e.id)) visit(e.id);
      }
    };
    visit(null);
    return rows;
  }, [design.elements, collapsedGroups]);
  const grid = design.grid ?? { visible: false, snap: false, spacing: 2 };
  const [draggedLayer, setDraggedLayer] = useState(''),
    [dropLayer, setDropLayer] = useState('');
  const canvasWidth =
    (Math.max(
      100,
      Math.min(space.width - 60, ((space.height - 60) * design.width) / design.height),
    ) *
      zoom) /
    100;
  const handleSize = (7 * design.width) / canvasWidth;
  const svg = useRef<SVGSVGElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    clipboard = useRef<DesignElement[] | undefined>(undefined),
    curveDrag = useRef<{
      base: StickerDesign;
      element: DesignElement;
      segment: number;
      control: 'start' | 'c1' | 'c2' | 'end';
    } | null>(null),
    drag = useRef<
      | {
          start: { x: number; y: number };
          element?: DesignElement;
          mode: 'move' | 'resize' | 'line' | 'draw';
          points: { x: number; y: number }[];
          base: StickerDesign;
        }
      | undefined
    >(undefined);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      setSpace({ width: node.clientWidth, height: node.clientHeight }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const latestDesign = useRef(design);
  latestDesign.current = design;
  const element = design.elements.find((e) => e.id === selected);
  function update(next: StickerDesign) {
    try {
      history.setValue(validateStickerDesign(next));
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }
  function patch(value: Partial<DesignElement>) {
    const current = latestDesign.current;
    const target = current.elements.find((e) => e.id === selected);
    if (!target || layerLocked(current, target)) return;
    update({
      ...current,
      elements: current.elements.map((e) => (e.id === selected ? { ...e, ...value } : e)),
    });
  }
  function add(e: DesignElement) {
    setShapePickerOpen(false);
    e = { ...e, operation: e.operation || operation };
    if (design.elements.length >= 500) {
      setError('Use at most 500 elements.');
      return;
    }
    update({ ...design, elements: [...design.elements, e] });
    setSelected(e.id);
    setTool('select');
  }
  function remove() {
    const ids = groupSelection.length ? groupSelection : [selected];
    if (
      ids.some((id) => {
        const e = design.elements.find((e) => e.id === id);
        return e && layerLocked(design, e);
      })
    ) {
      setError('Unlock selected layers before deleting them.');
      return;
    }
    update(ids.reduce((d, id) => removeLayer(d, id), design));
    setGroupSelection([]);
    setSelected('');
  }
  function copy(action: 'cut' | 'copy' | 'paste') {
    if (action === 'paste') {
      if (clipboard.current) {
        const source = clipboard.current,
          ids = new Map(source.map((e) => [e.id, crypto.randomUUID()]));
        const root = source[0];
        const copies = source.map((e) => ({
          ...structuredClone(e),
          id: ids.get(e.id)!,
          parentId: ids.get(e.parentId!) ?? null,
          ...(e.id === root.id
            ? {
                x: e.x + 2,
                y: e.y + 2,
                matrix: multiply(parentMatrix(design, root), e.matrix ?? identity),
              }
            : {}),
        }));
        update({ ...design, elements: [...design.elements, ...copies] });
        setSelected(copies[0].id);
      }
      return;
    }
    if (element) {
      const ids = descendants(design, element.id);
      clipboard.current = structuredClone([
        element,
        ...design.elements.filter((e) => e.id !== element.id && ids.has(e.id)),
      ]);
      // Store the copied root in canvas coordinates, independent of its original group.
      clipboard.current[0].matrix = multiply(
        parentMatrix(design, element),
        element.matrix ?? identity,
      );
      clipboard.current[0].parentId = null;
      if (action === 'cut') remove();
    }
  }

  useEffect(() => {
    if (!active || busy) return;
    const key = (e: KeyboardEvent) => {
      const action = workspaceShortcut(e, isTextEditing(e.target));
      if (action) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'undo') history.undo();
        else if (action === 'redo') history.redo();
        else if (action === 'delete') remove();
        else copy(action);
      } else if (
        element &&
        !isTextEditing(e.target) &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
      ) {
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1;
        patch({
          x: element.x + (e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0),
          y: element.y + (e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0),
        });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  function point(e: { clientX: number; clientY: number }) {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      svg.current!.getScreenCTM()!.inverse(),
    );
    return grid.snap
      ? new DOMPoint(snapCoordinate(p.x, grid.spacing), snapCoordinate(p.y, grid.spacing))
      : p;
  }
  function start(
    e: React.PointerEvent,
    mode: 'move' | 'resize' | 'line' | 'draw',
    target?: DesignElement,
  ) {
    if (e.button !== 0 || busy || (target && layerLocked(design, target))) return;
    if (target && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      setGroupSelection((current) =>
        current.includes(target.id)
          ? current.filter((id) => id !== target.id)
          : [...new Set([...(current.length ? current : selected ? [selected] : []), target.id])],
      );
      return;
    }
    setGroupSelection([]);
    if (target?.textPath) {
      e.preventDefault();
      e.stopPropagation();
      setSelected(target.id);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if ((mode === 'move' || mode === 'resize') && tool !== 'select') return;
    svg.current!.focus();
    svg.current!.setPointerCapture(e.pointerId);
    history.checkpoint();
    const raw = point(e);
    const p = target
      ? transformPoint(
          inverse(multiply(parentMatrix(design, target), target.matrix ?? identity)),
          raw,
        )
      : raw;
    drag.current = { start: p, element: target, mode, points: [p], base: design };
    if (target) {
      setSelected(target.id);
      setOperation(target.operation || 'print');
      setVertex(0);
    }
  }
  function move(e: React.PointerEvent) {
    if (curveDrag.current) {
      const c = curveDrag.current;
      const p = transformPoint(
        inverse(multiply(parentMatrix(c.base, c.element), elementMatrix(c.element))),
        point(e),
      );
      const value = {
        x: Math.max(0, Math.min(1, p.x / c.element.width)),
        y: Math.max(0, Math.min(1, p.y / c.element.height)),
      };
      const next =
        c.control === 'start'
          ? { ...c.element, points: c.element.points!.map((p, i) => (i === 0 ? value : p)) }
          : {
              ...c.element,
              curves: c.element.curves!.map((segment, i) =>
                i === c.segment ? { ...segment, [c.control]: value } : segment,
              ),
            };
      history.replace(
        validateStickerDesign({
          ...c.base,
          elements: c.base.elements.map((e) => (e.id === next.id ? next : e)),
        }),
      );
      return;
    }
    const d = drag.current;
    if (!d) return;
    const raw = point(e);
    const p = d.element
        ? transformPoint(
            inverse(multiply(parentMatrix(d.base, d.element), d.element.matrix ?? identity)),
            raw,
          )
        : raw,
      dx = p.x - d.start.x,
      dy = p.y - d.start.y;
    if (d.element) {
      const a = (d.element.rotation * Math.PI) / 180;
      const next =
        d.mode === 'move'
          ? { ...d.element, x: d.element.x + dx, y: d.element.y + dy }
          : {
              ...d.element,
              width: Math.max(1, d.element.width + dx * Math.cos(a) + dy * Math.sin(a)),
              height: Math.max(1, d.element.height - dx * Math.sin(a) + dy * Math.cos(a)),
            };
      if (grid.snap) {
        if (d.mode === 'move') {
          next.x = snapCoordinate(next.x, grid.spacing);
          next.y = snapCoordinate(next.y, grid.spacing);
        } else {
          next.width = Math.max(0.1, snapCoordinate(next.width, grid.spacing));
          next.height = Math.max(0.1, snapCoordinate(next.height, grid.spacing));
        }
      }
      if (d.mode === 'resize' && next.cornerRadius !== undefined)
        next.cornerRadius = Math.min(next.cornerRadius, next.width / 2, next.height / 2);
      if (d.mode === 'resize' && next.kind === 'text')
        next.fontSize = Math.max(
          0.5,
          Math.min(100, (d.element.fontSize! * next.width) / d.element.width),
        );
      try {
        history.replace(
          validateStickerDesign({
            ...d.base,
            elements: d.base.elements.map((v) => (v.id === next.id ? next : v)),
          }),
        );
      } catch {}
    } else {
      if (d.points.length >= 2000) return;
      const clamped = {
        x: Math.max(0, Math.min(design.width, grid.snap ? snapCoordinate(p.x, grid.spacing) : p.x)),
        y: Math.max(
          0,
          Math.min(design.height, grid.snap ? snapCoordinate(p.y, grid.spacing) : p.y),
        ),
      };
      if (d.mode === 'line') d.points = [d.start, clamped];
      else d.points.push(clamped);
      const xs = d.points.map((p) => p.x),
        ys = d.points.map((p) => p.y),
        x = Math.min(...xs),
        y = Math.min(...ys),
        width = Math.max(0.1, Math.max(...xs) - x),
        height = Math.max(0.1, Math.max(...ys) - y);
      const line: DesignElement = {
        ...newElement('draw', design),
        id: 'drawing-preview',
        operation,
        closed: operation === 'cut' && d.mode === 'draw',
        x,
        y,
        width,
        height,
        fill: 'transparent',
        stroke: ink,
        strokeWidth: 0.6,
        points: d.points.map((p) => ({ x: (p.x - x) / width, y: (p.y - y) / height })),
      };
      history.replace({ ...d.base, elements: [...d.base.elements, line] });
      setSelected(line.id);
    }
  }
  function end() {
    curveDrag.current = null;
    const d = drag.current;
    if (!d) return;
    drag.current = undefined;
    if (!d.element) {
      const id = crypto.randomUUID();
      history.replace((current) => ({
        ...current,
        elements: current.elements.map((e) => (e.id === 'drawing-preview' ? { ...e, id } : e)),
      }));
      setSelected(id);
      setTool('select');
    }
  }
  async function referenceImage(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const image = await readStickerArtwork(file);
      const bitmap = await createImageBitmap(file);
      const current = latestDesign.current;
      const scale = Math.min(current.width / bitmap.width, current.height / bitmap.height);
      const width = bitmap.width * scale,
        height = bitmap.height * scale;
      bitmap.close();
      update({
        ...current,
        reference: {
          image,
          opacity: 0.35,
          visible: true,
          x: (current.width - width) / 2,
          y: (current.height - height) / 2,
          width,
          height,
        },
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function image(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const src = await readStickerArtwork(file);
      const bitmap = await createImageBitmap(file);
      const e = newElement('image', design);
      e.image = src;
      e.height = (e.width * bitmap.height) / bitmap.width;
      if (e.height > design.height) {
        e.width *= design.height / e.height;
        e.height = design.height;
      }
      bitmap.close();
      e.x = (design.width - e.width) / 2;
      e.y = (design.height - e.height) / 2;
      add(e);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const draftRevision = useMemo(() => crypto.randomUUID(), [design, name, fixedCanvas]);
  const saveInFlight = useRef(false);
  const mounted = useRef(false);
  const editorController = useRef<StickerDesignerController>(null!);
  editorController.current = {
    save,
    cancel: onClose,
    busy: () => busy || fitting || saveInFlight.current,
    revision: () => draftRevision,
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onEditorController?.({
      save: (request) => editorController.current.save(request),
      cancel: () => editorController.current.cancel(),
      busy: () => editorController.current.busy(),
      revision: () => editorController.current.revision(),
    });
    return () => onEditorController?.(undefined);
  }, [onEditorController]);
  async function save(request?: AiEditorResolution) {
    if (busy || fitting || saveInFlight.current)
      throw Error('Wait for the current editor operation to finish.');
    saveInFlight.current = true;
    setBusy(true);
    setError('');
    try {
      if (!name.trim()) throw Error('Name the design first.');
      const clean = validateStickerDesign({ ...design, cropToCuts: !fixedCanvas });
      designCutPaths(clean);
      const image = await renderStickerDesign(clean);
      // Rendering yields to Stop/timeouts and human edits. Validate at the commit boundary,
      // not after onSave has already persisted the draft and closed the editor.
      if (!mounted.current || editorController.current.revision() !== draftRevision)
        throw Error('The editor draft changed while saving. Review it and save again.');
      if (request?.signal.aborted) throw Error('AI design access has stopped.');
      request?.assertCurrent();
      onSave(name.trim(), clean, image);
    } catch (e) {
      setError(String(e));
      setBusy(false);
      throw e;
    } finally {
      saveInFlight.current = false;
    }
  }
  async function fitCut() {
    if (busy || fitting) return;
    setBusy(true);
    setError('');
    try {
      const next = await fitDesignCut(design, fitOptions);
      history.setValue(next);
      setSelected('');
      setShowCuts(true);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  function layer(delta: number) {
    const elements = [...design.elements],
      i = elements.findIndex((e) => e.id === selected),
      j = i + delta;
    if (
      i < 0 ||
      j < 0 ||
      j >= elements.length ||
      layerLocked(design, elements[i]) ||
      layerLocked(design, elements[j]) ||
      (elements[i].parentId || null) !== (elements[j].parentId || null)
    )
      return;
    [elements[i], elements[j]] = [elements[j], elements[i]];
    update({ ...design, elements });
  }
  const number = (
    label: string,
    key: 'x' | 'y' | 'width' | 'height' | 'rotation' | 'strokeWidth' | 'fontSize' | 'cornerRadius',
    min = -500,
  ) => (
    <label>
      {label}
      <ScrubbableNumberInput
        type="number"
        step="0.5"
        min={min}
        value={element?.[key] ?? 0}
        onValueChange={(n) => {
          if (Number.isFinite(n)) patch({ [key]: n });
        }}
      />
    </label>
  );
  return (
    <section
      className="sticker-designer workspace-editor"
      aria-label={fixedCanvas ? 'Card designer' : 'Sticker designer'}
      hidden={!active}
    >
      <fieldset disabled={busy} className="designer-controls">
        <WorkspaceGrid>
          <WorkspacePanel kind="library">
            <WorkspacePanelHeading title="Design elements" />
            <div className="workspace-sidebar-content designer-inputs">
              <div className="designer-add-row">
                <button
                  className="secondary"
                  disabled={operation === 'cut'}
                  onClick={() => {
                    const e = newElement('text', design);
                    e.fill = ink;
                    add(e);
                  }}
                >
                  Add text
                </button>
                <button
                  className="secondary"
                  disabled={operation === 'cut'}
                  onClick={() => imageInput.current?.click()}
                >
                  Add image
                </button>
                <button
                  className="secondary"
                  aria-expanded={shapePickerOpen}
                  aria-controls="designer-shape-picker"
                  onClick={() => setShapePickerOpen((open) => !open)}
                >
                  Add shape
                </button>
              </div>
              <input
                ref={imageInput}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  void image(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {shapePickerOpen && (
                <div id="designer-shape-picker" className="designer-shapes" aria-label="Shapes">
                  {SHAPES.map((shape) => (
                    <button
                      key={shape}
                      title={`Add ${shape}`}
                      aria-label={`Add ${shape}`}
                      onClick={() => {
                        const e = newElement('shape', design);
                        e.shape = shape;
                        e.fill = ink;
                        add(e);
                      }}
                    >
                      <svg viewBox="0 0 100 100">
                        <path
                          d={elementPath({
                            ...newElement('shape', design),
                            shape,
                            width: 90,
                            height: 90,
                          })}
                          transform="translate(5 5)"
                        />
                      </svg>
                      <span>{shape}</span>
                    </button>
                  ))}
                </div>
              )}
              <details
                className="appearance-section add-artwork-tools"
                open={addToolsOpen}
                onToggle={(event) => setAddToolsOpen(event.currentTarget.open)}
              >
                <summary>Drawing tools & palette</summary>
                <label>
                  Editing
                  <select
                    value={operation}
                    onChange={(e) => {
                      setOperation(e.target.value as 'print' | 'cut');
                      setSelected('');
                      setPolygon([]);
                      setTool('select');
                    }}
                  >
                    <option value="print">Printed artwork</option>
                    <option value="cut" disabled={fixedCanvas}>
                      Cut paths
                    </option>
                  </select>
                </label>
                {operation === 'cut' && (
                  <>
                    <p className="muted">
                      Pink paths move the blade and never print. Custom paths replace the default
                      outer cut. Line makes an open cut; Polygon and Freehand make closed outlines.
                    </p>
                    <button
                      className="secondary"
                      onClick={() =>
                        add({
                          ...newElement('shape', design),
                          operation: 'cut',
                          shape: 'rectangle',
                          x: 0,
                          y: 0,
                          width: design.width,
                          height: design.height,
                          cornerRadius: Math.min(cutRadius, design.width / 2, design.height / 2),
                        })
                      }
                    >
                      Add default outline
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        design.elements.some((e) => e.operation === 'cut' && layerLocked(design, e))
                          ? setError('Unlock cut layers before replacing them.')
                          : update(
                              design.elements
                                .filter((e) => e.operation === 'cut')
                                .reduce((d, e) => removeLayer(d, e.id), design),
                            )
                      }
                    >
                      Use default sheet cut
                    </button>
                  </>
                )}
                <button
                  className="secondary compact"
                  onClick={() =>
                    add({
                      ...newElement('draw', design),
                      points: [
                        { x: 0.1, y: 0.8 },
                        { x: 0.9, y: 0.8 },
                      ],
                      curves: [
                        { c1: { x: 0.1, y: 0.1 }, c2: { x: 0.9, y: 0.1 }, end: { x: 0.9, y: 0.8 } },
                      ],
                    })
                  }
                >
                  Add Bézier curve
                </button>
                <div className="sticker-actions">
                  {(['select', 'line', 'draw', 'polygon'] as const).map((t) => (
                    <button
                      key={t}
                      className="secondary compact"
                      aria-pressed={tool === t}
                      onClick={() => {
                        setTool(t);
                        setPolygon([]);
                      }}
                    >
                      {t === 'select'
                        ? 'Select'
                        : t === 'line'
                          ? 'Line'
                          : t === 'polygon'
                            ? 'Polygon'
                            : 'Freehand'}
                    </button>
                  ))}
                </div>
                {tool === 'polygon' && (
                  <button
                    className="primary"
                    disabled={polygon.length < 3}
                    onClick={() => {
                      const x = Math.min(...polygon.map((p) => p.x)),
                        y = Math.min(...polygon.map((p) => p.y)),
                        w = Math.max(0.1, Math.max(...polygon.map((p) => p.x)) - x),
                        h = Math.max(0.1, Math.max(...polygon.map((p) => p.y)) - y);
                      add({
                        ...newElement('draw', design),
                        x,
                        y,
                        width: w,
                        height: h,
                        closed: true,
                        stroke: ink,
                        points: polygon.map((p) => ({ x: (p.x - x) / w, y: (p.y - y) / h })),
                      });
                      setPolygon([]);
                    }}
                  >
                    Finish outline ({polygon.length} points)
                  </button>
                )}
                <div className="designer-colors" hidden={operation === 'cut'}>
                  <label>
                    Color palette
                    <select
                      value={palette}
                      onChange={(e) => setPalette(e.target.value as keyof typeof PALETTES)}
                    >
                      {Object.keys(PALETTES).map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <div className="designer-swatches">
                    {PALETTES[palette].map((color) => (
                      <button
                        key={color}
                        style={{ background: color }}
                        aria-label={`Use ${color}`}
                        onClick={() => {
                          setInk(color);
                          if (element)
                            patch(
                              element.kind === 'draw' || element.kind === 'line'
                                ? { stroke: color }
                                : { fill: color },
                            );
                        }}
                      />
                    ))}
                  </div>
                  <label>
                    Drawing color
                    <input
                      type="color"
                      value={ink}
                      onInput={(e) => setInk(e.currentTarget.value)}
                    />
                  </label>
                </div>
              </details>
              {groupSelection.length > 1 && (
                <p className="muted">
                  {groupSelection.length} layers selected. Use Align & distribute or Group selected
                  in Layers.
                </p>
              )}
              {element && groupSelection.length < 2 && (
                <section className="sticker-selection">
                  {layerLocked(design, element) && (
                    <p className="muted">
                      {element.locked
                        ? 'This layer is locked. Unlock it in Layers to edit.'
                        : 'This layer is locked by its group. Unlock the group in Layers.'}
                    </p>
                  )}
                  <fieldset
                    className="selection-properties"
                    disabled={layerLocked(design, element)}
                  >
                    <h3>Selected {element.operation === 'cut' ? 'cut path' : element.kind}</h3>
                    <label>
                      Layer name
                      <input
                        value={element.name ?? ''}
                        maxLength={100}
                        placeholder={layerLabel(element)}
                        onChange={(event) => patch({ name: event.target.value })}
                      />
                    </label>
                    {element.kind === 'group' && (
                      <p className="muted">
                        Edit this logical part as a whole, or select a child in Layers to refine it.
                      </p>
                    )}
                    {['shape', 'draw', 'line'].includes(element.kind) && !element.parentId && (
                      <label>
                        Element use
                        <select
                          value={element.operation || 'print'}
                          onChange={(e) => {
                            patch({ operation: e.target.value as 'print' | 'cut' });
                            setOperation(e.target.value as 'print' | 'cut');
                          }}
                        >
                          <option value="print">Printed artwork</option>
                          <option value="cut" disabled={fixedCanvas}>
                            Cut path (does not print)
                          </option>
                        </select>
                      </label>
                    )}
                    {element.kind === 'shape' &&
                      element.shape === 'rectangle' &&
                      number('Corner radius (mm)', 'cornerRadius', 0)}
                    {element.kind === 'draw' && !element.curves && (
                      <details className="appearance-section">
                        <summary>Polygon points</summary>
                        <label>
                          <input
                            type="checkbox"
                            checked={!!element.closed}
                            onChange={(e) => patch({ closed: e.target.checked })}
                          />{' '}
                          Close path
                        </label>
                        <label>
                          Vertex
                          <select
                            value={Math.min(vertex, element.points!.length - 1)}
                            onChange={(e) => setVertex(Number(e.target.value))}
                          >
                            {element.points!.map((_, i) => (
                              <option key={i} value={i}>
                                {i + 1}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="sticker-dimensions">
                          {(['x', 'y'] as const).map((axis) => (
                            <label key={axis}>
                              Vertex {axis.toUpperCase()} (%)
                              <ScrubbableNumberInput
                                type="number"
                                min="0"
                                max="100"
                                step="1"
                                value={
                                  element.points![Math.min(vertex, element.points!.length - 1)][
                                    axis
                                  ] * 100
                                }
                                onValueChange={(n) => {
                                  if (Number.isFinite(n))
                                    patch({
                                      points: element.points!.map((p, i) =>
                                        i === Math.min(vertex, element.points!.length - 1)
                                          ? { ...p, [axis]: n / 100 }
                                          : p,
                                      ),
                                    });
                                }}
                              />
                            </label>
                          ))}
                        </div>
                      </details>
                    )}
                    {element.kind === 'text' && (
                      <>
                        <label>
                          Text
                          <textarea
                            value={element.text}
                            maxLength={2000}
                            onChange={(e) => patch({ text: e.target.value })}
                          />
                        </label>
                        <label>
                          Font
                          <select
                            value={element.font}
                            onChange={(e) =>
                              patch({ font: e.target.value as DesignElement['font'] })
                            }
                          >
                            {FONTS.map((f) => (
                              <option key={f}>{f}</option>
                            ))}
                          </select>
                        </label>
                        {number('Font size (mm)', 'fontSize', 0.5)}
                        <label>
                          <input
                            type="checkbox"
                            checked={element.bold}
                            onChange={(e) => patch({ bold: e.target.checked })}
                          />{' '}
                          Bold
                        </label>
                        <label>
                          Text alignment
                          <select
                            value={element.align}
                            onChange={(e) =>
                              patch({ align: e.target.value as DesignElement['align'] })
                            }
                          >
                            {['left', 'center', 'right'].map((a) => (
                              <option key={a}>{a}</option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                    <details className="appearance-section">
                      <summary>Position & size</summary>
                      <div className="sticker-dimensions">
                        {number('X (mm)', 'x')}
                        {number('Y (mm)', 'y')}
                        {number('Width (mm)', 'width', 0.1)}
                        {number('Height (mm)', 'height', 0.1)}
                        {number('Rotation (°)', 'rotation', -360)}
                      </div>
                    </details>
                    {element.kind !== 'image' &&
                      element.kind !== 'group' &&
                      element.operation !== 'cut' && (
                        <>
                          <label>
                            {element.gradient ? 'Solid fill (when gradient is off)' : 'Fill'}
                            <input
                              type="color"
                              value={element.fill === 'transparent' ? '#ffffff' : element.fill}
                              onInput={(e) => patch({ fill: e.currentTarget.value })}
                            />
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={!element.gradient && element.fill === 'transparent'}
                              onChange={(e) =>
                                patch({
                                  fill: e.target.checked ? 'transparent' : ink,
                                  gradient: null,
                                })
                              }
                            />{' '}
                            No fill
                          </label>
                          <label>
                            Line color
                            <input
                              type="color"
                              value={element.stroke === 'transparent' ? '#222222' : element.stroke}
                              onInput={(e) => patch({ stroke: e.currentTarget.value })}
                            />
                          </label>
                          {number('Line width (mm)', 'strokeWidth', 0)}
                        </>
                      )}
                    {element.kind === 'draw' && element.curves && (
                      <label className="appearance-check">
                        <input
                          type="checkbox"
                          checked={!!element.closed}
                          onChange={(event) => patch({ closed: event.target.checked })}
                        />
                        Closed path
                      </label>
                    )}
                    <AppearancePanel
                      design={design}
                      key={element.id}
                      element={element}
                      patch={patch}
                      onError={setError}
                      onApplyMaterial={(preset, includeDescendants) => {
                        try {
                          update(
                            applyMaterialPreset(
                              design,
                              groupSelection.length ? groupSelection : [selected],
                              preset,
                              { includeDescendants },
                            ),
                          );
                        } catch (error) {
                          setError(String(error));
                        }
                      }}
                      onSaveMaterial={(materialName) => {
                        try {
                          update(saveMaterialPreset(design, selected, materialName));
                        } catch (error) {
                          setError(String(error));
                        }
                      }}
                    />
                    <label hidden={element.operation === 'cut'}>
                      Opacity
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step=".05"
                        value={element.opacity}
                        onChange={(e) => patch({ opacity: Number(e.target.value) })}
                      />
                    </label>
                    <div className="sticker-actions">
                      <button
                        className="secondary compact"
                        onClick={() => patch({ flipX: !element.flipX })}
                      >
                        Mirror
                      </button>
                      <button
                        className="secondary compact"
                        onClick={() => patch({ flipY: !element.flipY })}
                      >
                        Flip
                      </button>
                      <button
                        className="secondary compact"
                        onClick={() => {
                          try {
                            const id = crypto.randomUUID();
                            update(duplicateLayer(design, element.id, id));
                            setSelected(id);
                          } catch (error) {
                            setError(String(error));
                          }
                        }}
                      >
                        Duplicate
                      </button>
                      <button className="secondary compact" onClick={remove}>
                        Delete
                      </button>
                    </div>
                  </fieldset>
                </section>
              )}
            </div>
          </WorkspacePanel>
          <WorkspacePanel kind="preview-panel">
            <div className="preview-toolbar">
              <button className="secondary compact" onClick={onClose} disabled={busy}>
                Cancel editing
              </button>
              <button
                className="secondary compact"
                disabled={!history.canUndo || busy}
                onClick={history.undo}
              >
                Undo
              </button>
              <button
                className="secondary compact"
                disabled={!history.canRedo || busy}
                onClick={history.redo}
              >
                Redo
              </button>
              <button
                className="secondary compact"
                disabled={busy || fixedCanvas}
                onClick={() => void fitCut()}
              >
                Fit Cut
              </button>
              <button
                className="secondary compact"
                aria-pressed={showCuts}
                onClick={() => setShowCuts(!showCuts)}
              >
                Show cuts
              </button>
              <button
                className="secondary compact"
                aria-pressed={grid.visible}
                onClick={() => update({ ...design, grid: { ...grid, visible: !grid.visible } })}
              >
                Grid
              </button>
              <button
                className="secondary compact"
                aria-pressed={grid.snap}
                onClick={() => update({ ...design, grid: { ...grid, snap: !grid.snap } })}
              >
                Snap
              </button>
              <ZoomControl value={zoom} onChange={setZoom} />
            </div>
            <div className="designer-canvas" ref={viewport}>
              <svg
                ref={svg}
                viewBox={`0 0 ${design.width} ${design.height}`}
                style={{
                  width: `${canvasWidth}px`,
                  aspectRatio: `${design.width}/${design.height}`,
                }}
                tabIndex={0}
                role="img"
                aria-label={fixedCanvas ? 'Editable card artwork' : 'Editable sticker artwork'}
                onPointerDown={(e) => {
                  if (tool === 'polygon') {
                    const p = point(e);
                    if (polygon.length < 2000)
                      setPolygon([
                        ...polygon,
                        {
                          x: Math.max(0, Math.min(design.width, p.x)),
                          y: Math.max(0, Math.min(design.height, p.y)),
                        },
                      ]);
                  } else if (tool === 'select') setSelected('');
                  else if (design.elements.length < 500) start(e, tool);
                }}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
              >
                <rect width={design.width} height={design.height} fill={design.background} />
                <g pointerEvents="none" dangerouslySetInnerHTML={{ __html: artworkMarkup }} />
                {design.reference?.visible && (
                  <image
                    href={design.reference.image}
                    x={design.reference.x}
                    y={design.reference.y}
                    width={design.reference.width}
                    height={design.reference.height}
                    opacity={design.reference.opacity}
                    preserveAspectRatio="xMidYMid meet"
                    pointerEvents="none"
                  />
                )}
                {grid.visible && (
                  <g pointerEvents="none">
                    <defs>
                      <pattern
                        id="editor-grid"
                        width={grid.spacing}
                        height={grid.spacing}
                        patternUnits="userSpaceOnUse"
                      >
                        <path
                          d={`M${grid.spacing} 0 H0 V${grid.spacing}`}
                          fill="none"
                          stroke="#7c8490"
                          strokeWidth=".5"
                          vectorEffect="non-scaling-stroke"
                        />
                      </pattern>
                    </defs>
                    <rect
                      width={design.width}
                      height={design.height}
                      fill="url(#editor-grid)"
                      opacity=".4"
                    />
                  </g>
                )}
                {design.elements
                  .filter(
                    (e) =>
                      !layerHidden(design, e) &&
                      (e.operation !== 'cut' ||
                        showCuts ||
                        operation === 'cut' ||
                        e.id === selected),
                  )
                  .sort(
                    (a, b) =>
                      Number(a.id === selected) - Number(b.id === selected) ||
                      Number(a.operation === 'cut') - Number(b.operation === 'cut'),
                  )
                  .map((e) => {
                    const frame = e.textPath
                      ? design.elements.find((p) => p.id === e.textPath!.pathId)!
                      : e;
                    return (
                      <g
                        key={e.id}
                        transform={`matrix(${multiply(parentMatrix(design, frame), elementMatrix(frame)).join(' ')})`}
                        opacity={1}
                        pointerEvents={
                          e.operation === 'cut' && operation !== 'cut' ? 'none' : undefined
                        }
                        onPointerDown={(event) => {
                          if (tool === 'select') start(event, 'move', e);
                        }}
                        role="button"
                        aria-label={e.kind === 'text' ? `Text: ${e.text}` : e.kind}
                      >
                        {e.operation === 'cut' && (
                          <path
                            d={elementPath(e)}
                            fill="none"
                            stroke="#ec268f"
                            strokeWidth={1}
                            vectorEffect="non-scaling-stroke"
                            strokeDasharray="4 3"
                          />
                        )}
                        {layerHitRegions(e, frame).map((region, index) => (
                          <rect
                            key={index}
                            data-layer-hit={e.id}
                            data-copy-index={index}
                            transform={region.transform}
                            width={region.width}
                            height={region.height}
                            fill="transparent"
                            stroke={
                              selected === e.id || groupSelection.includes(e.id)
                                ? '#7560cf'
                                : 'none'
                            }
                            strokeWidth={1}
                            strokeDasharray="4 3"
                            vectorEffect="non-scaling-stroke"
                            pointerEvents={
                              tool === 'select' && (!e.parentId || e.id === selected)
                                ? 'all'
                                : 'none'
                            }
                          />
                        ))}
                        {e.repeat && selected === e.id && (
                          <rect
                            width={frame.width}
                            height={frame.height}
                            fill="none"
                            stroke="#86868b"
                            strokeWidth={1}
                            strokeDasharray="2 3"
                            vectorEffect="non-scaling-stroke"
                            pointerEvents="none"
                          />
                        )}
                        {selected === e.id && !e.textPath && !layerLocked(design, e) && (
                          <rect
                            x={e.width - handleSize / 2}
                            y={e.height - handleSize / 2}
                            width={handleSize}
                            height={handleSize}
                            fill="white"
                            stroke="#86868b"
                            strokeWidth={1}
                            vectorEffect="non-scaling-stroke"
                            aria-label="Resize selected element"
                            onPointerDown={(event) => start(event, 'resize', e)}
                          />
                        )}
                      </g>
                    );
                  })}
                {element?.curves &&
                  !layerLocked(design, element) &&
                  !layerHidden(design, element) && (
                    <g
                      transform={`matrix(${multiply(parentMatrix(design, element), elementMatrix(element)).join(' ')})`}
                    >
                      {element.curves.map((curve, i) => {
                        const start = i ? element.curves![i - 1].end : element.points![0];
                        return (
                          <g key={i}>
                            <path
                              d={`M${start.x * element.width} ${start.y * element.height} L${curve.c1.x * element.width} ${curve.c1.y * element.height} M${curve.end.x * element.width} ${curve.end.y * element.height} L${curve.c2.x * element.width} ${curve.c2.y * element.height}`}
                              stroke="#7560cf"
                              strokeWidth="1"
                              vectorEffect="non-scaling-stroke"
                              fill="none"
                            />
                            {(
                              ['c1', 'c2', 'end', ...(i === 0 ? ['start'] : [])] as (
                                'c1' | 'c2' | 'end' | 'start'
                              )[]
                            ).map((control) => {
                              const p = control === 'start' ? start : curve[control];
                              return (
                                <circle
                                  key={control}
                                  cx={p.x * element.width}
                                  cy={p.y * element.height}
                                  r={handleSize / 2}
                                  fill={control === 'c1' || control === 'c2' ? '#7560cf' : 'white'}
                                  stroke="#7560cf"
                                  strokeWidth="1"
                                  vectorEffect="non-scaling-stroke"
                                  aria-label={`Curve ${i + 1} ${control}`}
                                  onPointerDown={(event) => {
                                    event.stopPropagation();
                                    event.preventDefault();
                                    svg.current!.setPointerCapture(event.pointerId);
                                    history.checkpoint();
                                    curveDrag.current = {
                                      base: design,
                                      element,
                                      segment: i,
                                      control,
                                    };
                                  }}
                                />
                              );
                            })}
                          </g>
                        );
                      })}
                    </g>
                  )}
                {polygon.length > 0 && (
                  <polyline
                    points={polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={operation === 'cut' ? '#ec268f' : ink}
                    strokeWidth={operation === 'cut' ? 1 : 0.25}
                    vectorEffect={operation === 'cut' ? 'non-scaling-stroke' : undefined}
                    strokeDasharray={operation === 'cut' ? '4 3' : undefined}
                    pointerEvents="none"
                  />
                )}
                {(showCuts || operation === 'cut') && !hasCustomCuts(design) && (
                  <rect
                    x=".15"
                    y=".15"
                    width={design.width - 0.3}
                    height={design.height - 0.3}
                    rx={Math.max(
                      0,
                      Math.min(cutRadius, design.width / 2, design.height / 2) - 0.15,
                    )}
                    fill="none"
                    stroke="#ec268f"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray="4 3"
                    pointerEvents="none"
                  />
                )}
              </svg>
            </div>
            <p className="designer-caption">
              {tool === 'polygon'
                ? 'Click each corner, then choose Finish outline.'
                : tool === 'select'
                  ? 'Select and drag elements. Drag the small corner handle to resize.'
                  : `Drag to draw a ${tool === 'line' ? 'straight line' : 'freehand stroke'}.`}{' '}
              Artwork outside the {fixedCanvas ? 'card' : 'sticker'} is clipped. Pink outlines do
              not print; check final sizes and cut paths on the sheet.
            </p>
            {error && (
              <p role="alert" className="workflow-error">
                {error}
              </p>
            )}
          </WorkspacePanel>
          <WorkspacePanel kind="settings-panel">
            <WorkspacePanelHeading title="Design setup" />
            <div className="workspace-sidebar-content designer-inputs">
              <label>
                Design name
                <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
              </label>
              <details className="appearance-section">
                <summary>Canvas & cut settings</summary>
                <div className="sticker-dimensions">
                  {(['width', 'height'] as const).map((key) => (
                    <label key={key}>
                      {key === 'width' ? 'Width' : 'Height'} (mm)
                      <ScrubbableNumberInput
                        type="number"
                        min="10"
                        max="250"
                        disabled={fixedCanvas}
                        value={design[key]}
                        onValueChange={(value) => {
                          update({ ...design, [key]: value });
                        }}
                      />
                    </label>
                  ))}
                </div>
                <details className="appearance-section">
                  <summary>Grid settings</summary>
                  <label>
                    Grid spacing (mm)
                    <ScrubbableNumberInput
                      value={grid.spacing}
                      min={0.5}
                      max={50}
                      step={0.5}
                      onValueChange={(spacing) => update({ ...design, grid: { ...grid, spacing } })}
                    />
                  </label>
                  <p className="muted">
                    The grid is a guide only and never prints. Snap applies when drawing and
                    dragging.
                  </p>
                </details>
                <label>
                  Background
                  <input
                    type="color"
                    value={design.background === 'transparent' ? '#ffffff' : design.background}
                    onInput={(e) => update({ ...design, background: e.currentTarget.value })}
                  />
                </label>
                <fieldset
                  hidden={fixedCanvas}
                  disabled={busy}
                  style={{ border: 0, padding: 0, margin: 0 }}
                >
                  <h3>Cut border</h3>
                  <div className="sticker-dimensions">
                    <label>
                      Border width (mm)
                      <ScrubbableNumberInput
                        type="number"
                        min="0"
                        max="20"
                        step="0.25"
                        value={fitOptions.borderWidth}
                        onValueChange={(value) =>
                          changeFitOptions({ ...fitOptions, borderWidth: value })
                        }
                      />
                    </label>
                    <label>
                      Border stroke (mm)
                      <ScrubbableNumberInput
                        type="number"
                        min="0"
                        max="5"
                        step="0.1"
                        value={fitOptions.strokeWidth}
                        onValueChange={(value) =>
                          changeFitOptions({ ...fitOptions, strokeWidth: value })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Border placement
                    <select
                      value={fitOptions.strokePlacement ?? 'inside'}
                      onChange={(e) =>
                        changeFitOptions({
                          ...fitOptions,
                          strokePlacement: e.target.value as FitCutOptions['strokePlacement'],
                        })
                      }
                    >
                      <option value="inside">Inside</option>
                      <option value="centered">Centered</option>
                      <option value="outside">Outside</option>
                    </select>
                  </label>
                  <label>
                    Border stroke color
                    <input
                      type="color"
                      value={fitOptions.strokeColor}
                      onInput={(e) =>
                        changeFitOptions({ ...fitOptions, strokeColor: e.currentTarget.value })
                      }
                    />
                  </label>
                  <p className="muted">
                    Border changes automatically update the cut around visible artwork. Placement
                    positions the printed stroke relative to the cut line. A stroke of 0 turns the
                    printed border off. Drag numeric fields left or right to adjust them, or click
                    to type.
                  </p>
                </fieldset>
              </details>
              <button
                className="primary"
                disabled={busy || fitting}
                onClick={() => void save().catch(() => {})}
              >
                {busy ? 'Saving artwork…' : saveLabel}
              </button>
              <p className="muted">
                {fixedCanvas
                  ? 'Card artwork keeps the project’s full card dimensions. Its editable layers are saved with the card.'
                  : 'Saves editable layers and updates every copy on the sheet.'}
              </p>
              <details className="appearance-section">
                <summary>Reference overlay · never prints or cuts</summary>
                <label className="appearance-upload">
                  Load reference image
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={busy}
                    onChange={(event) => {
                      void referenceImage(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                </label>
                <p className="muted">
                  A tracing guide only. Saved with editable artwork, excluded from output and cut
                  generation.
                </p>
                {design.reference && (
                  <>
                    <label className="appearance-check">
                      <input
                        type="checkbox"
                        checked={design.reference.visible}
                        onChange={(event) =>
                          update({
                            ...design,
                            reference: { ...design.reference!, visible: event.target.checked },
                          })
                        }
                      />
                      Show reference
                    </label>
                    <label>
                      Reference opacity · {Math.round(design.reference.opacity * 100)}%
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={design.reference.opacity * 100}
                        onChange={(event) =>
                          update({
                            ...design,
                            reference: {
                              ...design.reference!,
                              opacity: Number(event.target.value) / 100,
                            },
                          })
                        }
                      />
                    </label>
                    <div className="appearance-grid">
                      {(['x', 'y', 'width', 'height'] as const).map((key) => (
                        <label key={key}>
                          Reference {key} (mm)
                          <ScrubbableNumberInput
                            type="number"
                            step="0.5"
                            min={key === 'x' || key === 'y' ? -500 : 0.1}
                            max="500"
                            value={design.reference![key]}
                            onValueChange={(value) => {
                              if (Number.isFinite(value))
                                update({
                                  ...design,
                                  reference: { ...design.reference!, [key]: value },
                                });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <button
                      className="secondary compact"
                      onClick={() => update({ ...design, reference: undefined })}
                    >
                      Remove reference
                    </button>
                  </>
                )}
              </details>
              {element && (
                <details className="appearance-section">
                  <summary>Selection detail · {layerLabel(element)}</summary>
                  <p className="muted">
                    Close-up in artwork context. Reference and cut guides are excluded.
                  </p>
                  <ZoomControl value={detailZoom} onChange={setDetailZoom} />
                  <svg
                    className="selection-detail"
                    role="img"
                    aria-label={`Detail of ${layerLabel(element)}`}
                    viewBox={selectionViewBox(design, element, detailZoom)}
                  >
                    <rect width={design.width} height={design.height} fill={design.background} />
                    <g
                      dangerouslySetInnerHTML={{
                        __html: renderDesignContent(design, 'selection-detail'),
                      }}
                    />
                  </svg>
                </details>
              )}
              <h3>Layers</h3>
              {element && (
                <nav className="layer-breadcrumbs" aria-label="Selected layer hierarchy">
                  {layerAncestors(design, element).map((group) => (
                    <button
                      key={group.id}
                      className="secondary compact"
                      onClick={() => {
                        setSelected(group.id);
                        setGroupSelection([]);
                      }}
                    >
                      {layerLabel(group)}
                    </button>
                  ))}
                  <span>{layerLabel(element)}</span>
                </nav>
              )}
              <p className="muted">
                Drag to reorder within a group. Shift-click sibling layers, then Group selected.
                Name groups to organize logical parts.
              </p>
              <div className="sticker-actions">
                <button
                  className="secondary compact"
                  disabled={groupSelection.length < 2}
                  onClick={() => {
                    try {
                      const id = crypto.randomUUID();
                      update(groupLayers(design, groupSelection, id));
                      setSelected(id);
                      setGroupSelection([]);
                    } catch (error) {
                      setError(String(error));
                    }
                  }}
                >
                  Group selected
                </button>
                <button
                  className="secondary compact"
                  disabled={element?.kind !== 'group' || layerLocked(design, element)}
                  onClick={() => {
                    try {
                      update(ungroupLayer(design, selected));
                      setSelected('');
                    } catch (error) {
                      setError(String(error));
                    }
                  }}
                >
                  Ungroup
                </button>
              </div>
              <details className="appearance-section" open={groupSelection.length > 1}>
                <summary>
                  Align & distribute{' '}
                  {groupSelection.length ? `· ${groupSelection.length} selected` : ''}
                </summary>
                <div className="alignment-buttons">
                  {(
                    [
                      ['left', 'Left'],
                      ['center', 'Center'],
                      ['right', 'Right'],
                      ['top', 'Top'],
                      ['middle', 'Middle'],
                      ['bottom', 'Bottom'],
                      ['distribute-horizontal', 'Distribute horizontally'],
                      ['distribute-vertical', 'Distribute vertically'],
                    ] as [Alignment, string][]
                  ).map(([alignment, label]) => (
                    <button
                      key={alignment}
                      className="secondary compact"
                      disabled={
                        groupSelection.length < (alignment.startsWith('distribute') ? 3 : 2)
                      }
                      onClick={() => {
                        try {
                          update(alignLayers(design, groupSelection, alignment));
                        } catch (error) {
                          setError(String(error));
                        }
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="muted">
                  Shift-click layers or canvas objects to select several. Align uses the selection’s
                  bounds; distribution spaces their centers evenly.
                </p>
              </details>
              <div className="designer-layers" aria-label="Design layers">
                {visibleLayers.map((e, i) => (
                  <div
                    className="designer-layer-row"
                    key={e.id}
                    style={{ marginLeft: `${layerAncestors(design, e).length * 12}px` }}
                  >
                    <button
                      key={e.id}
                      className={'secondary' + (dropLayer === e.id ? ' layer-drop-target' : '')}
                      draggable={!layerLocked(design, e)}
                      onDragStart={(event) => {
                        setDraggedLayer(e.id);
                        event.dataTransfer.setData('text/plain', e.id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                        setDropLayer(e.id);
                      }}
                      onDragEnd={() => {
                        setDraggedLayer('');
                        setDropLayer('');
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const id = draggedLayer || event.dataTransfer.getData('text/plain');
                        const next = reorderDesignLayer(design, id, e.id);
                        if (next !== design) history.setValue(next);
                        setSelected(id);
                        setDraggedLayer('');
                        setDropLayer('');
                      }}
                      aria-pressed={selected === e.id || groupSelection.includes(e.id)}
                      onClick={(event) => {
                        if (event.shiftKey || event.metaKey || event.ctrlKey) {
                          setGroupSelection((current) =>
                            current.includes(e.id)
                              ? current.filter((id) => id !== e.id)
                              : [
                                  ...new Set([
                                    ...(current.length ? current : selected ? [selected] : []),
                                    e.id,
                                  ]),
                                ],
                          );
                          return;
                        }
                        setGroupSelection([]);
                        setSelected(e.id);
                        setOperation(e.operation || 'print');
                        setVertex(0);
                        setTool('select');
                      }}
                    >
                      <GripVertical size={12} aria-hidden="true" />
                      {design.elements.indexOf(e) + 1}. {e.operation === 'cut' ? 'Cut · ' : ''}
                      {layerLabel(e)}
                      {e.kind === 'group'
                        ? ` · ${design.elements.filter((child) => child.parentId === e.id).length}`
                        : ''}
                    </button>
                    {e.kind === 'group' && (
                      <button
                        className="secondary compact layer-icon"
                        aria-label={`${collapsedGroups.includes(e.id) ? 'Expand' : 'Collapse'} group ${layerLabel(e)}`}
                        aria-expanded={!collapsedGroups.includes(e.id)}
                        onClick={() =>
                          setCollapsedGroups((ids) =>
                            ids.includes(e.id) ? ids.filter((id) => id !== e.id) : [...ids, e.id],
                          )
                        }
                      >
                        {collapsedGroups.includes(e.id) ? (
                          <ChevronRight size={13} />
                        ) : (
                          <ChevronDown size={13} />
                        )}
                      </button>
                    )}
                    <button
                      className="secondary compact layer-icon"
                      aria-label={`${e.hidden ? 'Show' : 'Hide'} layer ${i + 1}`}
                      title={
                        !e.hidden && layerHidden(design, e)
                          ? 'Hidden by group'
                          : e.hidden
                            ? 'Show layer'
                            : 'Hide layer'
                      }
                      disabled={!e.hidden && layerHidden(design, e)}
                      onClick={() =>
                        update({
                          ...design,
                          elements: design.elements.map((v) =>
                            v.id === e.id ? { ...v, hidden: !e.hidden } : v,
                          ),
                        })
                      }
                    >
                      {layerHidden(design, e) ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <button
                      className="secondary compact layer-icon"
                      aria-label={`${e.locked ? 'Unlock' : 'Lock'} layer ${i + 1}`}
                      title={
                        !e.locked && layerLocked(design, e)
                          ? 'Locked by group'
                          : e.locked
                            ? 'Unlock layer'
                            : 'Lock layer'
                      }
                      disabled={!e.locked && layerLocked(design, e)}
                      onClick={() =>
                        update({
                          ...design,
                          elements: design.elements.map((v) =>
                            v.id === e.id ? { ...v, locked: !e.locked } : v,
                          ),
                        })
                      }
                    >
                      {layerLocked(design, e) ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                  </div>
                ))}
              </div>
              <div className="sticker-actions">
                <button className="secondary compact" disabled={!element} onClick={() => layer(1)}>
                  Bring forward
                </button>
                <button className="secondary compact" disabled={!element} onClick={() => layer(-1)}>
                  Send backward
                </button>
              </div>
            </div>
          </WorkspacePanel>
        </WorkspaceGrid>
      </fieldset>
    </section>
  );
}
