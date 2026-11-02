import { MACHINES } from '../lib/machine-guides';
import { useEffect, useId, useState } from 'react';
import type { CardFace, Settings } from '../lib/types';
import { PRINT_DPI_OPTIONS, BACK_OUTER_BLEED_MM, fixedBleedMm } from '../lib/types';
import type { ProjectDefaults, DefaultSettingsGroup } from '../lib/project-defaults';
import { updateDefaultSettings } from '../lib/project-defaults';
import { availableSheetProfiles } from '../lib/paper-workflow';
import { grid } from '../lib/layout';
import FrontBleedControl from './FrontBleedControl';
import UpscalingControls from './UpscalingControls';
import ManualGuideControls from './ManualGuideControls';
import CardBackArtworkControl from './CardBackArtworkControl';

function NumberSetting({
  label,
  value,
  change,
  min,
  max,
  step = 0.25,
  disabled = false,
}: {
  label: string;
  value: number;
  change: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const invalid = !Number.isFinite(value) || value < min || value > max;
  return (
    <div className="setting-group">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        value={Number.isFinite(value) ? value : ''}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        aria-invalid={!disabled && invalid ? true : undefined}
        onChange={(event) => change(event.target.value === '' ? NaN : Number(event.target.value))}
      />
    </div>
  );
}

function Toggle({
  label,
  note,
  value,
  change,
}: {
  label: string;
  note: string;
  value: boolean;
  change: (value: boolean) => void;
}) {
  return (
    <label className="switch-row">
      <span>
        {label}
        <small>{note}</small>
      </span>
      <input type="checkbox" checked={value} onChange={(event) => change(event.target.checked)} />
      <span className="switch" />
    </label>
  );
}

const groups: DefaultSettingsGroup[] = ['Sheet', 'Print', 'Card backs', 'Cut guides', 'Alignment'];

export default function ProjectDefaultsEditor({
  draft,
  change,
  readArtwork,
  working,
  disabled,
  group,
  changeGroup,
}: {
  draft: ProjectDefaults;
  change: (defaults: ProjectDefaults) => void;
  readArtwork: (file: File) => Promise<CardFace>;
  working: (busy: boolean) => void;
  disabled: boolean;
  group: DefaultSettingsGroup;
  changeGroup: (group: DefaultSettingsGroup) => void;
}) {
  const [upscaylAvailable, setUpscaylAvailable] = useState(false);
  const id = useId(),
    s = draft.settings;
  const patch = (patch: Partial<Settings>) =>
    change({ ...draft, settings: updateDefaultSettings(s, patch) });
  useEffect(() => {
    let active = true;
    void window.criprox?.upscayl
      ?.detect()
      .then((installation) => {
        if (active) setUpscaylAvailable(!!installation?.cacheKey);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const select = <K extends keyof Settings>(
    field: K,
    label: string,
    options: { value: Settings[K]; label: string }[],
  ) => (
    <div className="setting-group">
      <label htmlFor={`${id}-${field}`}>{label}</label>
      <select
        id={`${id}-${field}`}
        value={String(s[field])}
        onChange={(event) =>
          patch({
            [field]: typeof s[field] === 'number' ? Number(event.target.value) : event.target.value,
          } as Partial<Settings>)
        }
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <div className="defaults-editor">
      <nav className="defaults-group-nav" aria-label="Default settings groups">
        {groups.map((item) => (
          <button
            key={item}
            type="button"
            aria-current={group === item ? 'page' : undefined}
            onClick={() => changeGroup(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      <fieldset disabled={disabled} className="defaults-editor-fields">
        <section hidden={group !== 'Sheet'} aria-label="Sheet defaults">
          <h4>Sheet setup</h4>
          <p className="defaults-help">
            Choose the paper and cutting layout new projects start with.
          </p>
          <div className="defaults-field-grid">
            {select(
              'machine',
              'Cutting method',
              MACHINES.map(({ id, name }) => ({ value: id, label: name })),
            )}
            {select('paper', 'Paper size', [
              { value: 'letter', label: 'US Letter' },
              { value: 'a4', label: 'A4' },
            ])}
            {select(
              'profile',
              'Sheet layout',
              availableSheetProfiles(s).map((profile) => ({
                value: profile,
                label:
                  profile === 'expanded'
                    ? `${grid({ ...s, profile: 'expanded' }).capacity || 'Custom'} cards · Print and Cut`
                    : profile === 'seven'
                      ? '7 cards · experimental'
                      : profile === 'eight'
                        ? '8 cards · experimental'
                        : s.machine === 'manual'
                          ? '9 cards · manual cutting'
                          : '9 cards · manual alignment',
              })),
            )}
            {select('units', 'Display units', [
              { value: 'in', label: 'Inches' },
              { value: 'mm', label: 'Millimeters' },
            ])}
          </div>
        </section>
        <section hidden={group !== 'Print'} aria-label="Print defaults">
          <h4>Print quality</h4>
          <p className="defaults-help">
            Set resolution, front bleed, and optional image enhancement.
          </p>
          {select(
            'dpi',
            'Print resolution',
            PRINT_DPI_OPTIONS.map((dpi) => ({ value: dpi, label: `${dpi} DPI` })),
          )}
          <p className="defaults-help">
            900 and 1200 DPI use more memory and produce larger files.
          </p>
          <FrontBleedControl settings={s} change={patch} />
          <Toggle
            label="Playtest label"
            note="Add a small label along the bottom edge of each card."
            value={s.proxyLabel}
            change={(value) => patch({ proxyLabel: value })}
          />
          <UpscalingControls
            settings={s}
            change={patch}
            upscaylAvailable={upscaylAvailable}
            disabled={disabled}
            defaults
          />
        </section>
        <section hidden={group !== 'Card backs'} aria-label="Card-back defaults">
          <h4>Card backs</h4>
          <p className="defaults-help">Choose shared artwork and how to print the reverse side.</p>
          <Toggle
            label="Print card backs"
            note="Turning this off keeps your artwork and back settings for later."
            value={s.backsEnabled}
            change={(value) => patch({ backsEnabled: value })}
          />
          <CardBackArtworkControl
            artwork={draft.backArtwork}
            readArtwork={readArtwork}
            working={working}
            disabled={disabled}
            change={(backArtwork) => change({ ...draft, backArtwork })}
          />
          {s.backsEnabled && !draft.backArtwork && (
            <p className="soft-info">
              Single-sided cards need shared artwork before printing backs.
            </p>
          )}
          <div className="defaults-field-grid">
            {select('backPrintMode', 'Printing method', [
              { value: 'manual', label: 'Manual refeed' },
              { value: 'duplex', label: 'Automatic duplex' },
            ])}
            {select('backFlip', 'Paper flip', [
              { value: 'long-edge', label: 'Long edge' },
              { value: 'short-edge', label: 'Short edge' },
            ])}
            {select('backRotation', 'Back orientation', [
              { value: 180, label: 'Rotate 180°' },
              { value: 0, label: 'Keep upright' },
            ])}
          </div>
          <Toggle
            label="Bleed on card backs"
            note={`${fixedBleedMm(s)} mm between cards; ${BACK_OUTER_BLEED_MM} mm at outside edges.`}
            value={s.backBleedEnabled}
            change={(value) => patch({ backBleedEnabled: value })}
          />
        </section>
        <section hidden={group !== 'Cut guides'} aria-label="Cut guide defaults">
          <h4>Manual cut guides</h4>
          <p className="defaults-help">
            These preferences are used for manual cutting. Set them here even if your default
            machine is a Cricut.
          </p>
          <ManualGuideControls mode="defaults" settings={s} change={patch} />
        </section>
        <section hidden={group !== 'Alignment'} aria-label="Alignment defaults">
          <h4>Printer and cut alignment</h4>
          <p className="defaults-help">
            Reuse measured corrections from your print tests. Positive values move right or down;
            negative values move left or up.
          </p>
          <div className="defaults-field-grid">
            {(
              [
                'backOffsetX',
                'backOffsetY',
                'manualCutCorrectionX',
                'manualCutCorrectionY',
              ] as const
            ).map((field) => (
              <NumberSetting
                key={field}
                label={
                  {
                    backOffsetX: 'Back alignment X (mm)',
                    backOffsetY: 'Back alignment Y (mm)',
                    manualCutCorrectionX: 'Manual cut correction X (mm)',
                    manualCutCorrectionY: 'Manual cut correction Y (mm)',
                  }[field]
                }
                value={s[field]}
                min={-5}
                max={5}
                change={(value) => patch({ [field]: value })}
              />
            ))}
          </div>
          <p className="defaults-help">
            Back alignment compensates for a repeatable printer shift. Manual cut corrections shift
            the print relative to the saved Basic Cut template.
          </p>
        </section>
      </fieldset>
    </div>
  );
}
