export type MaterialProfile = {
  id: string;
  name: string;
  category: string;
  machineId: number;
  machineName: string;
  blade: string;
  bladeName: string;
  source: 'builtin' | 'design-space' | 'custom';
  pressure: number;
  passes: number;
  pressures: number[];
  adjustment: number[];
  motion: number[];
};
type Settings = {
  cutMaterial: string;
  cutPressure: string;
  cutPasses: number;
  cutProfile?: MaterialProfile;
};
export const MAX_CUT_PASSES: number;
export const BUILTIN_MATERIALS: MaterialProfile[];
export function validateMaterial(value: unknown): MaterialProfile;
export function materialForSettings(value: Settings): MaterialProfile;
export function passPressures(value: Settings): number[];
export function directCutIssue(value: Settings, machineId?: string): string;
