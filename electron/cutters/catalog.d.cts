export type MachineId =
  | 'explore-5'
  | 'explore-4'
  | 'explore-3'
  | 'explore-air-2'
  | 'explore-air'
  | 'explore-one'
  | 'explore'
  | 'maker-5'
  | 'maker-4'
  | 'maker-3'
  | 'maker'
  | 'joy-2'
  | 'joy-xtra'
  | 'joy'
  | 'venture'
  | 'personal'
  | 'create'
  | 'expression'
  | 'expression-2'
  | 'imagine'
  | 'mini'
  | 'manual';
export type MachineDefinition = {
  id: MachineId;
  name: string;
  manufacturer: string;
  provider: string | null;
  driver: string | null;
  printThenCut: boolean;
  generatedPaper: readonly string[];
  transports: readonly ('usb' | 'ble')[];
  directConnect: boolean;
  directCut: boolean;
  hardwareVerified: boolean;
  unavailableReason: string;
  deviceType?: string;
  deviceClass?: string;
  machineFamily?: number;
  mat?: { width: number; height: number };
};
export const MACHINES: readonly MachineDefinition[];
export function getMachine(id: string): MachineDefinition;
export function isMachine(id: unknown): id is MachineId;
export function generatedSheetIssue(id: string, paper: string): string;
