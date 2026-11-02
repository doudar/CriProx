// Data only: shared by project validation, the renderer, and native providers.
// IDs are persisted in projects; never rename an existing ID to change its label.
const legacy =
  'Direct connection for this model needs the Cricut legacy driver, which is not implemented yet. Use its matching Design Space workflow.';
const retired =
  'This retired cutter needs a separate legacy driver. Direct connection is not implemented.';
const cricut = (id, name, options = {}) => ({
  id,
  name,
  manufacturer: 'Cricut',
  provider: 'cricut',
  driver: 'legacy',
  printThenCut: true,
  generatedPaper: ['letter', 'a4'],
  transports: [],
  directConnect: false,
  directCut: false,
  hardwareVerified: false,
  unavailableReason: legacy,
  ...options,
});
const bifrost = (deviceType, deviceClass, machineFamily) => ({
  driver: 'bifrost',
  deviceType,
  deviceClass,
  machineFamily,
  transports: ['usb', 'ble'],
  directConnect: true,
  directCut: true,
  unavailableReason: '',
  mat: { width: 12, height: 12 },
});
const MACHINES = Object.freeze(
  [
    cricut('explore-5', 'Explore 5', {
      ...bifrost('gandalf', 'GandalfDevice', 24),
      hardwareVerified: true,
    }),
    cricut('explore-4', 'Explore 4'),
    cricut('explore-3', 'Explore 3'),
    cricut('explore-air-2', 'Explore Air 2'),
    cricut('explore-air', 'Explore Air'),
    cricut('explore-one', 'Explore One'),
    cricut('explore', 'Explore'),
    cricut('maker-5', 'Maker 5', bifrost('dumbledore', 'DumbledoreDevice', 20)),
    cricut('maker-4', 'Maker 4'),
    cricut('maker-3', 'Maker 3'),
    cricut('maker', 'Maker'),
    cricut('joy-2', 'Joy 2', {
      ...bifrost('psyche', 'PsycheDevice', 21),
      directCut: false,
      generatedPaper: [],
      mat: { width: 4.5, height: 12 },
      unavailableReason:
        'Joy 2 connects directly, but needs a smaller sheet format than the Letter/A4 workflow. Direct cutting is not implemented yet.',
    }),
    cricut('joy-xtra', 'Joy Xtra'),
    cricut('joy', 'Joy', { printThenCut: false, generatedPaper: [] }),
    cricut('venture', 'Venture'),
    ...[
      ['personal', 'Personal'],
      ['create', 'Create'],
      ['expression', 'Expression'],
      ['expression-2', 'Expression 2'],
      ['imagine', 'Imagine'],
      ['mini', 'Mini'],
    ].map(([id, name]) =>
      cricut(id, name, { printThenCut: false, generatedPaper: [], unavailableReason: retired }),
    ),
    {
      id: 'manual',
      name: 'Manual cutting',
      manufacturer: '',
      provider: null,
      driver: null,
      printThenCut: false,
      generatedPaper: [],
      transports: [],
      directConnect: false,
      directCut: false,
      hardwareVerified: false,
      unavailableReason: 'Manual cutting does not use a connected cutter.',
    },
  ].map((machine) =>
    Object.freeze({
      ...machine,
      transports: Object.freeze(machine.transports),
      generatedPaper: Object.freeze(machine.generatedPaper),
      ...(machine.mat ? { mat: Object.freeze(machine.mat) } : {}),
    }),
  ),
);
const byId = new Map(MACHINES.map((machine) => [machine.id, machine]));
function getMachine(id) {
  const machine = byId.get(id);
  if (!machine) throw Error('Unknown cutting machine. Choose a model from the machine selector.');
  return machine;
}
function isMachine(id) {
  return byId.has(id);
}
function generatedSheetIssue(id, paper) {
  const machine = getMachine(id);
  if (!machine.printThenCut)
    return `${machine.name} does not support this registered Print Then Cut workflow.`;
  if (!machine.generatedPaper.includes(paper))
    return `${machine.name} cannot use a full Letter/A4 sheet in this workflow. Choose a supported sheet format in Design Space.`;
  return '';
}
module.exports = { MACHINES, getMachine, isMachine, generatedSheetIssue };
