import { useEffect, useRef, useState } from 'react';
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
  elementTransform,
  renderStickerDesign,
  validateStickerDesign,
  type StickerDesign,
  type DesignElement,
} from '../lib/sticker-design';
import { readStickerArtwork } from '../lib/sticker-output';
import './StickerDesigner.css';
import { designCutPaths, hasCustomCuts } from '../lib/sticker-cuts';
import { fitDesignCut, reorderDesignLayer, type FitCutOptions } from '../lib/sticker-fit-cut';
import { GripVertical } from 'lucide-react';

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
}) {
  const history = useWorkspaceHistory(() => initial),
    design = history.value;
  const [name, setName] = useState(initialName),
    [selected, setSelected] = useState(''),
    [tool, setTool] = useState<'select' | 'line' | 'draw' | 'polygon'>('select'),
    [operation, setOperation] = useState<'print' | 'cut'>('print'),
    [polygon, setPolygon] = useState<{ x: number; y: number }[]>([]),
    [vertex, setVertex] = useState(0),
    [palette, setPalette] = useState<keyof typeof PALETTES>('Essentials'),
    [ink, setInk] = useState('#7560cf'),
    [showCuts, setShowCuts] = useState(false),
    [zoom, setZoom] = useState(100),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [space, setSpace] = useState({ width: 500, height: 500 });
  const [fitOptions, setFitOptions] = useState<FitCutOptions>(
    initial.fitCut ?? fitCutDefaults ?? { borderWidth: 1, strokeWidth: 0, strokeColor: '#222222' },
  );
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
    clipboard = useRef<DesignElement | undefined>(undefined),
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
    if (element)
      update({
        ...design,
        elements: design.elements.map((e) => (e.id === selected ? { ...e, ...value } : e)),
      });
  }
  function add(e: DesignElement) {
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
    update({ ...design, elements: design.elements.filter((e) => e.id !== selected) });
    setSelected('');
  }
  function copy(action: 'cut' | 'copy' | 'paste') {
    if (action === 'paste') {
      if (clipboard.current)
        add({
          ...structuredClone(clipboard.current),
          id: crypto.randomUUID(),
          x: clipboard.current.x + 2,
          y: clipboard.current.y + 2,
        });
      return;
    }
    if (element) {
      clipboard.current = structuredClone(element);
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
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(
      svg.current!.getScreenCTM()!.inverse(),
    );
  }
  function start(
    e: React.PointerEvent,
    mode: 'move' | 'resize' | 'line' | 'draw',
    target?: DesignElement,
  ) {
    if (e.button !== 0 || busy) return;
    e.preventDefault();
    e.stopPropagation();
    if ((mode === 'move' || mode === 'resize') && tool !== 'select') return;
    svg.current!.focus();
    svg.current!.setPointerCapture(e.pointerId);
    history.checkpoint();
    const p = point(e);
    drag.current = { start: p, element: target, mode, points: [p], base: design };
    if (target) {
      setSelected(target.id);
      setOperation(target.operation || 'print');
      setVertex(0);
    }
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = point(e),
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
        x: Math.max(0, Math.min(design.width, p.x)),
        y: Math.max(0, Math.min(design.height, p.y)),
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
  async function save() {
    setBusy(true);
    setError('');
    try {
      if (!name.trim()) throw Error('Name the design first.');
      const clean = validateStickerDesign({ ...design, cropToCuts: !fixedCanvas });
      designCutPaths(clean);
      onSave(name.trim(), clean, await renderStickerDesign(clean));
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }
  async function fitCut() {
    if (busy) return;
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
    if (i < 0 || j < 0 || j >= elements.length) return;
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
      <input
        type="number"
        step="0.5"
        min={min}
        value={element?.[key] ?? 0}
        onChange={(e) => {
          const n = e.currentTarget.valueAsNumber;
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
                      update({
                        ...design,
                        elements: design.elements.filter((e) => e.operation !== 'cut'),
                      })
                    }
                  >
                    Use default sheet cut
                  </button>
                </>
              )}
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
              <div className="designer-shapes" aria-label="Shapes">
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
                  <input type="color" value={ink} onInput={(e) => setInk(e.currentTarget.value)} />
                </label>
              </div>
              {element && (
                <section className="sticker-selection">
                  <h3>Selected {element.operation === 'cut' ? 'cut path' : element.kind}</h3>
                  {['shape', 'draw', 'line'].includes(element.kind) && (
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
                  {element.kind === 'draw' && (
                    <>
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
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={
                                element.points![Math.min(vertex, element.points!.length - 1)][
                                  axis
                                ] * 100
                              }
                              onChange={(e) => {
                                const n = e.currentTarget.valueAsNumber;
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
                    </>
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
                          onChange={(e) => patch({ font: e.target.value as DesignElement['font'] })}
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
                  <div className="sticker-dimensions">
                    {number('X (mm)', 'x')}
                    {number('Y (mm)', 'y')}
                    {number('Width (mm)', 'width', 0.1)}
                    {number('Height (mm)', 'height', 0.1)}
                    {number('Rotation (°)', 'rotation', -360)}
                  </div>
                  {element.kind !== 'image' && element.operation !== 'cut' && (
                    <>
                      <label>
                        Fill
                        <input
                          type="color"
                          value={element.fill === 'transparent' ? '#ffffff' : element.fill}
                          onInput={(e) => patch({ fill: e.currentTarget.value })}
                        />
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={element.fill === 'transparent'}
                          onChange={(e) => patch({ fill: e.target.checked ? 'transparent' : ink })}
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
                      onClick={() =>
                        add({
                          ...structuredClone(element),
                          id: crypto.randomUUID(),
                          x: element.x + 2,
                          y: element.y + 2,
                        })
                      }
                    >
                      Duplicate
                    </button>
                    <button className="secondary compact" onClick={remove}>
                      Delete
                    </button>
                  </div>
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
                {design.elements
                  .filter(
                    (e) =>
                      e.operation !== 'cut' || showCuts || operation === 'cut' || e.id === selected,
                  )
                  .sort((a, b) => Number(a.operation === 'cut') - Number(b.operation === 'cut'))
                  .map((e) => (
                    <g
                      key={e.id}
                      transform={elementTransform(e)}
                      opacity={e.operation === 'cut' ? 1 : e.opacity}
                      pointerEvents={
                        e.operation === 'cut' && operation !== 'cut' ? 'none' : undefined
                      }
                      onPointerDown={(event) => {
                        if (tool === 'select') start(event, 'move', e);
                      }}
                      role="button"
                      aria-label={e.kind === 'text' ? `Text: ${e.text}` : e.kind}
                    >
                      {e.kind === 'image' ? (
                        <image
                          href={e.image}
                          width={e.width}
                          height={e.height}
                          preserveAspectRatio="xMidYMid meet"
                        />
                      ) : e.kind === 'text' ? (
                        <text
                          fill={e.fill}
                          fontFamily={e.font}
                          stroke={e.operation === 'cut' ? '#ec268f' : e.stroke}
                          strokeWidth={e.operation === 'cut' ? 1 : e.strokeWidth}
                          vectorEffect={e.operation === 'cut' ? 'non-scaling-stroke' : undefined}
                          strokeDasharray={e.operation === 'cut' ? '4 3' : undefined}
                          paintOrder="stroke fill"
                          fontSize={e.fontSize}
                          fontWeight={e.bold ? 700 : 400}
                          textAnchor={
                            e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'
                          }
                        >
                          {e.text!.split('\n').map((line, i) => (
                            <tspan
                              key={i}
                              x={
                                e.align === 'center'
                                  ? e.width / 2
                                  : e.align === 'right'
                                    ? e.width
                                    : 0
                              }
                              y={e.fontSize! * (1 + i * 1.2)}
                            >
                              {line}
                            </tspan>
                          ))}
                        </text>
                      ) : (
                        <path
                          d={elementPath(e)}
                          fill={
                            e.operation === 'cut'
                              ? 'none'
                              : e.kind === 'shape' || (e.kind === 'draw' && e.closed)
                                ? e.fill
                                : 'none'
                          }
                          stroke={e.operation === 'cut' ? '#ec268f' : e.stroke}
                          strokeWidth={e.operation === 'cut' ? 1 : e.strokeWidth}
                          vectorEffect={e.operation === 'cut' ? 'non-scaling-stroke' : undefined}
                          strokeDasharray={e.operation === 'cut' ? '4 3' : undefined}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}
                      <rect
                        width={e.width}
                        height={e.height}
                        fill="transparent"
                        stroke={selected === e.id ? '#86868b' : 'none'}
                        strokeWidth={1}
                        strokeDasharray="4 3"
                        vectorEffect="non-scaling-stroke"
                        pointerEvents={tool === 'select' ? 'all' : 'none'}
                      />
                      {selected === e.id && (
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
                  ))}
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
              <div className="sticker-dimensions">
                {(['width', 'height'] as const).map((key) => (
                  <label key={key}>
                    {key === 'width' ? 'Width' : 'Height'} (mm)
                    <input
                      type="number"
                      min="10"
                      max="250"
                      disabled={fixedCanvas}
                      value={design[key]}
                      onChange={(e) => {
                        if (Number.isFinite(e.currentTarget.valueAsNumber))
                          update({ ...design, [key]: e.currentTarget.valueAsNumber });
                      }}
                    />
                  </label>
                ))}
              </div>
              <label>
                Background
                <input
                  type="color"
                  value={design.background === 'transparent' ? '#ffffff' : design.background}
                  onInput={(e) => update({ ...design, background: e.currentTarget.value })}
                />
              </label>
              <div hidden={fixedCanvas}>
                <h3>Fit Cut border</h3>
                <div className="sticker-dimensions">
                  <label>
                    Border width (mm)
                    <input
                      type="number"
                      min="0"
                      max="20"
                      step="0.25"
                      value={fitOptions.borderWidth}
                      onChange={(e) =>
                        setFitOptions({ ...fitOptions, borderWidth: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Border stroke (mm)
                    <input
                      type="number"
                      min="0"
                      max="5"
                      step="0.1"
                      value={fitOptions.strokeWidth}
                      onChange={(e) =>
                        setFitOptions({ ...fitOptions, strokeWidth: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
                <label>
                  Border stroke color
                  <input
                    type="color"
                    value={fitOptions.strokeColor}
                    onInput={(e) =>
                      setFitOptions({ ...fitOptions, strokeColor: e.currentTarget.value })
                    }
                  />
                </label>
                <p className="muted">
                  Set the border, then choose Fit Cut to enclose visible artwork with one rounded
                  outline. A stroke of 0 turns the printed border off.
                </p>
              </div>
              <button className="primary" disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving artwork…' : saveLabel}
              </button>
              <p className="muted">
                {fixedCanvas
                  ? 'Card artwork keeps the project’s full card dimensions. Its editable layers are saved with the card.'
                  : 'The sheet crops to your outer cut lines; the full canvas stays editable. Changes update every copy while keeping its scale. Use Fill or Auto arrange to nest shapes.'}
              </p>
              <h3>Layers</h3>
              <p className="muted">Drag layers to reorder them. Top layers print in front.</p>
              <div className="designer-layers" aria-label="Design layers">
                {[...design.elements].reverse().map((e, i) => (
                  <button
                    key={e.id}
                    className={'secondary' + (dropLayer === e.id ? ' layer-drop-target' : '')}
                    draggable
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
                    aria-pressed={selected === e.id}
                    onClick={() => {
                      setSelected(e.id);
                      setOperation(e.operation || 'print');
                      setVertex(0);
                      setTool('select');
                    }}
                  >
                    <GripVertical size={14} aria-hidden="true" />
                    {design.elements.length - i}. {e.operation === 'cut' ? 'Cut · ' : ''}
                    {e.kind === 'text' ? e.text?.slice(0, 24) : e.shape || e.kind}
                  </button>
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
