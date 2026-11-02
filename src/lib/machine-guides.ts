import { MACHINES, getMachine } from '../../electron/cutters/catalog.cjs';
export {
  MACHINES,
  getMachine,
  isMachine,
  generatedSheetIssue,
} from '../../electron/cutters/catalog.cjs';
import { registrationGeometry } from './generated-registration';
import type { Settings } from './types';

export type Machine = Settings['machine'];
export const MACHINE_NAMES = Object.fromEntries(
  MACHINES.map((machine) => [machine.id, machine.name]),
) as Record<Machine, string>;
export type GuideRect = { x: number; y: number; width: number; height: number };
// Published maximum extents, NOT a rectangular safe area. Generated mark geometry
// and clearance are shared with the print output.
// https://help.cricut.com/hc/en-us/articles/360009429814
export function machineGuide(machine: Machine, paper: Settings['paper']) {
  const page = paper === 'letter' ? { width: 215.9, height: 279.4 } : { width: 210, height: 297 };
  const optical = getMachine(machine).printThenCut;
  const width = optical ? (paper === 'letter' ? 7.44 : 7.2) * 25.4 : page.width;
  const height = optical ? (paper === 'letter' ? 9.94 : 10.62) * 25.4 : page.height;
  const bounds = { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height };
  const geometry = registrationGeometry(optical ? machine : 'manual', paper);
  const corners = geometry.keepOuts;
  return { page, bounds, corners, optical, name: MACHINE_NAMES[machine], marks: geometry.marks };
}
export function intersects(a: GuideRect, b: GuideRect) {
  return (
    a.x < b.x + b.width - 0.001 &&
    a.x + a.width > b.x + 0.001 &&
    a.y < b.y + b.height - 0.001 &&
    a.y + a.height > b.y + 0.001
  );
}
export function outsidePlanningGuide(rect: GuideRect, guide: ReturnType<typeof machineGuide>) {
  const b = guide.bounds;
  return (
    rect.x < b.x - 0.001 ||
    rect.y < b.y - 0.001 ||
    rect.x + rect.width > b.x + b.width + 0.001 ||
    rect.y + rect.height > b.y + b.height + 0.001 ||
    guide.corners.some((c) => intersects(rect, c))
  );
}
