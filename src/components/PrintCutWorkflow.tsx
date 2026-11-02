import { MACHINE_NAMES, type Machine } from '../lib/machine-guides';
import { useEffect, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import CutterPanel from './CutterPanel';
import CutSettingsControls from './CutSettingsControls';
import type { CutSettings } from '../lib/cut-settings';
import GeneratedPrintPanel from './GeneratedPrintPanel';
import type { generateMarkedPrint } from '../lib/generated-print';

export default function PrintCutWorkflow({
  kind,
  machine = 'explore-5',
  count,
  paper,
  jobKey,
  onPrepare,
  prepareLabel,
  registered = false,
  generated = false,
  cutSettings,
  onCutSettingsChange,
  generatedInput,
  active = true,
}: {
  kind: 'cards' | 'stickers';
  machine?: Machine;
  count: number;
  paper: string;
  jobKey: string;
  onPrepare: () => void;
  prepareLabel: string;
  registered?: boolean;
  generated?: boolean;
  cutSettings: CutSettings;
  onCutSettingsChange: (patch: Partial<CutSettings>) => void;
  generatedInput?: Parameters<typeof generateMarkedPrint>[0];
  active?: boolean;
}) {
  const [printed, setPrinted] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [opening, setOpening] = useState(false);
  useEffect(() => {
    setPrinted(false);
    setLoaded(false);
  }, [jobKey]);
  async function openDesignSpace() {
    setOpening(true);
    setError('');
    try {
      if (window.criprox?.cutter) await window.criprox.cutter.disconnect();
      if (window.criprox?.cricut) await window.criprox.cricut.open();
      else window.open('https://design.cricut.com', '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  }
  if (generated && generatedInput)
    return (
      <div className="print-cut-workflow">
        <header>
          <p className="eyebrow">{kind === 'cards' ? 'Card' : 'Sticker'} workspace</p>
          <h2>Print then cut</h2>
          <p>
            {MACHINE_NAMES[machine]} · {count} {kind} · {paper === 'a4' ? 'A4' : 'US Letter'}
          </p>
        </header>
        <CutSettingsControls value={cutSettings} onChange={onCutSettingsChange} />
        <GeneratedPrintPanel input={generatedInput} active={active} />
      </div>
    );
  return (
    <div className="print-cut-workflow">
      <header>
        <p className="eyebrow">{kind === 'cards' ? 'Card' : 'Sticker'} workspace</p>
        <h2>Print then cut</h2>
        <p>
          {MACHINE_NAMES[machine]} · {count} {kind} · {paper === 'a4' ? 'A4' : 'US Letter'} · keep
          the same artwork and cut layout from print through cut.
        </p>
      </header>
      <ol className="workflow-steps">
        <li>
          <h3>Prepare the matching print and cut layout</h3>
          {machine !== 'manual' && (
            <CutSettingsControls value={cutSettings} onChange={onCutSettingsChange} />
          )}
          <p>
            {generated
              ? 'Generate the print PDF in Skarix. Its registration marks and the matching cut-job coordinates are created together; no captured template is required.'
              : registered
                ? 'Create a print PDF with the original registration marks included from your captured template, and keep its matching saved Design Space job.'
                : kind === 'cards'
                  ? 'Prepare the manual-cut PDF and matching guide. This layout does not use optical registration; use a trimmer or the matching Basic Cut template with repeatable mat placement.'
                  : 'Export the sheet, then import it into Design Space as a flat Print Then Cut image. Set its exact exported dimensions and print there with its registration marks. The artwork PNG alone is not a registered print sheet.'}
          </p>
          <button className="primary" disabled={!count} onClick={onPrepare}>
            <Download size={16} />
            {prepareLabel}
          </button>
        </li>
        <li>
          <h3>Print at actual size</h3>
          <p>
            Use the chosen paper size, 100% scale, and no “fit to page”.{' '}
            {kind === 'cards' && !registered && !generated
              ? 'Keep the manual cut guides visible and verify finished dimensions.'
              : 'Keep all registration marks and any directional arrow visible. Print from the same job you will cut.'}
          </p>
          <label className="workflow-check">
            <input
              type="checkbox"
              checked={printed}
              onChange={(e) => {
                setPrinted(e.target.checked);
                setLoaded(false);
              }}
            />
            {kind === 'cards' && !registered && !generated
              ? 'I printed this layout at actual size.'
              : 'I printed this layout at actual size with its registration marks.'}
          </label>
        </li>
        <li>
          <h3>Prepare the mat and material</h3>
          <p>
            {generated
              ? 'Keep the printed sheet and its matching cut-job file together. Mat orientation and sensor alignment for generated jobs still need hardware validation.'
              : kind === 'cards' && !registered
                ? 'Follow the manual cut guide for page and template placement. Optical sensors will not align this sheet.'
                : 'Place the sheet as shown by Design Space. For Explore 5 on A4, use landscape mat placement with the printed arrow at the upper left, pointing up.'}{' '}
            Choose the correct material and blade before cutting.
          </p>
          <label className="workflow-check">
            <input
              type="checkbox"
              disabled={!printed}
              checked={loaded}
              onChange={(e) => setLoaded(e.target.checked)}
            />
            The printed sheet and matching saved cut job are ready.
          </label>
        </li>
        <li>
          <h3>Connect and check cut readiness</h3>
          <CutterPanel active={active} />
          {machine !== 'explore-5' && (
            <p>
              Direct connection is currently verified only for Explore 5. Use Design Space to
              connect to your selected {MACHINE_NAMES[machine]}.
            </p>
          )}
          <div className="cut-handoff">
            <strong>
              {generated
                ? 'Generated sheets need their matching prepared Skarix cut job. Direct control is available for Explore 5 on Windows.'
                : 'Registration scanning and cutting currently finish in Design Space.'}
            </strong>
            <p>
              {generated &&
                'Do not substitute an unrelated Design Space mat for a generated Skarix job. '}
              Use Skarix’s prepared sheets for direct registration scanning and cutting. Captured
              Design Space templates still use their saved Design Space job. Opening Design Space
              below releases Skarix’s connection so the two apps do not compete for the cutter.
            </p>
            <button
              className="primary"
              disabled={generated || opening || !printed || !loaded}
              onClick={() => void openDesignSpace()}
            >
              <ExternalLink size={16} />
              {generated
                ? 'Native scan and cut — not yet available'
                : opening
                  ? 'Opening…'
                  : 'Open matching job in Design Space'}
            </button>
            <button
              className="text-button"
              disabled={opening}
              onClick={() => void openDesignSpace()}
            >
              Open Design Space for setup
            </button>
          </div>
        </li>
      </ol>
      {error && (
        <p role="alert" className="workflow-error">
          {error}
        </p>
      )}
    </div>
  );
}
