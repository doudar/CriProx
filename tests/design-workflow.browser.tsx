import { run as runSaveCancellationTests } from './editor-save-cancellation.browser';
import { createRoot } from 'react-dom/client';
import StickerDesigner, { type StickerDesignerController } from '../src/components/StickerDesigner';
import { newDesign, newElement, type StickerDesign } from '../src/lib/sticker-design';
import { DEFAULT_REPEAT } from '../src/lib/design-repeat';
import { groupLayers } from '../src/lib/design-groups';
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const check = (condition: unknown, message: string) => {
  if (!condition) throw Error(message);
};
export async function run() {
  const root = createRoot(document.getElementById('root')!);
  const d = newDesign(60, 60);
  d.elements = ['eye', 'nose'].map((id, i) => ({
    ...newElement('shape', d),
    id,
    name: id,
    x: 10 + 15 * i,
    y: 10,
    width: 10,
    height: 10,
  }));
  const initial = groupLayers(d, ['eye', 'nose'], 'face');
  initial.elements.find((e) => e.id === 'face')!.name = 'Face';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 10;
  initial.reference = {
    image: canvas.toDataURL(),
    opacity: 0.35,
    visible: true,
    x: 0,
    y: 0,
    width: 60,
    height: 60,
  };
  let controller: StickerDesignerController | undefined;
  let saved: StickerDesign | undefined;
  root.render(
    <StickerDesigner
      initial={initial}
      name="Character"
      active
      cutRadius={0}
      onSave={(_name, design) => {
        saved = design;
      }}
      onClose={() => {}}
      onEditorController={(value) => {
        controller = value;
      }}
    />,
  );
  await tick();
  await tick();
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
    )!;
  const rows = () => document.querySelectorAll('.designer-layer-row');
  check(rows().length === 3, 'Expanded hierarchy missing children');
  button('Collapse group Face').click();
  await tick();
  check(rows().length === 1, 'Collapse did not hide children');
  button('Expand group Face').click();
  await tick();
  check(rows().length === 3, 'Expand did not restore children');
  const eye = [...rows()].find((row) => row.textContent?.includes('eye'))!.querySelector('button')!;
  eye.click();
  await tick();
  check(
    document.querySelector('.layer-breadcrumbs')?.textContent?.includes('Face'),
    'Missing parent breadcrumb',
  );
  check(
    document.querySelector('.selection-detail')?.getAttribute('aria-label') === 'Detail of eye',
    'Selection detail missing',
  );
  check(!document.querySelector('.selection-detail image'), 'Reference leaked into detail preview');
  const revisionBeforeRename = controller!.revision();
  const name = [...document.querySelectorAll('label')]
    .find((label) => label.textContent?.trim() === 'Layer name')!
    .querySelector('input')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Left eye');
  name.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
  check(
    document.querySelector('.layer-breadcrumbs')?.textContent?.includes('Left eye'),
    'Rename not applied',
  );
  check(
    controller!.revision() !== revisionBeforeRename,
    'Draft revision did not change after human edit',
  );
  const reference = [...document.querySelectorAll('label')]
    .find((label) => label.textContent?.trim() === 'Show reference')!
    .querySelector('input')!;
  reference.click();
  await tick();
  check(
    !document.querySelector('.designer-canvas svg > image'),
    'Hidden reference remains on canvas',
  );
  button('Remove reference').click();
  await tick();
  check(
    ![...document.querySelectorAll('label')].some(
      (label) => label.textContent?.trim() === 'Show reference',
    ),
    'Reference removal failed',
  );
  // Undo restores reference settings as one editable history step.
  document
    .querySelector('svg[aria-label="Editable sticker artwork"]')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await tick();
  check(
    [...document.querySelectorAll('label')].some(
      (label) => label.textContent?.trim() === 'Show reference',
    ),
    'Undo did not restore reference',
  );
  check(controller && !controller.busy(), 'Editor controller unavailable');
  await controller!.save();
  check(
    saved?.elements.find((e) => e.id === 'eye')?.name === 'Left eye',
    'Save lost renamed layer',
  );
  check(saved?.reference?.visible === false, 'Save lost reference visibility');
  root.unmount();
  check(controller === undefined, 'Unmount did not clear controller');
  const repeatedRoot = createRoot(document.getElementById('root')!);
  const repeated = newDesign(60, 60);
  repeated.elements = [
    {
      ...newElement('shape', repeated),
      id: 'repeat-source',
      name: 'Petals',
      x: 10,
      y: 10,
      width: 4,
      height: 4,
      repeat: {
        ...DEFAULT_REPEAT,
        mode: 'radial',
        count: 4,
        angle: 90,
        spacingX: 15,
        spacingY: 15,
      },
    },
  ];
  repeatedRoot.render(
    <StickerDesigner
      initial={repeated}
      name="Pattern"
      active
      cutRadius={0}
      onSave={() => {}}
      onClose={() => {}}
    />,
  );
  await tick();
  await tick();
  const copy = document.querySelector<SVGRectElement>(
    '[data-layer-hit="repeat-source"][data-copy-index="1"]',
  )!;
  check(
    copy && copy.getAttribute('pointer-events') === 'all',
    'Repeated copy has no selectable hit region',
  );
  copy.scrollIntoView({ block: 'center', inline: 'center' });
  await tick();
  const center = new DOMPoint(2, 2).matrixTransform(copy.getScreenCTM()!);
  const target = document.elementFromPoint(center.x, center.y);
  check(target === copy, 'Visible repeated copy does not receive pointer hits');
  // Shift selection avoids synthetic pointer-capture limitations; it still uses the normal source handler.
  target!.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      shiftKey: true,
      pointerId: 1,
      clientX: center.x,
      clientY: center.y,
    }),
  );
  await tick();
  check(
    document.querySelector('.designer-layer-row > button')?.getAttribute('aria-pressed') === 'true',
    'Clicking a radial copy did not select the editable source',
  );
  repeatedRoot.unmount();
  return [
    ...(await runSaveCancellationTests()),
    'PASS repeated copy hit testing selects editable source',
    'PASS group collapse/expand and child selection',
    'PASS hierarchy breadcrumbs, rename and detail preview',
    'PASS reference hide/remove/undo',
    'PASS controller save persistence and cleanup',
  ];
}
