// Portable material snapshots are shared by the renderer and native job validator.
const legacy = require('./fine-point-profiles.json');
const { getMachine } = require('../cutters/catalog.cjs');
const MAX_CUT_PASSES = 10;
function validateMaterial(value) {
  const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if (
    !value ||
    !text(value.id, 180) ||
    !text(value.name, 180) ||
    !text(value.machineName, 100) ||
    !Number.isInteger(value.machineId) ||
    value.machineId < 0 ||
    !text(value.blade, 80) ||
    !text(value.bladeName, 100) ||
    typeof value.category !== 'string' ||
    value.category.length > 100 ||
    !['builtin', 'design-space', 'custom'].includes(value.source) ||
    !Number.isInteger(value.passes) ||
    value.passes < 1 ||
    value.passes > MAX_CUT_PASSES ||
    !Number.isInteger(value.pressure) ||
    value.pressure < 1 ||
    value.pressure > 4500 ||
    !Array.isArray(value.pressures) ||
    value.pressures.length !== value.passes ||
    value.pressures.some((p) => !Number.isInteger(p) || Math.abs(p) > 4500) ||
    !Array.isArray(value.adjustment) ||
    value.adjustment.length !== 3 ||
    value.adjustment.some((p) => !Number.isInteger(p) || Math.abs(p) > 500) ||
    !Array.isArray(value.motion) ||
    value.motion.length !== 4 ||
    value.motion.some((p, i) => !Number.isFinite(p) || p <= 0 || p > (i % 2 ? 1000 : 50))
  )
    throw Error('Invalid material profile. Check its name, pressure, and pass settings.');
  return {
    id: value.id,
    name: value.name.trim(),
    category: value.category,
    machineId: value.machineId,
    machineName: value.machineName,
    blade: value.blade,
    bladeName: value.bladeName,
    source: value.source,
    pressure: value.pressure,
    passes: value.passes,
    pressures: [...value.pressures],
    adjustment: [...value.adjustment],
    motion: [...value.motion],
  };
}
const BUILTIN_MATERIALS = Object.entries(legacy).map(([id, p]) =>
  validateMaterial({
    id,
    ...p,
    category: id === 'medium-cardstock' ? 'Cardstock' : 'Paper',
    machineId: 24,
    machineName: 'Cricut Explore 5',
    blade: 'dragKnife',
    bladeName: 'Fine-Point Blade',
    source: 'builtin',
    passes: id === 'medium-cardstock' ? 2 : 1,
    pressures: id === 'medium-cardstock' ? [p.pressure, p.pressure] : [p.pressure],
    motion: [10, 100, 12, 200],
  }),
);
function materialForSettings(settings) {
  if (settings.cutProfile !== undefined) {
    const profile = validateMaterial(settings.cutProfile);
    if (profile.id !== settings.cutMaterial) throw Error('Invalid cutter material snapshot.');
    return profile;
  }
  const profile = BUILTIN_MATERIALS.find((p) => p.id === settings.cutMaterial);
  if (!profile) throw Error('Invalid cutter material. Select a material with saved settings.');
  return profile;
}
function passPressures(settings) {
  const profile = materialForSettings(settings);
  const index = ['light', 'medium', 'hard'].indexOf(settings.cutPressure);
  if (
    index < 0 ||
    !Number.isInteger(settings.cutPasses) ||
    settings.cutPasses < 1 ||
    settings.cutPasses > MAX_CUT_PASSES
  )
    throw Error('Invalid cut pressure or cut passes.');
  return Array.from(
    { length: settings.cutPasses },
    (_, i) =>
      profile.pressures[Math.min(i, profile.pressures.length - 1)] + profile.adjustment[index],
  );
}
function directCutIssue(settings, machineId = 'explore-5') {
  const machine = getMachine(machineId);
  if (!machine.directCut) return machine.unavailableReason;
  const profile = materialForSettings(settings);
  if (profile.machineId !== machine.machineFamily)
    return `Direct cutting requires a ${machine.name} material profile. Select a matching material in Manage materials.`;
  if (profile.blade !== 'dragKnife')
    return `This material requires ${profile.bladeName}. Direct cutting currently supports the Fine-Point Blade.`;
  if (passPressures(settings).some((p) => p <= 0 || p > 450))
    return 'This material uses a pressure sequence outside the supported 1–450 g range. Cut it in Design Space.';
  return '';
}
module.exports = {
  MAX_CUT_PASSES,
  BUILTIN_MATERIALS,
  validateMaterial,
  materialForSettings,
  passPressures,
  directCutIssue,
};
