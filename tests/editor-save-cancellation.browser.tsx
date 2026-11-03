import { createRoot } from 'react-dom/client';
import StickerDesigner, { type StickerDesignerController } from '../src/components/StickerDesigner';
import { newDesign } from '../src/lib/sticker-design';
import { newStickerProject } from '../src/lib/stickers';
import { invokeAiDesign } from '../src/lib/ai-design';
import { useAiDesignBridge, useAiWorkspace } from '../src/lib/use-ai-design';

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
function check(value: unknown, message: string) {
  if (!value) throw Error(message);
}
async function until(predicate: () => unknown) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  throw Error('Timed out waiting for editor');
}

export async function run() {
  const results: string[] = [];
  // Stop and timeout both arrive through the same preload onCancel notification.
  for (const scenario of ['stop', 'timeout', 'draft', 'unmount', 'manual', 'success'] as const) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let controller: StickerDesignerController | undefined;
    let commits = 0,
      cancelAi: (() => void) | undefined,
      release: (() => void) | undefined;
    const originalBridge = window.skarix;
    const originalDecode = HTMLImageElement.prototype.decode;
    const project = newStickerProject();
    const design = newDesign(10, 10);
    window.skarix = {
      ...originalBridge,
      ai: {
        ...originalBridge?.ai,
        onCancel: (listener: () => void) => {
          cancelAi = listener;
          return () => {};
        },
        onRequest: () => () => {},
      },
    } as typeof window.skarix;
    function Harness({ fixedCanvas = false }: { fixedCanvas?: boolean }) {
      useAiDesignBridge();
      useAiWorkspace('stickers', {
        read: () => project,
        write: () => {},
        busy: () => true,
        open: () => {},
        undo: () => {},
        redo: () => {},
        editorState: () => ({
          operation: 'Editing',
          operationId: controller?.revision(),
          actions: ['save', 'cancel'],
        }),
        resolveEditor: async (_action, _id, request) => {
          await controller!.save(request);
        },
      });
      return (
        <StickerDesigner
          initial={design}
          name="Human draft"
          active
          cutRadius={0}
          fixedCanvas={fixedCanvas}
          onSave={() => {
            commits++;
          }}
          onClose={() => {}}
          onEditorController={(value) => {
            controller = value;
          }}
        />
      );
    }
    let unmounted = false;
    try {
      root.render(<Harness />);
      await until(() => controller && cancelAi);
      // Defer the real raster renderer, then let it complete after cancellation.
      HTMLImageElement.prototype.decode = async function () {
        await originalDecode.call(this);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      };
      const pending = (
        scenario === 'manual'
          ? controller!.save()
          : invokeAiDesign('resolve_editor_operation', {
              workspace: 'stickers',
              action: 'save',
              operationId: controller!.revision(),
              confirm: true,
            })
      ).then(
        () => '',
        (error) => String(error),
      );
      await until(() => release);
      if (scenario === 'stop' || scenario === 'timeout' || scenario === 'manual') cancelAi!();
      if (scenario === 'draft') {
        root.render(<Harness fixedCanvas />);
        await tick();
      }
      if (scenario === 'unmount') {
        root.unmount();
        unmounted = true;
      }
      release!();
      const error = await pending;
      if (scenario === 'manual' || scenario === 'success')
        check(!error && commits === 1, `${scenario}: valid save did not commit`);
      else {
        check(/stopped|changed/.test(error), `${scenario}: missing cancellation error: ${error}`);
        check(commits === 0, `${scenario}: stale save committed`);
        if (!unmounted) {
          await until(() => controller && !controller.busy());
          check(
            host.textContent?.includes('Save design to sheet'),
            'Cancellation closed the human draft',
          );
          HTMLImageElement.prototype.decode = originalDecode;
          await controller!.save();
          check(commits === 1, 'Human cannot save draft after AI cancellation');
        }
      }
      results.push(
        `PASS editor save ${scenario}: commit boundary guarded and manual save preserved`,
      );
    } finally {
      HTMLImageElement.prototype.decode = originalDecode;
      window.skarix = originalBridge;
      if (!unmounted) root.unmount();
      host.remove();
    }
  }
  return results;
}
