import { generatedSheetIssue } from '../lib/machine-guides';
import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import {
  generateMarkedPrint,
  generatedPrintBundle,
  type GeneratedPrintResult,
} from '../lib/generated-print';
import { download } from '../lib/export';
import { filenameStem } from '../lib/filenames';
import PdfPagePreview from './PdfPagePreview';
import CutterPanel from './CutterPanel';

export default function GeneratedPrintPanel({
  input,
  active = true,
}: {
  input: Parameters<typeof generateMarkedPrint>[0];
  active?: boolean;
}) {
  const machine = input.kind === 'cards' ? input.project.settings.machine : input.project.machine;
  const sheetIssue = generatedSheetIssue(machine, input.project.settings.paper);
  const [result, setResult] = useState<GeneratedPrintResult>(),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const current = useRef(input.project);
  current.current = input.project;
  useEffect(() => {
    setResult(undefined);
    setError('');
  }, [input.project]);
  async function prepare() {
    const source = input.project;
    setBusy('Generating registration marks…');
    setError('');
    setResult(undefined);
    try {
      const next = await generateMarkedPrint(input, setBusy);
      if (current.current === source) setResult(next);
      else setError('The project changed. Generate the print again for the current layout.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }
  async function save(bundle = false) {
    if (!result) return;
    setBusy('Saving…');
    try {
      const bytes = bundle ? await generatedPrintBundle(result) : result.pdf;
      download(
        new Blob([bytes.slice().buffer], { type: bundle ? 'application/zip' : 'application/pdf' }),
        `${filenameStem(input.project.name)}-generated-marks.${bundle ? 'zip' : 'pdf'}`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="generated-print-panel">
      <h3>Print with Skarix registration marks</h3>
      <p>
        Skarix generates all four black corner marks and the directional arrow, then prints them
        with your artwork. No Design Space capture is needed.
      </p>
      <button className="primary" disabled={!!busy || !!sheetIssue} onClick={() => void prepare()}>
        {busy || 'Prepare print sheets'}
      </button>
      {sheetIssue && <p role="status">{sheetIssue}</p>}
      {error && (
        <p role="alert" className="workflow-error">
          {error}
        </p>
      )}
      {result && (
        <>
          <div className="registration-actions">
            <button className="primary" disabled={!!busy} onClick={() => void save()}>
              <Download size={15} /> Save marked PDF
            </button>
            {result.backPdf && (
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() =>
                  download(
                    new Blob([result.backPdf!.slice().buffer], { type: 'application/pdf' }),
                    `${filenameStem(input.project.name)}-backs.pdf`,
                  )
                }
              >
                Save card backs
              </button>
            )}
            <button className="secondary" disabled={!!busy} onClick={() => void save(true)}>
              Save PDF + matching cut job
            </button>
          </div>
          {result.warnings.map((w) => (
            <p key={w} className="workflow-error">
              {w}
            </p>
          ))}
          <PdfPagePreview
            pdf={result.pdf}
            backPdf={result.backPdf}
            mode={result.mode}
            backFlip={input.kind === 'cards' ? input.project.settings.backFlip : undefined}
          />
        </>
      )}
      <CutterPanel job={result?.job} active={active} machine={machine} />
      <p className="muted">
        Print at 100% / Actual size. Generated sheets have their own matching cut coordinates; an
        unrelated Design Space job may not align. Explore 5 can scan and cut the matching prepared
        job. An Explore 5 USB sticker sheet has been cut successfully at 80 g, one pass.
      </p>
    </section>
  );
}
