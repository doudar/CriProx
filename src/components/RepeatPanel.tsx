import type { DesignElement } from '../lib/sticker-design';
import { DEFAULT_REPEAT } from '../lib/design-repeat';
import type { RepeatPattern } from '../lib/design-appearance';
import { ScrubbableNumberInput } from './ScrubbableNumberInput';

export function RepeatPanel({
  element: e,
  patch,
}: {
  element: DesignElement;
  patch: (change: Partial<DesignElement>) => void;
}) {
  if (e.kind === 'group' || e.operation === 'cut' || e.textPath) return null;
  const r = e.repeat;
  const number = (label: string, key: keyof RepeatPattern, min: number, max: number, step = 1) => (
    <label>
      {label}
      <ScrubbableNumberInput
        value={r![key] as number}
        min={min}
        max={max}
        step={step}
        onValueChange={(value) => patch({ repeat: { ...r!, [key]: value } })}
      />
    </label>
  );
  return (
    <details className="appearance-section">
      <summary>Repeat pattern {r ? `· ${r.count} copies` : ''}</summary>
      <p>
        Copies share this layer’s artwork. Edit once to update every copy. Pattern offsets use this
        layer’s local coordinates.
      </p>
      <label>
        <input
          type="checkbox"
          checked={!!r}
          onChange={(event) =>
            patch({ repeat: event.target.checked ? { ...DEFAULT_REPEAT } : null })
          }
        />{' '}
        Repeat this layer
      </label>
      {r && (
        <>
          <label>
            Arrangement
            <select
              value={r.mode}
              onChange={(event) =>
                patch({ repeat: { ...r, mode: event.target.value as RepeatPattern['mode'] } })
              }
            >
              <option value="grid">Grid</option>
              <option value="radial">Radial</option>
              <option value="scatter">Seeded scatter</option>
            </select>
          </label>
          {number('Copies', 'count', 1, 200)}
          {r.mode === 'grid' && number('Columns', 'columns', 1, 200)}
          {number(
            r.mode === 'grid'
              ? 'Horizontal spacing'
              : r.mode === 'radial'
                ? 'Horizontal radius'
                : 'Scatter width',
            'spacingX',
            -250,
            250,
            0.1,
          )}
          {number(
            r.mode === 'grid'
              ? 'Vertical spacing'
              : r.mode === 'radial'
                ? 'Vertical radius'
                : 'Scatter height',
            'spacingY',
            -250,
            250,
            0.1,
          )}
          {r.mode === 'radial' && number('Angle between copies', 'angle', -360, 360)}
          {number('Seed', 'seed', 0, 65535)}
          {number('Rotation variation', 'rotationJitter', 0, 180)}
          {number('Opacity variation', 'opacityJitter', 0, 1, 0.05)}
          <p>
            At most 200 copies per source and 2,000 rendered layers per design. Keep the pattern
            inside the canvas or cut contour.
          </p>
        </>
      )}
    </details>
  );
}
