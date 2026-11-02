import GeneratedPrintPanel from './GeneratedPrintPanel';
import { useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import {
  CheckCircle2,
  CircleHelp,
  Download,
  FileUp,
  ImagePlus,
  LoaderCircle,
  Ruler,
  Scissors,
  X,
} from 'lucide-react';
import {
  BACK_OUTER_BLEED_MM,
  fixedBleedMm,
  type CardFace,
  type Project,
  type Settings,
} from '../lib/types';
import { formatDimensions, formatMeasurement } from '../lib/units';
import {
  BACK_ALIGNMENT_SQUARE_MM,
  backAlignmentCorrection,
  fullTemplate,
  registrationKey,
  templateId,
  type RegistrationProfile,
} from '../lib/registration';
import { captureProfile, downloadSetup } from '../lib/registered-pdf';
import { preparePdfJob } from '../lib/pdf-worker';
import { download } from '../lib/export';
import { exportFilename, templateFilename, templateFilenameStem } from '../lib/filenames';
import FrontBleedControl from './FrontBleedControl';
import UpscalingControls from './UpscalingControls';
import ArtworkTrimControl from './ArtworkTrimControl';
import PdfPagePreview from './PdfPagePreview';
import PrintSection from './PrintSection';
import { paperWorkflow } from '../lib/paper-workflow';
import { doubleSidedCardCount, needsSharedCardBack } from '../lib/entries';
import { usesMpcTrim } from '../lib/artwork';
import {
  MANUAL_CUT_CALIBRATION_SQUARE_MM,
  MANUAL_CUT_INSET_MM,
  manualCutCorrection,
} from '../lib/manual-cut';
export default function RegisteredPrint({
  project,
  close,
  onCapture,
  openGuide,
  notify,
  updateSettings,
  updateBackArtwork,

  updateBackTrim,
}: {
  project: Project;
  close: () => void;
  onCapture: () => void;
  openGuide: () => void;
  notify: (text: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  updateBackArtwork: (file?: File) => Promise<void>;
  selectBackArtwork: (face: CardFace) => void;
  updateBackTrim: (enabled: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null),
    backInput = useRef<HTMLInputElement>(null),
    pdfAbort = useRef<AbortController | null>(null);
  const [profile, setProfile] = useState<RegistrationProfile>(),
    [busy, setBusy] = useState('Loading template…'),
    [error, setError] = useState(''),
    [upscaylCacheKey, setUpscaylCacheKey] = useState(''),
    [pdfJobRunning, setPdfJobRunning] = useState(false);
  const [pdf, setPdf] = useState<Uint8Array>(),
    [backPdf, setBackPdf] = useState<Uint8Array>(),
    [cutPng, setCutPng] = useState<Uint8Array>(),
    [preparedMode, setPreparedMode] = useState<'front' | 'manual' | 'duplex'>('front'),
    [preparedKind, setPreparedKind] = useState<
      'cards' | 'size' | 'alignment' | 'manual-calibration' | 'manual-nine'
    >('cards');
  const [horizontalSquares, setHorizontalSquares] = useState(0),
    [horizontalDirection, setHorizontalDirection] = useState<'left' | 'right'>('right'),
    [verticalSquares, setVerticalSquares] = useState(0),
    [verticalDirection, setVerticalDirection] = useState<'up' | 'down'>('down'),
    [manualHorizontalSquares, setManualHorizontalSquares] = useState(0),
    [manualHorizontalDirection, setManualHorizontalDirection] = useState<'left' | 'right'>('left'),
    [manualVerticalSquares, setManualVerticalSquares] = useState(0),
    [manualVerticalDirection, setManualVerticalDirection] = useState<'up' | 'down'>('up');
  const manualNine = project.settings.profile === 'nine',
    upscaleScryfall = project.settings.upscaleScryfall,
    upscaleBackend = project.settings.upscaleBackend,
    handCut = project.settings.machine === 'manual',
    key = registrationKey(project.settings),
    hasCapturedTemplate = profile?.key === key,
    full = fullTemplate(project.settings),
    id = templateId(project.settings),
    templateName = templateFilenameStem(project.settings),
    printPaper = paperWorkflow(project.settings),
    doubleSidedCount = doubleSidedCardCount(project.entries),
    sharedBackRequired = needsSharedCardBack(project.entries),
    onlyDoubleSided = doubleSidedCount > 0 && !sharedBackRequired,
    registrationTemplates = window.criprox?.registrationTemplates,
    slotCount = full.placements.length;
  useEffect(() => {
    let active = true;
    void window.criprox?.upscayl
      ?.detect()
      .then((installation) => {
        if (active) setUpscaylCacheKey(installation?.cacheKey || '');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    dialog.current?.showModal();
    if (manualNine) {
      setBusy('');
      return;
    }
    let active = true;
    void (async () => {
      let libraryError: unknown;
      if (registrationTemplates) {
        try {
          const stored = await registrationTemplates.load(id, slotCount, templateName);
          if (stored) {
            const restored = await captureProfile(
              new Uint8Array(stored.pdf),
              project.settings,
              stored.name,
            );
            restored.capturedAt = stored.capturedAt;
            await set(`registration:${key}`, restored).catch(() => {});
            if (active) setProfile(restored);
            return;
          }
        } catch (cause) {
          libraryError = cause;
        }
      }
      try {
        const saved = await get<RegistrationProfile>(`registration:${key}`);
        if (saved?.version === 1 && saved.key === key && saved.pdf instanceof Uint8Array) {
          if (registrationTemplates) {
            try {
              const stored = await registrationTemplates.save(
                id,
                slotCount,
                saved.pdf.slice().buffer,
                templateName,
              );
              saved.name = stored.name;
              libraryError = undefined;
            } catch (cause) {
              libraryError = cause;
            }
          }
          if (active) {
            setProfile(saved);
            if (libraryError)
              setError(
                'The template is available in local app storage, but Skarix could not copy it to the project library root.',
              );
          }
        } else if (active && libraryError) {
          setError(
            'Could not load the saved template from the project library. Import the original Design Space PDF again.',
          );
        }
      } catch {
        if (active)
          setError('Could not load a saved template. Import the original Design Space PDF again.');
      }
    })().finally(() => {
      if (active) setBusy('');
    });
    return () => {
      active = false;
    };
  }, [key, manualNine]);
  async function setup() {
    setBusy('Creating setup image…');
    setError('');
    try {
      await downloadSetup(project.settings);
      notify('Setup PNG downloaded. Upload it once in Design Space.');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy('');
    }
  }
  async function capture(file?: File) {
    if (!file) return;
    setBusy('Checking page size and cut slots…');
    setError('');
    setPdf(undefined);
    setBackPdf(undefined);
    try {
      if (file.size > 25_000_000) throw new Error('Use a template PDF under 25 MB.');
      const next = await captureProfile(
        new Uint8Array(await file.arrayBuffer()),
        project.settings,
        file.name,
      );
      if (registrationTemplates) {
        const stored = await registrationTemplates.save(
          id,
          slotCount,
          next.pdf.slice().buffer,
          templateName,
        );
        next.name = stored.name;
        next.capturedAt = stored.capturedAt;
        await set(`registration:${key}`, next).catch(() => {});
      } else {
        await set(`registration:${key}`, next);
      }
      setProfile(next);
      onCapture();
      notify(
        registrationTemplates
          ? 'Template captured and saved in the Skarix project library. Run a test cut before printing a full deck.'
          : 'Template captured. Run a test cut before printing a full deck.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this PDF.');
    } finally {
      setBusy('');
      if (input.current) input.current.value = '';
    }
  }
  async function prepare(calibration: boolean) {
    if (!profile) return;
    if (!calibration && upscaleScryfall && upscaleBackend === 'upscayl' && !upscaylCacheKey) {
      setError('Upscayl is not detected. Choose Built-in ESRGAN or turn off upscaling.');
      return;
    }
    const controller = new AbortController();
    pdfAbort.current = controller;
    setPdfJobRunning(true);
    setBusy('Building registered pages…');
    setError('');
    setPdf(undefined);
    setBackPdf(undefined);
    try {
      const result = await preparePdfJob(
        {
          kind: 'registered',
          project,
          profile,
          calibration,
          upscaleScryfall,
          upscaleBackend,
          upscaylCacheKey,
        },
        setBusy,
        controller.signal,
      );
      setPdf(result.pdf);
      setBackPdf(result.backPdf);
      setPreparedMode(result.mode);
      setPreparedKind(calibration ? 'size' : 'cards');
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setError(e instanceof Error ? e.message : 'Could not generate registered pages.');
    } finally {
      pdfAbort.current = null;
      setPdfJobRunning(false);
      setBusy('');
    }
  }
  async function prepareManualCut() {
    if (upscaleScryfall && upscaleBackend === 'upscayl' && !upscaylCacheKey) {
      setError('Upscayl is not detected. Choose Built-in ESRGAN or turn off upscaling.');
      return;
    }
    const controller = new AbortController();
    pdfAbort.current = controller;
    setPdfJobRunning(true);
    setBusy('Building manual cut files…');
    setError('');
    setPdf(undefined);
    setBackPdf(undefined);
    setCutPng(undefined);
    try {
      const result = await preparePdfJob(
        { kind: 'manual-nine', project, upscaleScryfall, upscaleBackend, upscaylCacheKey },
        setBusy,
        controller.signal,
      );
      setPdf(result.pdf);
      setBackPdf(result.backPdf);
      setCutPng(result.cutPng);
      setPreparedMode(result.mode);
      setPreparedKind('manual-nine');
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setError(e instanceof Error ? e.message : 'Could not generate the manual cut files.');
    } finally {
      pdfAbort.current = null;
      setPdfJobRunning(false);
      setBusy('');
    }
  }
  async function prepareManualCalibration() {
    setBusy('Building manual cut calibration sheet…');
    setError('');
    setPdf(undefined);
    setBackPdf(undefined);
    setCutPng(undefined);
    try {
      const result = await preparePdfJob({ kind: 'manual-calibration', project }, setBusy);
      setPdf(result.pdf);
      setPreparedMode('front');
      setPreparedKind('manual-calibration');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate the calibration sheet.');
    } finally {
      setBusy('');
    }
  }
  async function prepareAlignment() {
    setBusy('Building front-to-back alignment pages…');
    setError('');
    setPdf(undefined);
    setBackPdf(undefined);
    try {
      const result = await preparePdfJob({ kind: 'alignment', project }, setBusy);
      setPdf(result.pdf);
      setBackPdf(result.backPdf);
      setPreparedMode(result.mode);
      setPreparedKind('alignment');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the alignment test.');
    } finally {
      setBusy('');
    }
  }
  function applyAlignment() {
    const correction = backAlignmentCorrection(
        horizontalSquares,
        horizontalDirection,
        verticalSquares,
        verticalDirection,
      ),
      backOffsetX = project.settings.backOffsetX + correction.x,
      backOffsetY = project.settings.backOffsetY + correction.y;
    if (Math.abs(backOffsetX) > 5 || Math.abs(backOffsetY) > 5) {
      setError('The measured correction exceeds the supported 5 mm alignment range.');
      return;
    }
    changePrintSettings({ backOffsetX, backOffsetY });
    setHorizontalSquares(0);
    setVerticalSquares(0);
    notify(
      `Back alignment updated to X ${backOffsetX >= 0 ? '+' : ''}${formatMeasurement(backOffsetX, project.settings.units)}, Y ${backOffsetY >= 0 ? '+' : ''}${formatMeasurement(backOffsetY, project.settings.units)}.`,
    );
  }
  function applyManualCalibration() {
    const correction = manualCutCorrection(
        manualHorizontalSquares,
        manualHorizontalDirection,
        manualVerticalSquares,
        manualVerticalDirection,
      ),
      manualCutCorrectionX = project.settings.manualCutCorrectionX + correction.x,
      manualCutCorrectionY = project.settings.manualCutCorrectionY + correction.y;
    if (Math.abs(manualCutCorrectionX) > 5 || Math.abs(manualCutCorrectionY) > 5) {
      setError('The measured correction exceeds the supported 5 mm calibration range.');
      return;
    }
    changePrintSettings({ manualCutCorrectionX, manualCutCorrectionY });
    setManualHorizontalSquares(0);
    setManualVerticalSquares(0);
    notify(
      `Manual cut calibration updated to X ${offsetDescription(manualCutCorrectionX, true)}, Y ${offsetDescription(manualCutCorrectionY, false)}.`,
    );
  }
  function offsetDescription(value: number, horizontal: boolean) {
    if (Math.abs(value) < 0.001) return 'centered';
    return `${formatMeasurement(Math.abs(value), project.settings.units)} ${
      horizontal ? (value < 0 ? 'left' : 'right') : value < 0 ? 'up' : 'down'
    }`;
  }
  function changePrintSettings(patch: Partial<Settings>) {
    setPdf(undefined);
    setBackPdf(undefined);
    setCutPng(undefined);
    updateSettings(patch);
  }
  async function uploadBack(file?: File) {
    if (!file) return;
    setBusy('Reading card-back artwork…');
    setError('');
    setPdf(undefined);
    setBackPdf(undefined);
    try {
      await updateBackArtwork(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read card-back artwork.');
    } finally {
      setBusy('');
      if (backInput.current) backInput.current.value = '';
    }
  }

  function changeBackTrim(enabled: boolean) {
    setPdf(undefined);
    setBackPdf(undefined);
    updateBackTrim(enabled);
  }
  function savePdf(bytes: Uint8Array | undefined, suffix: string) {
    if (!bytes) return;
    download(
      new Blob([bytes.slice().buffer], { type: 'application/pdf' }),
      exportFilename(project, suffix, 'pdf'),
    );
  }
  function saveCutPng() {
    if (!cutPng) return;
    download(
      new Blob([cutPng.slice().buffer], { type: 'image/png' }),
      templateFilename(project.settings, 'basic-cut', 'png'),
    );
  }
  return (
    <dialog
      ref={dialog}
      className="modal wide registered-modal"
      aria-labelledby="registered-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="modal-heading">
        <div>
          <div className="registration-tag">
            {manualNine
              ? handCut
                ? 'MANUAL CUTTING'
                : 'MANUAL MAT ALIGNMENT · EXPERIMENTAL'
              : 'REUSABLE TEMPLATE · EXPERIMENTAL'}
          </div>
          <h2 id="registered-title">
            {manualNine
              ? handCut
                ? 'Create 9-card cutting sheet'
                : 'Create manual 9-card cut'
              : 'Create registered print PDF'}
          </h2>
          <p>
            {manualNine
              ? handCut
                ? 'Print nine cards per page with guides that reach the paper edges.'
                : 'Print nine cards per page, then align the matching Basic Cut template on your mat.'
              : 'Capture Cricut’s marks once, then save full-quality PDFs for printing.'}
          </p>
          {!manualNine && (
            <div className="registered-guide-hint">
              <CircleHelp size={14} />
              <span>
                Need a hand?{' '}
                <button className="text-button" disabled={!!busy} onClick={openGuide}>
                  Open the How To guide
                </button>{' '}
                for step-by-step video guidance.
              </span>
            </div>
          )}
        </div>
        <button
          className="icon-button"
          aria-label={manualNine ? 'Close manual cutting' : 'Close registered printing'}
          disabled={!!busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <div className="registered-content">
        <div className="registration-summary">
          <div>
            <strong>{manualNine ? '9-card cutting sheet' : 'Print with registration marks'}</strong>
            <span>
              {full.placements.length} fixed slots ·{' '}
              {project.settings.paper === 'letter' ? 'US Letter' : 'A4'} ·{' '}
              {formatDimensions(
                project.settings.width,
                project.settings.height,
                project.settings.units,
              )}{' '}
              cards
            </span>
          </div>
          <span className="mini-badge">
            {handCut
              ? 'MANUAL'
              : project.settings.machine === 'maker'
                ? 'MAKER'
                : project.settings.machine === 'explore-5'
                  ? 'EXPLORE 5'
                  : project.settings.machine === 'explore'
                    ? 'EXPLORE'
                    : 'JOY XTRA'}
          </span>
        </div>
        <PrintSection
          key={`${key}:options`}
          layoutKey={key}
          section="options"
          title="Print options"
          summary={`${project.settings.dpi} DPI · front bleed ${project.settings.bleed > 0 ? 'on' : 'off'} · upscale ${upscaleScryfall ? 'on' : 'off'}`}
          version={JSON.stringify([
            project.settings.dpi,
            project.settings.bleed,
            upscaleScryfall,
            upscaleBackend,
          ])}
          busy={!!busy}
        >
          <div className="registration-preferences">
            <div>
              <label>Display units</label>
              <div className="segmented unit-toggle" aria-label="Registered print display units">
                <button
                  className={project.settings.units === 'in' ? 'selected' : ''}
                  onClick={() => changePrintSettings({ units: 'in' })}
                >
                  Inches
                </button>
                <button
                  className={project.settings.units === 'mm' ? 'selected' : ''}
                  onClick={() => changePrintSettings({ units: 'mm' })}
                >
                  Millimeters
                </button>
              </div>
            </div>
            <FrontBleedControl settings={project.settings} change={changePrintSettings} />
          </div>
          <UpscalingControls
            settings={project.settings}
            change={changePrintSettings}
            upscaylAvailable={!!upscaylCacheKey}
            disabled={!!busy}
          />
        </PrintSection>
        <PrintSection
          key={`${key}:backs`}
          layoutKey={key}
          section="backs"
          title="Card backs"
          summary={
            project.settings.backsEnabled
              ? sharedBackRequired && !project.backArtwork
                ? 'Add shared card-back artwork to continue'
                : `${project.settings.backPrintMode === 'manual' ? 'Manual refeed' : 'Automatic duplex'} · back bleed ${project.settings.backBleedEnabled ? 'on' : 'off'}`
              : `Fronts only${doubleSidedCount ? ` · ${doubleSidedCount} double-sided cards` : ''}`
          }
          version={JSON.stringify([
            project.settings.backsEnabled,
            project.settings.backPrintMode,
            project.settings.backBleedEnabled,
            project.settings.backFlip,
            project.settings.backRotation,
            project.settings.backOffsetX,
            project.settings.backOffsetY,
            sharedBackRequired,
            doubleSidedCount > 0,
            project.backArtwork?.image,
            project.backArtwork?.trim,
          ])}
          canComplete={
            !project.settings.backsEnabled || !sharedBackRequired || !!project.backArtwork
          }
          busy={!!busy}
        >
          <div className={`back-print-panel ${project.settings.backsEnabled ? 'enabled' : ''}`}>
            <label className="switch-row back-toggle">
              <span>
                Print card backs
                <small>Use Settings to save this choice for new projects</small>
              </span>
              <input
                type="checkbox"
                checked={project.settings.backsEnabled}
                onChange={(event) => changePrintSettings({ backsEnabled: event.target.checked })}
              />
              <span className="switch" />
            </label>
            {doubleSidedCount > 0 && (
              <div className="warning-box double-sided-warning" role="status">
                {doubleSidedCount} double-sided card{doubleSidedCount === 1 ? '' : 's'} selected.{' '}
                {project.settings.backsEnabled
                  ? 'Matching reverse faces will print automatically in their mirrored back positions.'
                  : 'Turn on Print card backs to include their matching reverse faces.'}
              </div>
            )}
            {project.settings.backsEnabled && (
              <div className="back-options">
                {!onlyDoubleSided ? (
                  <>
                    <div className="back-artwork-control">
                      {project.backArtwork ? (
                        <span
                          className={`back-artwork-preview ${
                            project.settings.backRotation === 180 ? 'back-art-rotated' : ''
                          }`}
                        >
                          <img
                            className={
                              usesMpcTrim(project.backArtwork) ? 'mpc-source-art' : undefined
                            }
                            src={project.backArtwork.preview}
                            alt="Selected shared card-back artwork"
                          />
                        </span>
                      ) : (
                        <div className="back-art-placeholder">
                          <ImagePlus size={22} />
                          <span>No back art</span>
                        </div>
                      )}
                      <div>
                        <strong>
                          {project.backArtwork
                            ? 'Shared card-back artwork ready'
                            : 'Add shared card-back artwork'}
                        </strong>
                        <small>
                          Used for single-sided cards only; double-sided cards use their reverse
                          face.
                        </small>
                        <button
                          className="secondary"
                          disabled={!!busy}
                          onClick={() => backInput.current?.click()}
                        >
                          <ImagePlus size={14} />
                          {project.backArtwork ? 'Replace artwork' : 'Upload artwork'}
                        </button>
                      </div>
                    </div>
                    {project.backArtwork && (
                      <ArtworkTrimControl face={project.backArtwork} change={changeBackTrim} />
                    )}
                  </>
                ) : (
                  <div className="soft-info double-sided-back-ready">
                    <CheckCircle2 size={18} />
                    <span>
                      Every selected card is double-sided, so no shared card-back artwork is needed.
                      Each card’s opposite face will be used.
                    </span>
                  </div>
                )}
                <label className="switch-row back-bleed-toggle">
                  <span>
                    Bleed on card backs
                    <small>
                      {project.settings.backBleedEnabled ? 'On' : 'Off'} ·{' '}
                      {formatMeasurement(fixedBleedMm(project.settings), project.settings.units)}{' '}
                      between cards,{' '}
                      {formatMeasurement(BACK_OUTER_BLEED_MM, project.settings.units)} on outside
                      edges
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={project.settings.backBleedEnabled}
                    onChange={(event) =>
                      changePrintSettings({ backBleedEnabled: event.target.checked })
                    }
                  />
                  <span className="switch" />
                </label>
                <div className="back-fields">
                  <label>
                    Printing method
                    <select
                      value={project.settings.backPrintMode}
                      onChange={(event) => {
                        const backPrintMode = event.target.value as Settings['backPrintMode'];
                        changePrintSettings({
                          backPrintMode,
                          backRotation: backPrintMode === 'manual' ? 180 : 0,
                        });
                      }}
                    >
                      <option value="manual">Manual refeed · default</option>
                      <option value="duplex">Automatic duplex printer</option>
                    </select>
                  </label>
                  <label>
                    Paper flip
                    <select
                      value={project.settings.backFlip}
                      onChange={(event) =>
                        changePrintSettings({
                          backFlip: event.target.value as Settings['backFlip'],
                        })
                      }
                    >
                      <option value="long-edge">Flip on long edge</option>
                      <option value="short-edge">Flip on short edge</option>
                    </select>
                  </label>
                  <label>
                    Back orientation
                    <select
                      value={project.settings.backRotation}
                      onChange={(event) =>
                        changePrintSettings({
                          backRotation: Number(event.target.value) as Settings['backRotation'],
                        })
                      }
                    >
                      <option value="180">Rotate 180° · manual refeed</option>
                      <option value="0">Keep artwork upright</option>
                    </select>
                  </label>
                </div>
                <div className="back-offsets">
                  {(['backOffsetX', 'backOffsetY'] as const).map((axis) => (
                    <label key={axis}>
                      <span>
                        {axis === 'backOffsetX' ? 'Back alignment X' : 'Back alignment Y'}
                        <strong>
                          {project.settings[axis] > 0 ? '+' : ''}
                          {formatMeasurement(project.settings[axis], project.settings.units)}
                        </strong>
                      </span>
                      <input
                        type="range"
                        min="-5"
                        max="5"
                        step="0.25"
                        value={project.settings[axis]}
                        onChange={(event) =>
                          changePrintSettings({ [axis]: Number(event.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="back-alignment-tool">
                  <div>
                    <strong>Front-to-back alignment test</strong>
                    <p>
                      Print the front target on plain paper, refeed the same sheet, and print the
                      back target. Hold it to a light with the <strong>back side facing you</strong>
                      . The arrows confirm orientation; each small grid square is{' '}
                      {BACK_ALIGNMENT_SQUARE_MM} mm.
                    </p>
                  </div>
                  <button className="secondary" disabled={!!busy} onClick={prepareAlignment}>
                    <Ruler size={15} /> Prepare alignment test
                  </button>
                  <div className="alignment-measurements">
                    <label>
                      <span>Magenta back grid is</span>
                      <select
                        aria-label="Horizontal alignment squares"
                        value={horizontalSquares}
                        onChange={(event) => setHorizontalSquares(Number(event.target.value))}
                      >
                        {Array.from({ length: 11 }, (_, index) => index / 2).map((value) => (
                          <option key={value} value={value}>
                            {value} square{value === 1 ? '' : 's'}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Horizontal alignment direction"
                        value={horizontalDirection}
                        onChange={(event) =>
                          setHorizontalDirection(event.target.value as 'left' | 'right')
                        }
                      >
                        <option value="left">left</option>
                        <option value="right">right</option>
                      </select>
                      <span>of the dark grid</span>
                    </label>
                    <label>
                      <span>Magenta back grid is</span>
                      <select
                        aria-label="Vertical alignment squares"
                        value={verticalSquares}
                        onChange={(event) => setVerticalSquares(Number(event.target.value))}
                      >
                        {Array.from({ length: 11 }, (_, index) => index / 2).map((value) => (
                          <option key={value} value={value}>
                            {value} square{value === 1 ? '' : 's'}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Vertical alignment direction"
                        value={verticalDirection}
                        onChange={(event) =>
                          setVerticalDirection(event.target.value as 'up' | 'down')
                        }
                      >
                        <option value="up">above</option>
                        <option value="down">below</option>
                      </select>
                      <span>the dark grid</span>
                    </label>
                  </div>
                  <button
                    className="primary apply-alignment"
                    disabled={!!busy || (!horizontalSquares && !verticalSquares)}
                    onClick={applyAlignment}
                  >
                    Apply measured correction
                  </button>
                  <div className="alignment-offset-summary">
                    <div
                      className="alignment-offset-visual"
                      aria-label={`Current back compensation: ${offsetDescription(project.settings.backOffsetX, true)} and ${offsetDescription(project.settings.backOffsetY, false)}`}
                    >
                      <span className="alignment-target front-target" />
                      <span
                        className="alignment-target back-target"
                        style={{
                          left: `calc(50% + ${project.settings.backOffsetX * 5}px)`,
                          top: `calc(50% + ${project.settings.backOffsetY * 5}px)`,
                        }}
                      />
                    </div>
                    <div>
                      <strong>Current back compensation</strong>
                      <span>
                        X: {offsetDescription(project.settings.backOffsetX, true)} · Y:{' '}
                        {offsetDescription(project.settings.backOffsetY, false)}
                      </span>
                      <small>
                        Prepare a fresh test after applying. Measurements reset to prevent applying
                        the same correction twice.
                      </small>
                    </div>
                  </div>
                </div>
                <p className="back-help">
                  {project.settings.backPrintMode === 'manual'
                    ? 'Skarix will make separate front and back PDFs. Print the fronts, refeed the same sheets, then print the backs.'
                    : `Skarix will alternate front and back pages. Enable duplex and ${project.settings.backFlip === 'long-edge' ? 'long-edge' : 'short-edge'} binding in the printer dialog.`}{' '}
                  Back pages contain artwork only—no registration marks or cut lines. The front and
                  back bleed settings apply independently. Double-sided cards use the opposite face
                  from the selected front; the shared back applies only to single-sided cards. Back
                  orientation rotates the artwork only; it does not move the cards or change the
                  front cut positions.
                </p>
              </div>
            )}
          </div>
        </PrintSection>
        {manualNine && handCut ? (
          <>
            <div className="manual-cut-banner">
              <Scissors size={28} />
              <div>
                <strong>Manual guides matched to your editor preview.</strong>
                <span>
                  Set the card and page guide colors, width, card corners, and page marks in the
                  sheet editor before preparing the PDF. The preview and front PDF use the same
                  guide positions. The final sheet marks only occupied card slots. Back sheets have
                  no cut guides.
                </span>
              </div>
            </div>
            <PrintSection
              key={`${key}:reminders`}
              layoutKey={key}
              section="reminders"
              title="Printing and cutting reminders"
              summary="100% / Actual size · follow the selected cut guides"
              busy={!!busy}
            >
              <div className="registration-step">
                <div>
                  <h3>Print at actual size and cut</h3>
                  <p>
                    Print the saved PDF in portrait at <strong>100% / Actual size</strong> with fit
                    and shrink disabled. Check one card with a ruler. Follow the selected guides to
                    trim the cards; page-edge marks let you align a straight cutter at both ends of
                    a cut. Round the corners with a corner punch if desired.
                  </p>
                </div>
              </div>
            </PrintSection>
            <div className="registration-step">
              <span className="step-number">1</span>
              <div>
                <h3>Prepare and review the sheets</h3>
                <p>
                  Skarix creates portrait {printPaper.systemPaper} print pages with a fixed 3 × 3
                  layout. Review each page before saving the PDF.
                </p>
                <button
                  className="primary"
                  disabled={
                    !!busy ||
                    !project.entries.length ||
                    (project.settings.backsEnabled && sharedBackRequired && !project.backArtwork)
                  }
                  onClick={prepareManualCut}
                >
                  Prepare 9-card PDF
                </button>
              </div>
            </div>
          </>
        ) : manualNine ? (
          <>
            <div className="manual-cut-banner">
              <Scissors size={28} />
              <div>
                <strong>One coordinate system, two matched files.</strong>
                <span>
                  The print PDF and Basic Cut PNG share the same 3 × 3 geometry. The Basic Cut stays
                  at the first {formatMeasurement(MANUAL_CUT_INSET_MM, project.settings.units)} mat
                  inset; calibration shifts only the printed artwork.
                </span>
              </div>
            </div>
            <PrintSection
              key={`${key}:calibration`}
              layoutKey={key}
              section="calibration"
              title="Physical cut calibration"
              summary={`X ${offsetDescription(project.settings.manualCutCorrectionX, true)} · Y ${offsetDescription(project.settings.manualCutCorrectionY, false)}`}
              version={JSON.stringify([
                project.settings.manualCutCorrectionX,
                project.settings.manualCutCorrectionY,
              ])}
              busy={!!busy}
            >
              <div className="manual-cut-calibration">
                <div className="manual-cut-calibration-heading">
                  <div>
                    <p>
                      Print and cut the measured target at least twice using the same
                      paper-placement and mat-loading method. If both runs agree, enter the square
                      counts below. If they differ, the loading is not repeatable and one saved
                      correction cannot fix it. The target and card sheets use the same raster,
                      bleed, and PDF placement path; the Basic Cut PNG stays unchanged.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    disabled={
                      !project.settings.manualCutCorrectionX &&
                      !project.settings.manualCutCorrectionY
                    }
                    onClick={() =>
                      changePrintSettings({ manualCutCorrectionX: 0, manualCutCorrectionY: 0 })
                    }
                  >
                    Reset
                  </button>
                </div>
                <button
                  className="secondary manual-calibration-download"
                  disabled={!!busy}
                  onClick={prepareManualCalibration}
                >
                  <Ruler size={15} /> Prepare 1 mm calibration sheet
                </button>
                <div className="manual-calibration-measurements alignment-measurements">
                  <label>
                    <span>Cut line is</span>
                    <select
                      aria-label="Manual horizontal calibration squares"
                      value={manualHorizontalSquares}
                      onChange={(event) => setManualHorizontalSquares(Number(event.target.value))}
                    >
                      {Array.from({ length: 11 }, (_, index) => index / 2).map((value) => (
                        <option key={value} value={value}>
                          {value} square{value === 1 ? '' : 's'}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Manual horizontal calibration direction"
                      value={manualHorizontalDirection}
                      onChange={(event) =>
                        setManualHorizontalDirection(event.target.value as 'left' | 'right')
                      }
                    >
                      <option value="left">left</option>
                      <option value="right">right</option>
                    </select>
                    <span>of the dark left edge</span>
                  </label>
                  <label>
                    <span>Cut line is</span>
                    <select
                      aria-label="Manual vertical calibration squares"
                      value={manualVerticalSquares}
                      onChange={(event) => setManualVerticalSquares(Number(event.target.value))}
                    >
                      {Array.from({ length: 11 }, (_, index) => index / 2).map((value) => (
                        <option key={value} value={value}>
                          {value} square{value === 1 ? '' : 's'}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Manual vertical calibration direction"
                      value={manualVerticalDirection}
                      onChange={(event) =>
                        setManualVerticalDirection(event.target.value as 'up' | 'down')
                      }
                    >
                      <option value="up">above</option>
                      <option value="down">below</option>
                    </select>
                    <span>the dark top edge</span>
                  </label>
                </div>
                <button
                  className="primary apply-alignment"
                  disabled={!!busy || (!manualHorizontalSquares && !manualVerticalSquares)}
                  onClick={applyManualCalibration}
                >
                  Apply measured correction
                </button>
                <p className="manual-cut-calibration-note">
                  Current correction: X{' '}
                  {offsetDescription(project.settings.manualCutCorrectionX, true)} · Y{' '}
                  {offsetDescription(project.settings.manualCutCorrectionY, false)}. Each square is{' '}
                  {MANUAL_CUT_CALIBRATION_SQUARE_MM} mm. Measurements reset after applying so the
                  same correction is not added twice.
                </p>
              </div>
            </PrintSection>
            <PrintSection
              key={`${key}:reminders`}
              layoutKey={key}
              section="reminders"
              title="Printing and cutting reminders"
              summary="100% / Actual size · reuse the matching Basic Cut PNG"
              busy={!!busy}
            >
              <div className="registration-step">
                <div>
                  <h3>Print the PDF at actual size</h3>
                  <p>
                    Open the saved PDF in a dedicated PDF application. Print on{' '}
                    <strong>{printPaper.systemPaper}</strong> in portrait orientation at{' '}
                    <strong>100% / Actual size</strong>, with fit, shrink, headers, and margins
                    disabled. Place the printed page flush with the upper-left corner of the mat’s
                    adhesive grid.
                  </p>
                </div>
              </div>
              <div className="registration-step">
                <div>
                  <h3>Upload and position the Basic Cut PNG</h3>
                  <p>
                    Upload the PNG to Design Space as <strong>Basic Cut</strong>, not Print Then
                    Cut. Set it to exactly{' '}
                    <strong>
                      {formatDimensions(full.width, full.height, project.settings.units)}
                    </strong>{' '}
                    and keep all nine shapes together. Choose <strong>On Mat</strong>. In the
                    Prepare preview, keep the group upright with its top-left at the first 0.25 in
                    grid inset; do not center, mirror, rearrange, or auto-resize it. Run a
                    plain-paper test before using card stock.
                  </p>
                </div>
              </div>
              <div className="soft-info">
                <Ruler size={18} />
                <span>
                  Manual alignment does not use Cricut sensor marks. A straight paper edge, fresh
                  mat, consistent upper-left placement, and a measured test are required. SnapMat on
                  iOS can help position the cut over the photographed sheet, but it does not replace
                  a physical test.
                </span>
              </div>
              <p className="guide-limit">
                This workflow deliberately bypasses Print Then Cut’s optical registration. Printer
                scaling, paper placement, mat loading, and cutter repeatability can shift the
                result. Skarix matches the source geometry but cannot guarantee perfect physical
                alignment. Keep the saved Design Space project and mat arrangement unchanged after
                validation.
              </p>
            </PrintSection>
            <div className="registration-step">
              <span className="step-number">1</span>
              <div>
                <h3>Prepare the matched print and cut files</h3>
                <p>
                  Skarix creates a full-quality {printPaper.systemPaper} PDF and one transparent
                  nine-slot PNG. Every PDF page keeps all nine positions, so the same cut template
                  works for the entire deck. Your physical calibration is applied to the PDF only;
                  blank positions on the last page will still be cut.
                </p>
                <button
                  className="primary"
                  disabled={
                    !!busy ||
                    !project.entries.length ||
                    (project.settings.backsEnabled && sharedBackRequired && !project.backArtwork)
                  }
                  onClick={prepareManualCut}
                >
                  Prepare 9-card files
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <GeneratedPrintPanel input={{ kind: 'cards', project }} />
            <details className="captured-print-alternative">
              <summary>Reuse a captured Design Space job (optional)</summary>
              <PrintSection
                key={`${key}:setup`}
                layoutKey={key}
                section="setup"
                title="1 · Create your reusable cut job"
                summary={
                  hasCapturedTemplate
                    ? 'Saved cut job matched to the captured template'
                    : `${formatDimensions(full.width, full.height, project.settings.units)} · ${slotCount} slots`
                }
                autoComplete={hasCapturedTemplate}
                busy={!!busy}
              >
                <div className="registration-step">
                  <div>
                    <p>
                      Download the magenta setup image. Upload it to Design Space as one flat Print
                      Then Cut image, preserve transparency, and set both dimensions to{' '}
                      <strong>
                        {formatDimensions(full.width, full.height, project.settings.units)}
                      </strong>
                      . Save the project as <strong>{templateName}</strong>.
                      {printPaper.usesTabloidSetup && (
                        <>
                          {' '}
                          Before Make, choose <strong>{printPaper.designSpacePaper}</strong> as the
                          Print Then Cut page size in Design Space.
                        </>
                      )}
                    </p>
                    <button className="secondary" disabled={!!busy} onClick={setup}>
                      <Download size={15} /> Download setup PNG
                    </button>
                  </div>
                </div>
              </PrintSection>
              <PrintSection
                key={`${key}:capture`}
                layoutKey={key}
                section="capture"
                title="2 · Capture the actual sensor marks"
                summary={
                  hasCapturedTemplate
                    ? `Template saved · ${printPaper.outputPaper} · geometry checked`
                    : 'Import the one-page PDF from Design Space'
                }
                autoComplete={hasCapturedTemplate}
                canComplete={false}
                busy={!!busy}
              >
                <div className="registration-step">
                  <div>
                    <p>
                      In Design Space, choose Make → Send to Printer. Turn{' '}
                      <strong>bleed off</strong>, use the system print dialog, and{' '}
                      {printPaper.capturesTabloid ? (
                        <>
                          keep the printer paper on <strong>Tabloid (11 × 17 in)</strong>. Save a{' '}
                          <strong>one-page portrait Tabloid PDF at 100% / Actual size</strong> with
                          all four sensor marks. Skarix will check the complete marked area and
                          reframe it onto {printPaper.outputPaper} without scaling.
                        </>
                      ) : printPaper.usesTabloidSetup ? (
                        <>
                          change the printer paper to <strong>{printPaper.systemPaper}</strong>.
                          Save a <strong>one-page portrait PDF at 100% / Actual size</strong>;
                          cancel if it becomes two pages or clips any of the four sensor marks.
                        </>
                      ) : (
                        <>save a full-page, portrait PDF at actual size.</>
                      )}{' '}
                      Import that PDF here. We check the slot pattern and size, then{' '}
                      {registrationTemplates
                        ? 'save it in the root of your Skarix project library'
                        : 'store it in local app storage'}
                      . It loads automatically the next time this exact cut layout is selected.
                    </p>
                    <button
                      className="secondary"
                      disabled={!!busy}
                      onClick={() => input.current?.click()}
                    >
                      <FileUp size={15} />
                      {profile ? 'Replace captured PDF' : 'Import Design Space PDF'}
                    </button>
                    {profile && (
                      <div className="capture-success">
                        <CheckCircle2 size={16} />
                        <span>
                          {templateFilename(project.settings, 'cricut-template', 'pdf')}
                          <small>
                            Geometry checked · captured{' '}
                            {new Date(profile.capturedAt).toLocaleDateString()} ·{' '}
                            {registrationTemplates ? 'project library root' : 'local app storage'} ·
                            {profile.outputFrame
                              ? `${printPaper.outputPaper} output · ${formatMeasurement(profile.outputFrame.marginMm, project.settings.units)} minimum mark margin · `
                              : ''}
                            hardware unverified
                          </small>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </PrintSection>
              <PrintSection
                key={`${key}:reminders`}
                layoutKey={key}
                section="reminders"
                title="Printing and cutting reminders"
                summary="100% / Actual size · reuse the matching saved project and mat"
                busy={!!busy}
              >
                <div className="registration-step">
                  <div>
                    <p>
                      Prepare and inspect your pages below, then save the PDF and open it in a
                      dedicated PDF application.{' '}
                      {printPaper.capturesTabloid && (
                        <>
                          The exported pages are <strong>{printPaper.outputPaper}</strong>, with the
                          captured marks and card positions moved together.{' '}
                        </>
                      )}
                      Print at <strong>100% / Actual size</strong>, with no fit, shrink, headers, or
                      margins. Skarix does not print directly because browser printing reduces
                      output quality. If backs are enabled, print their artwork onto the same
                      sheets; those back pages do not contain registration marks or cut lines. In
                      Design Space, reopen this exact saved project and mat, select{' '}
                      <strong>Already Printed / Skip printing</strong> when available, then load the
                      sheet front-side up and cut.
                    </p>
                  </div>
                </div>
                <div className="soft-info">
                  <Ruler size={18} />
                  <span>
                    Every page keeps all {full.placements.length} slots, including the last page.
                    Unused slots print white and will still be cut. Change paper, spacing, machine,
                    or layout and a new captured template is required. Card-back settings and
                    alignment offsets reuse the current cut template; Skarix never creates a second
                    Cricut template for the back side.
                  </span>
                </div>
                <p className="guide-limit">
                  Captured marks are preserved from your PDF, not independently generated. This is
                  outside Cricut’s recommended print flow and still needs sensor and measurement
                  tests on your machine. Recapture after changes to the saved mat, Design Space, or
                  printer setup. Skarix only saves the print PDF so the captured marks’ original
                  content and the selected artwork DPI are preserved. Print the saved file from a
                  dedicated PDF application. Artwork bleed extends into the surrounding card spacing
                  without changing the cut pattern.
                </p>
              </PrintSection>
              <div className="registration-step">
                <span className="step-number">3</span>
                <div>
                  <h3>Save the PDF, then use the saved cut job</h3>
                  <p>Prepare, review, and save your pages. Print the PDF at 100% / Actual size.</p>
                  <div className="registration-actions">
                    <button
                      className="secondary"
                      disabled={!!busy || !profile || !project.entries.length}
                      onClick={() => prepare(true)}
                    >
                      <Ruler size={15} />
                      Prepare size-check sheet
                    </button>
                    <button
                      className="primary"
                      disabled={
                        !!busy ||
                        !profile ||
                        !project.entries.length ||
                        (project.settings.backsEnabled &&
                          sharedBackRequired &&
                          !project.backArtwork)
                      }
                      onClick={() => prepare(false)}
                    >
                      Prepare card sheets
                    </button>
                  </div>
                </div>
              </div>
            </details>
          </>
        )}
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        {busy && (
          <div role="status" className="loading">
            <LoaderCircle className="spin" size={19} />
            {busy}
            {pdfJobRunning && (
              <button className="secondary compact" onClick={() => pdfAbort.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
        )}
        {pdf && (
          <div className="registered-preview">
            <PdfPagePreview
              pdf={pdf}
              backPdf={backPdf}
              mode={preparedMode}
              backFlip={project.settings.backFlip}
            />
            <div>
              <strong>
                {preparedKind === 'alignment'
                  ? 'Back alignment guide'
                  : preparedKind === 'manual-calibration'
                    ? 'Manual cut calibration'
                    : preparedKind === 'size'
                      ? 'Size-check sheet'
                      : preparedKind === 'manual-nine'
                        ? 'Manual 9-card files'
                        : 'Card sheets'}{' '}
                ready to review
              </strong>
              <p>
                {preparedKind === 'alignment'
                  ? 'Print the front target first, then the matching back target on the same sheet. '
                  : preparedKind === 'manual-calibration'
                    ? 'Print this target on plain paper, place it flush at the mat grid origin, and cut it with the unchanged saved 9-card Basic Cut project. '
                    : preparedKind === 'manual-nine'
                      ? handCut
                        ? 'Review each page and its paper-edge cut guides before saving the print PDF. '
                        : 'Review every print page, then save the separate Basic Cut PNG for Design Space. '
                      : 'Review every sheet using the page selector or arrows. Confirm the front marks are unobstructed and check the matching backs. '}
                {preparedMode === 'manual' &&
                  'Print fronts first, refeed those sheets, then print the matching backs in the same order.'}
                {preparedMode === 'duplex' &&
                  `Enable duplex with ${project.settings.backFlip === 'long-edge' ? 'long-edge' : 'short-edge'} binding in the system print dialog.`}
                {
                  ' Use the Print buttons here, or save the PDF for another application. Print at 100% / Actual size.'
                }
              </p>
              {preparedMode === 'manual' ? (
                <>
                  <button
                    className="primary"
                    disabled={!!busy || !pdf}
                    onClick={() =>
                      savePdf(
                        pdf,
                        preparedKind === 'alignment'
                          ? 'alignment-front'
                          : preparedKind === 'size'
                            ? 'size-check'
                            : 'fronts',
                      )
                    }
                  >
                    <Download size={15} />{' '}
                    {preparedKind === 'alignment' ? 'Save front test PDF' : 'Save fronts PDF'}
                  </button>
                  {preparedKind === 'manual-nine' && !handCut && (
                    <button className="secondary" disabled={!!busy || !cutPng} onClick={saveCutPng}>
                      <Download size={15} /> Save Basic Cut PNG
                    </button>
                  )}
                  <button
                    className="primary"
                    disabled={!!busy || !backPdf}
                    onClick={() =>
                      savePdf(backPdf, preparedKind === 'alignment' ? 'alignment-back' : 'backs')
                    }
                  >
                    <Download size={15} />{' '}
                    {preparedKind === 'alignment' ? 'Save back test PDF' : 'Save backs PDF'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="primary"
                    disabled={!!busy || !pdf}
                    onClick={() =>
                      savePdf(
                        pdf,
                        preparedMode === 'duplex'
                          ? preparedKind === 'alignment'
                            ? 'alignment-duplex'
                            : 'duplex'
                          : preparedKind === 'size'
                            ? 'size-check'
                            : preparedKind === 'manual-calibration'
                              ? 'manual-cut-calibration'
                              : 'cards',
                      )
                    }
                  >
                    <Download size={15} />
                    {preparedMode === 'duplex'
                      ? 'Save duplex PDF'
                      : preparedKind === 'manual-calibration'
                        ? 'Save calibration PDF'
                        : preparedKind === 'manual-nine'
                          ? 'Save print PDF'
                          : 'Save registered PDF'}
                  </button>
                  {preparedKind === 'manual-nine' && !handCut && (
                    <button className="secondary" disabled={!!busy || !cutPng} onClick={saveCutPng}>
                      <Download size={15} /> Save Basic Cut PNG
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        onChange={(e) => capture(e.target.files?.[0])}
      />
      <input
        hidden
        ref={backInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => uploadBack(e.target.files?.[0])}
      />
      <div className="modal-footer">
        <span className="muted">
          {manualNine
            ? handCut
              ? 'Print one sheet at actual size and check its dimensions before cutting.'
              : 'Test alignment on plain paper before committing card stock.'
            : registrationTemplates
              ? 'Saved six-cut, seven-cut, and eight-cut templates load automatically for matching layouts.'
              : 'A saved template replaces artwork uploads for each deck.'}
        </span>
        <button className="secondary" disabled={!!busy} onClick={close}>
          Done
        </button>
      </div>
    </dialog>
  );
}
