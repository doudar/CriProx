import { pdfRenderer } from './registered-pdf';

export type PrintSettings = {
  widthMm: number;
  heightMm: number;
  pageCount: number;
  duplex: 'simplex' | 'longEdge' | 'shortEdge';
};
export type PrintOutcome = { status: 'submitted' | 'cancelled' | 'dialog-opened' };
export type PrintApi = {
  begin(settings: PrintSettings): Promise<string>;
  page(id: string, index: number, png: Uint8Array): Promise<void>;
  finish(id: string): Promise<PrintOutcome>;
  abort(id: string): Promise<void>;
};

/** Print the exact prepared PDF pages, including their marks, rather than the editor canvas. */
export async function printPdf(
  pdf: Uint8Array,
  duplex: PrintSettings['duplex'],
  progress: (message: string) => void,
  signal: AbortSignal,
): Promise<PrintOutcome> {
  const renderer = await pdfRenderer();
  signal.throwIfAborted();
  const task = renderer.getDocument({ data: pdf.slice() });
  const api = window.skarix?.printing;
  let id: string | undefined;
  let frame: HTMLIFrameElement | undefined;
  const urls: string[] = [];
  const cleanupBrowser = () => {
    frame?.remove();
    urls.forEach((url) => URL.revokeObjectURL(url));
  };
  try {
    const doc = await task.promise;
    if (doc.numPages < 1 || doc.numPages > 48)
      throw Error('Print between 1 and 48 pages at a time.');
    const first = await doc.getPage(1);
    const size = first.getViewport({ scale: 1 });
    const settings: PrintSettings = {
      widthMm: (size.width * 25.4) / 72,
      heightMm: (size.height * 25.4) / 72,
      pageCount: doc.numPages,
      duplex,
    };
    if (
      ![settings.widthMm, settings.heightMm].every((n) => Number.isFinite(n) && n >= 50 && n <= 500)
    )
      throw Error('Unsupported print paper size.');
    first.cleanup();
    signal.throwIfAborted();
    if (api) id = await api.begin(settings);
    else {
      frame = document.createElement('iframe');
      frame.title = 'Skarix print sheets';
      Object.assign(frame.style, {
        position: 'fixed',
        width: '1px',
        height: '1px',
        left: '-10000px',
        top: '0',
        border: '0',
      });
      document.body.append(frame);
      const style = frame.contentDocument!.createElement('style');
      style.textContent = `@page{size:${settings.widthMm}mm ${settings.heightMm}mm;margin:0}html,body{margin:0;padding:0}img{display:block;width:${settings.widthMm}mm;height:${settings.heightMm}mm;break-after:page;page-break-after:always;print-color-adjust:exact;-webkit-print-color-adjust:exact}img:last-child{break-after:auto;page-break-after:auto}`;
      frame.contentDocument!.head.append(style);
    }
    for (let index = 0; index < doc.numPages; index++) {
      signal.throwIfAborted();
      progress(`Preparing print page ${index + 1} of ${doc.numPages}…`);
      const page = await doc.getPage(index + 1);
      const viewport = page.getViewport({ scale: 300 / 72 });
      const unscaled = page.getViewport({ scale: 1 });
      if (
        Math.abs(unscaled.width - size.width) > 0.1 ||
        Math.abs(unscaled.height - size.height) > 0.1
      )
        throw Error('Print pages must use the same paper size.');
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const render = page.render({ canvas, viewport, background: 'white' });
      const cancel = () => render.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        await render.promise;
        signal.throwIfAborted();
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(Error('Could not prepare print page.'))),
            'image/png',
          ),
        );
        if (api) await api.page(id!, index, new Uint8Array(await blob.arrayBuffer()));
        else {
          const image = frame!.contentDocument!.createElement('img');
          const url = URL.createObjectURL(blob);
          urls.push(url);
          image.src = url;
          frame!.contentDocument!.body.append(image);
          await image.decode();
        }
      } finally {
        signal.removeEventListener('abort', cancel);
        page.cleanup();
        canvas.width = canvas.height = 0;
      }
    }
    signal.throwIfAborted();
    progress(
      api ? 'Choose a printer in the print preview…' : 'Choose a printer in the print dialog…',
    );
    if (api) return await api.finish(id!);
    frame!.contentWindow!.addEventListener('afterprint', cleanupBrowser, { once: true });
    frame!.contentWindow!.focus();
    frame!.contentWindow!.print();
    // Some browsers return before their dialog closes; retain its pages until afterprint.
    setTimeout(cleanupBrowser, 15 * 60 * 1000);
    return { status: 'dialog-opened' };
  } catch (error) {
    cleanupBrowser();
    if (signal.aborted) return { status: 'cancelled' };
    throw error;
  } finally {
    if (api && id) await api.abort(id);
    await task.destroy();
  }
}
