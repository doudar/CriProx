import { useEffect, useRef } from 'react';
import type { DesignElement, StickerDesign } from '../lib/sticker-design';
import { SHAPES } from '../lib/sticker-design';
import { gradientStops, type Shadow } from '../lib/design-appearance';
import { ScrubbableNumberInput } from './ScrubbableNumberInput';
import { readStickerArtwork } from '../lib/sticker-output';

type Props = {
  element: DesignElement;
  design: StickerDesign;
  patch: (change: Partial<DesignElement>) => void;
  onError: (message: string) => void;
};
export function AppearancePanel({ element: e, design, patch, onError }: Props) {
  const alive = useRef(true);
  const uploadVersion = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const number = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    change: (n: number) => void,
  ) => (
    <label>
      {label}
      <ScrubbableNumberInput value={value} min={min} max={max} step={step} onValueChange={change} />
    </label>
  );
  const color = (label: string, value: string, change: (s: string) => void) => (
    <label>
      {label}
      <input type="color" value={value} onInput={(event) => change(event.currentTarget.value)} />
    </label>
  );
  const fx = e.effects ?? {},
    g = e.gradient,
    texture = e.texture,
    mask = e.mask;
  const setFx = (value: typeof fx) => patch({ effects: value });
  const stops = g ? gradientStops(g) : [];
  const fillable = e.kind === 'shape' || e.kind === 'text' || (e.kind === 'draw' && e.closed);
  const shadow = (s: Shadow, index: number, value: Partial<Shadow>) =>
    setFx({
      ...fx,
      shadows: fx.shadows!.map((old, i) => (i === index ? { ...s, ...value } : old)),
    });
  return (
    <div className="appearance-panel">
      {e.kind === 'text' && (
        <details className="appearance-section">
          <summary>Text on a path {e.textPath ? '· On' : ''}</summary>
          <label>
            Follow shape or polygon
            <select
              value={e.textPath?.pathId ?? ''}
              onChange={(event) =>
                patch({
                  textPath: event.target.value
                    ? {
                        pathId: event.target.value,
                        side: e.textPath?.side ?? 'outer',
                        offset: e.textPath?.offset ?? 50,
                      }
                    : null,
                })
              }
            >
              <option value="">Straight text</option>
              {design.elements
                .filter((path) => path.kind === 'shape' || (path.kind === 'draw' && path.closed))
                .map((path) => (
                  <option key={path.id} value={path.id}>
                    {path.shape ?? 'Polygon'} · {design.elements.indexOf(path) + 1}
                  </option>
                ))}
            </select>
          </label>
          {e.textPath && (
            <>
              <label>
                Placement
                <select
                  value={e.textPath.side}
                  onChange={(event) =>
                    patch({
                      textPath: {
                        ...e.textPath!,
                        side: event.target.value as 'inner' | 'middle' | 'outer',
                      },
                    })
                  }
                >
                  <option value="inner">Inner</option>
                  <option value="middle">Middle</option>
                  <option value="outer">Outer</option>
                </select>
              </label>
              {number('Position on path (%)', e.textPath.offset, 0, 100, 1, (n) =>
                patch({ textPath: { ...e.textPath!, offset: n } }),
              )}
              <p className="muted">
                Text follows the selected outline. Font size and alignment control its fit.
              </p>
            </>
          )}
        </details>
      )}
      {e.operation !== 'cut' && (
        <>
          {fillable && (
            <details className="appearance-section">
              <summary>Gradient {g ? '· On' : ''}</summary>
              <label className="appearance-check">
                <input
                  type="checkbox"
                  checked={!!g}
                  onChange={(event) =>
                    patch({
                      gradient: event.target.checked
                        ? { from: e.fill === 'transparent' ? '#7560cf' : e.fill, to: '#ffffff' }
                        : null,
                    })
                  }
                />{' '}
                Gradient fill
              </label>
              {g && (
                <>
                  <label>
                    Type
                    <select
                      value={g.type ?? 'linear'}
                      onChange={(event) =>
                        patch({
                          gradient: { ...g, type: event.target.value as 'linear' | 'radial' },
                        })
                      }
                    >
                      <option value="linear">Linear</option>
                      <option value="radial">Radial</option>
                    </select>
                  </label>
                  {g.type !== 'radial' ? (
                    number('Angle (°)', g.angle ?? 0, -360, 360, 1, (n) =>
                      patch({ gradient: { ...g, angle: n } }),
                    )
                  ) : (
                    <div className="appearance-grid">
                      {number('Center X (%)', (g.cx ?? 0.5) * 100, 0, 100, 1, (n) =>
                        patch({ gradient: { ...g, cx: n / 100 } }),
                      )}
                      {number('Center Y (%)', (g.cy ?? 0.5) * 100, 0, 100, 1, (n) =>
                        patch({ gradient: { ...g, cy: n / 100 } }),
                      )}
                      {number('Radius (%)', (g.radius ?? 0.5) * 100, 1, 200, 1, (n) =>
                        patch({ gradient: { ...g, radius: n / 100 } }),
                      )}
                    </div>
                  )}
                  {stops.map((stop, i) => (
                    <div className="gradient-stop" key={i}>
                      {color(
                        i === 0
                          ? 'From color'
                          : i === stops.length - 1
                            ? 'To color'
                            : `Stop ${i + 1}`,
                        stop.color,
                        (value) =>
                          patch({
                            gradient: {
                              ...g,
                              stops: stops.map((s, j) => (j === i ? { ...s, color: value } : s)),
                            },
                          }),
                      )}
                      {number(`Position ${i + 1} (%)`, stop.offset * 100, 0, 100, 1, (n) =>
                        patch({
                          gradient: {
                            ...g,
                            stops: stops.map((s, j) => (j === i ? { ...s, offset: n / 100 } : s)),
                          },
                        }),
                      )}
                      {number(`Opacity ${i + 1} (%)`, stop.opacity * 100, 0, 100, 1, (n) =>
                        patch({
                          gradient: {
                            ...g,
                            stops: stops.map((s, j) => (j === i ? { ...s, opacity: n / 100 } : s)),
                          },
                        }),
                      )}
                      <button
                        className="secondary compact"
                        aria-label={`Remove stop ${i + 1}`}
                        disabled={stops.length <= 2}
                        onClick={() =>
                          patch({ gradient: { ...g, stops: stops.filter((_, j) => j !== i) } })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    className="secondary compact"
                    disabled={stops.length >= 16}
                    onClick={() =>
                      patch({
                        gradient: {
                          ...g,
                          stops: [...stops, { offset: 0.5, color: '#ffffff', opacity: 1 }].sort(
                            (a, b) => a.offset - b.offset,
                          ),
                        },
                      })
                    }
                  >
                    Add color stop
                  </button>
                </>
              )}
            </details>
          )}
          <details className="appearance-section">
            <summary>
              Effects {e.effects || (e.blendMode && e.blendMode !== 'normal') ? '· On' : ''}
            </summary>
            <label>
              Blend mode
              <select
                value={e.blendMode ?? 'normal'}
                onChange={(event) =>
                  patch({ blendMode: event.target.value as DesignElement['blendMode'] })
                }
              >
                {['normal', 'multiply', 'screen', 'overlay', 'soft-light'].map((mode) => (
                  <option key={mode} value={mode}>
                    {mode.replace('-', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <div className="appearance-grid">
              {number('Blur (mm)', fx.blur ?? 0, 0, 20, 0.1, (n) => setFx({ ...fx, blur: n }))}
              {number('Background blur (mm)', fx.backgroundBlur ?? 0, 0, 20, 0.1, (n) =>
                setFx({ ...fx, backgroundBlur: n }),
              )}
            </div>
            <p className="muted">
              Background blur softens artwork behind this layer. Use transparent fill to reveal it.
            </p>
            {(fx.shadows ?? []).map((s, i) => (
              <div className="appearance-card" key={i}>
                <label>
                  Shadow {i + 1}
                  <select
                    value={s.type}
                    onChange={(event) =>
                      shadow(s, i, { type: event.target.value as Shadow['type'] })
                    }
                  >
                    <option value="drop">Drop shadow</option>
                    <option value="inner">Inner shadow</option>
                    <option value="glow">Glow</option>
                  </select>
                </label>
                <div className="appearance-grid">
                  {color('Shadow color', s.color, (value) => shadow(s, i, { color: value }))}
                  {number('Shadow opacity (%)', s.opacity * 100, 0, 100, 1, (n) =>
                    shadow(s, i, { opacity: n / 100 }),
                  )}
                  {number('Softness (mm)', s.blur, 0, 20, 0.1, (n) => shadow(s, i, { blur: n }))}
                  {s.type !== 'glow' && (
                    <>
                      {number('Offset X (mm)', s.x, -50, 50, 0.25, (n) => shadow(s, i, { x: n }))}
                      {number('Offset Y (mm)', s.y, -50, 50, 0.25, (n) => shadow(s, i, { y: n }))}
                    </>
                  )}
                </div>
                <button
                  className="secondary compact"
                  onClick={() => setFx({ ...fx, shadows: fx.shadows!.filter((_, j) => j !== i) })}
                >
                  Remove shadow
                </button>
              </div>
            ))}
            <div className="sticker-actions">
              <button
                className="secondary compact"
                disabled={(fx.shadows?.length ?? 0) >= 4}
                onClick={() =>
                  setFx({
                    ...fx,
                    shadows: [
                      ...(fx.shadows ?? []),
                      { type: 'drop', color: '#000000', opacity: 0.35, blur: 1, x: 1, y: 1 },
                    ],
                  })
                }
              >
                Add shadow
              </button>
              <button
                className="secondary compact"
                onClick={() => patch({ effects: null, blendMode: 'normal' })}
              >
                Reset effects
              </button>
            </div>
          </details>
          <details className="appearance-section">
            <summary>Mask & clipping {mask ? '· On' : ''}</summary>
            <label className="appearance-check">
              <input
                type="checkbox"
                checked={!!mask}
                onChange={(event) =>
                  patch({
                    mask: event.target.checked
                      ? { shape: 'ellipse', feather: 0, fade: 'none' }
                      : null,
                  })
                }
              />{' '}
              Clip to shape
            </label>
            {mask && (
              <>
                <label>
                  Mask shape
                  <select
                    value={mask.shape}
                    onChange={(event) =>
                      patch({ mask: { ...mask, shape: event.target.value as typeof mask.shape } })
                    }
                  >
                    {SHAPES.map((shape) => (
                      <option key={shape}>{shape}</option>
                    ))}
                  </select>
                </label>
                {number('Feather (mm)', mask.feather ?? 0, 0, 20, 0.1, (n) =>
                  patch({ mask: { ...mask, feather: n } }),
                )}
                <label>
                  Fade edge
                  <select
                    value={mask.fade ?? 'none'}
                    onChange={(event) =>
                      patch({ mask: { ...mask, fade: event.target.value as typeof mask.fade } })
                    }
                  >
                    {['none', 'left', 'right', 'top', 'bottom', 'radial'].map((fade) => (
                      <option key={fade}>{fade}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </details>
          {fillable && (
            <details className="appearance-section">
              <summary>Texture {texture ? '· On' : ''}</summary>
              <label>
                Texture fill
                <select
                  value={texture?.type ?? 'none'}
                  onChange={(event) =>
                    patch({
                      texture:
                        event.target.value === 'none'
                          ? null
                          : event.target.value === 'image'
                            ? null
                            : {
                                type: event.target.value as 'grain',
                                seed: texture?.seed ?? 1,
                                scale: texture?.scale ?? 1,
                                opacity: texture?.opacity ?? 0.4,
                              },
                    })
                  }
                >
                  {['none', 'grain', 'paper', 'stone', 'metal'].map((t) => (
                    <option key={t} value={t}>
                      {t === 'metal' ? 'Brushed metal' : t}
                    </option>
                  ))}
                  {texture?.type === 'image' && <option value="image">Photo</option>}
                </select>
              </label>
              <label className="appearance-upload">
                Use photo texture
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    const version = ++uploadVersion.current;
                    try {
                      const image = await readStickerArtwork(file);
                      if (!alive.current || version !== uploadVersion.current) return;
                      patch({ texture: { type: 'image', image, seed: 1, scale: 1, opacity: 1 } });
                    } catch (error) {
                      if (alive.current) onError(String(error));
                    }
                  }}
                />
              </label>
              {texture && (
                <div className="appearance-grid">
                  {number('Texture scale', texture.scale, 0.1, 20, 0.1, (n) =>
                    patch({ texture: { ...texture, scale: n } }),
                  )}
                  {number('Texture opacity (%)', texture.opacity * 100, 0, 100, 1, (n) =>
                    patch({ texture: { ...texture, opacity: n / 100 } }),
                  )}
                  {texture.type !== 'image' &&
                    number('Texture seed', texture.seed, 0, 65535, 1, (n) =>
                      patch({ texture: { ...texture, seed: Math.round(n) } }),
                    )}
                </div>
              )}
            </details>
          )}
          {e.kind === 'image' && (
            <details className="appearance-section">
              <summary>Image adjustments {e.adjustments ? '· On' : ''}</summary>
              <div className="appearance-grid">
                {(
                  [
                    ['Exposure', 'exposure', 0, -4, 4, 0.1],
                    ['Contrast', 'contrast', 1, 0, 3, 0.05],
                    ['Saturation', 'saturation', 1, 0, 3, 0.05],
                    ['Temperature', 'temperature', 0, -1, 1, 0.05],
                    ['Sharpen', 'sharpen', 0, 0, 2, 0.1],
                  ] as const
                ).map(([label, key, initial, min, max, step]) => (
                  <div key={key}>
                    {number(label, e.adjustments?.[key] ?? initial, min, max, step, (n) =>
                      patch({ adjustments: { ...e.adjustments, [key]: n } }),
                    )}
                  </div>
                ))}
              </div>
              <button className="secondary compact" onClick={() => patch({ adjustments: null })}>
                Reset adjustments
              </button>
            </details>
          )}
        </>
      )}
      {e.kind === 'draw' && (
        <details className="appearance-section">
          <summary>Curve editing {e.curves ? `· ${e.curves.length} segments` : ''}</summary>
          {!e.curves ? (
            <button
              className="secondary compact"
              disabled={(e.points?.length ?? 0) > 257}
              onClick={() =>
                patch({
                  curves: e.points!.slice(1).map((p, i) => ({
                    c1: {
                      x: e.points![i].x + (p.x - e.points![i].x) / 3,
                      y: e.points![i].y + (p.y - e.points![i].y) / 3,
                    },
                    c2: {
                      x: e.points![i].x + (2 * (p.x - e.points![i].x)) / 3,
                      y: e.points![i].y + (2 * (p.y - e.points![i].y)) / 3,
                    },
                    end: p,
                  })),
                })
              }
            >
              Convert to Bézier curves
            </button>
          ) : (
            <>
              <p className="muted">
                Drag the round points and square handles on the canvas, or enter exact positions
                below.
              </p>
              <div className="appearance-grid">
                {(['x', 'y'] as const).map((axis) => (
                  <div key={axis}>
                    {number(
                      `Start ${axis.toUpperCase()} (%)`,
                      e.points![0][axis] * 100,
                      0,
                      100,
                      1,
                      (n) =>
                        patch({
                          points: e.points!.map((p, i) =>
                            i === 0 ? { ...p, [axis]: n / 100 } : p,
                          ),
                        }),
                    )}
                  </div>
                ))}
              </div>
              {e.curves.map((curve, i) => (
                <details key={i} className="appearance-card">
                  <summary>Segment {i + 1}</summary>
                  <div className="appearance-grid">
                    {(['c1', 'c2', 'end'] as const).flatMap((key) =>
                      (['x', 'y'] as const).map((axis) => (
                        <div key={`${key}-${axis}`}>
                          {number(
                            `${key === 'end' ? 'End' : key === 'c1' ? 'Handle 1' : 'Handle 2'} ${axis.toUpperCase()} (%)`,
                            curve[key][axis] * 100,
                            0,
                            100,
                            1,
                            (n) =>
                              patch({
                                curves: e.curves!.map((c, j) =>
                                  j === i ? { ...c, [key]: { ...c[key], [axis]: n / 100 } } : c,
                                ),
                              }),
                          )}
                        </div>
                      )),
                    )}
                  </div>
                  <button
                    className="secondary compact"
                    disabled={e.curves!.length <= 1}
                    onClick={() => patch({ curves: e.curves!.filter((_, j) => j !== i) })}
                  >
                    Remove segment
                  </button>
                </details>
              ))}
              <button
                className="secondary compact"
                disabled={e.curves.length >= 256}
                onClick={() => {
                  const end = e.curves!.at(-1)!.end;
                  patch({
                    curves: [
                      ...e.curves!,
                      {
                        c1: { x: end.x, y: Math.max(0, end.y - 0.2) },
                        c2: { x: Math.min(1, end.x + 0.2), y: 0.5 },
                        end: { x: Math.min(1, end.x + 0.3), y: 0.7 },
                      },
                    ],
                  });
                }}
              >
                Add segment
              </button>
            </>
          )}
        </details>
      )}
    </div>
  );
}
