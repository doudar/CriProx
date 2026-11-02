import { useId } from 'react';
import type { Settings } from '../lib/types';

export default function UpscalingControls({
  settings,
  change,
  upscaylAvailable,
  disabled = false,
  defaults = false,
}: {
  settings: Pick<Settings, 'upscaleScryfall' | 'upscaleBackend'>;
  change: (patch: Partial<Settings>) => void;
  upscaylAvailable: boolean;
  disabled?: boolean;
  defaults?: boolean;
}) {
  const id = useId();
  return (
    <div className="upscaling-controls">
      <label className="switch-row upscale-toggle">
        <span>
          Upscale artwork images (high detail)
          <small>
            Choose 600+ DPI in Sheet setup to retain extra detail; exports can take much longer.
            Review card text before printing.
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.upscaleScryfall}
          disabled={disabled}
          onChange={(event) => change({ upscaleScryfall: event.target.checked })}
        />
        <span className="switch" />
      </label>
      {(defaults || settings.upscaleScryfall) && (
        <label className="upscale-backend" htmlFor={id}>
          Upscaling engine
          <select
            id={id}
            value={settings.upscaleBackend}
            disabled={disabled}
            onChange={(event) =>
              change({ upscaleBackend: event.target.value as Settings['upscaleBackend'] })
            }
          >
            <option value="built-in">Built-in ESRGAN · downloads a ~28 MB model</option>
            <option value="upscayl" disabled={!upscaylAvailable}>
              Upscayl · Ultramix (Non-Commercial), 4×
              {upscaylAvailable ? '' : ' · not detected'}
            </option>
          </select>
        </label>
      )}
      {settings.upscaleScryfall && settings.upscaleBackend === 'upscayl' && !upscaylAvailable && (
        <p className="warning-box" role="status">
          Upscayl is not detected on this device. Install it, choose Built-in ESRGAN, or turn off
          upscaling before preparing a card PDF.
        </p>
      )}
    </div>
  );
}
