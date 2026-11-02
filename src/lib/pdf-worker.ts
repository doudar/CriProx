import type { Project } from './types';
import type { RegistrationProfile } from './registration';
import { setUpscaylRunner, type UpscaleBackend } from './upscale';
import {
  buildBackAlignmentPdfs,
  buildRegisteredBackPdf,
  buildRegisteredPdf,
  combineDuplexPdfs,
} from './registered-pdf';
import {
  buildManualCutCalibrationPdf,
  buildManualCutPdf,
  manualCutTemplatePng,
} from './manual-cut';

export type PreparedPdfJob = {
  pdf: Uint8Array;
  backPdf?: Uint8Array;
  cutPng?: Uint8Array;
  mode: 'front' | 'manual' | 'duplex';
};

export type PdfWorkerPayload =
  | {
      kind: 'registered';
      project: Project;
      profile: RegistrationProfile;
      calibration: boolean;
      upscaleScryfall?: boolean;
      upscaleBackend?: UpscaleBackend;
      upscaylCacheKey?: string;
    }
  | { kind: 'alignment'; project: Project }
  | { kind: 'manual-calibration'; project: Project }
  | {
      kind: 'manual-nine';
      project: Project;
      upscaleScryfall?: boolean;
      upscaleBackend?: UpscaleBackend;
      upscaylCacheKey?: string;
    };

export type PdfWorkerRequest = PdfWorkerPayload & { id: string };

export type PdfWorkerResponse =
  | { id: string; type: 'progress'; text: string }
  | { id: string; type: 'complete'; result: PreparedPdfJob }
  | { id: string; type: 'error'; message: string };

type UpscaylRequest = { id: string; type: 'upscayl-request'; nativeId: string; input: Uint8Array };
type UpscaylResult = {
  id: string;
  type: 'upscayl-result';
  nativeId: string;
  output?: Uint8Array;
  error?: string;
};

export async function executePdfJob(
  request: PdfWorkerRequest,
  progress: (text: string) => void,
): Promise<PreparedPdfJob> {
  if (request.kind === 'manual-calibration') {
    progress('Building manual cut calibration sheet…');
    return { pdf: await buildManualCutCalibrationPdf(request.project), mode: 'front' };
  }
  if (request.kind === 'manual-nine') {
    const cutPng =
        request.project.settings.machine === 'manual'
          ? undefined
          : await manualCutTemplatePng(request.project.settings),
      fronts = await buildManualCutPdf(
        request.project,
        progress,
        false,
        request.upscaleScryfall,
        request.upscaleBackend,
        request.upscaylCacheKey,
      );
    if (!request.project.settings.backsEnabled) return { pdf: fronts, cutPng, mode: 'front' };
    const backs = await buildManualCutPdf(
      request.project,
      progress,
      true,
      request.upscaleScryfall,
      request.upscaleBackend,
      request.upscaylCacheKey,
    );
    if (request.project.settings.backPrintMode === 'duplex') {
      progress('Combining duplex pages…');
      return {
        pdf: await combineDuplexPdfs(request.project, fronts, backs),
        cutPng,
        mode: 'duplex',
      };
    }
    return { pdf: fronts, backPdf: backs, cutPng, mode: 'manual' };
  }
  if (request.kind === 'alignment') {
    const alignment = await buildBackAlignmentPdfs(request.project);
    if (request.project.settings.backPrintMode === 'duplex') {
      progress('Combining duplex pages…');
      return {
        pdf: await combineDuplexPdfs(request.project, alignment.front, alignment.back),
        mode: 'duplex',
      };
    }
    return { pdf: alignment.front, backPdf: alignment.back, mode: 'manual' };
  }

  const fronts = await buildRegisteredPdf(
    request.project,
    request.profile,
    progress,
    request.calibration,
    request.upscaleScryfall,
    request.upscaleBackend,
    request.upscaylCacheKey,
  );
  if (!request.project.settings.backsEnabled) return { pdf: fronts, mode: 'front' };
  const backs = await buildRegisteredBackPdf(
    request.project,
    request.profile,
    progress,
    request.calibration,
    request.upscaleScryfall,
    request.upscaleBackend,
    request.upscaylCacheKey,
  );
  if (request.project.settings.backPrintMode === 'duplex') {
    progress('Combining duplex pages…');
    return {
      pdf: await combineDuplexPdfs(request.project, fronts, backs),
      mode: 'duplex',
    };
  }
  return { pdf: fronts, backPdf: backs, mode: 'manual' };
}

function nextPaint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export async function preparePdfJob(
  request: PdfWorkerPayload,
  progress: (text: string) => void,
  signal?: AbortSignal,
): Promise<PreparedPdfJob> {
  if (signal?.aborted) throw new DOMException('PDF preparation cancelled.', 'AbortError');
  const job = { ...request, id: crypto.randomUUID() } as PdfWorkerRequest;
  const upscayl = window.skarix?.upscayl;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    setUpscaylRunner(upscayl ? (id, input) => upscayl.run(id, input) : undefined);
    await nextPaint();
    const result = await executePdfJob(job, progress);
    if (signal?.aborted) throw new DOMException('PDF preparation cancelled.', 'AbortError');
    return result;
  }
  return new Promise<PreparedPdfJob>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/pdf.worker.ts', import.meta.url), {
      type: 'module',
    });
    const nativeJobs = new Set<string>();
    let finished = false;
    const abort = () => {
      finish();
      reject(new DOMException('PDF preparation cancelled.', 'AbortError'));
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      for (const id of nativeJobs) void upscayl?.cancel(id).catch(() => {});
      worker.terminate();
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<PdfWorkerResponse | UpscaylRequest>) => {
      if (data.id !== job.id) return;
      if (data.type === 'upscayl-request') {
        nativeJobs.add(data.nativeId);
        if (!upscayl) {
          worker.postMessage({
            id: job.id,
            type: 'upscayl-result',
            nativeId: data.nativeId,
            error: 'Upscayl is unavailable.',
          } satisfies UpscaylResult);
          nativeJobs.delete(data.nativeId);
        } else {
          void upscayl.run(data.nativeId, data.input).then(
            (output) => {
              nativeJobs.delete(data.nativeId);
              if (finished) return;
              worker.postMessage(
                {
                  id: job.id,
                  type: 'upscayl-result',
                  nativeId: data.nativeId,
                  output,
                } satisfies UpscaylResult,
                [output.buffer],
              );
            },
            (error) => {
              nativeJobs.delete(data.nativeId);
              if (finished) return;
              worker.postMessage({
                id: job.id,
                type: 'upscayl-result',
                nativeId: data.nativeId,
                error: error instanceof Error ? error.message : String(error),
              } satisfies UpscaylResult);
            },
          );
        }
      } else if (data.type === 'progress') progress(data.text);
      else if (data.type === 'complete') {
        finish();
        resolve(data.result);
      } else {
        finish();
        reject(new Error(data.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'The PDF worker stopped unexpectedly.'));
    };
    worker.postMessage(job);
  });
}
