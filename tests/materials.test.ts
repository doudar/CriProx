import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BUILTIN_MATERIALS,
  selectMaterial,
  readCutSettings,
  passPressures,
  directCutIssue,
} from '../src/lib/cut-settings';
import {
  emptyMaterialLibrary,
  mergeImportedMaterials,
  libraryMaterials,
  editLibraryMaterial,
  resetLibraryMaterial,
  validateLibrary,
} from '../src/lib/material-library';
import { validateProject } from '../src/lib/project';
import { DEFAULT_SETTINGS } from '../src/lib/types';
import { newStickerProject, validateStickerProject } from '../src/lib/stickers';
const require = createRequire(import.meta.url);
const {
  normalizeMaterials,
  importDesignSpaceMaterials,
} = require('../electron/material-import.cjs');
const {
  resolveCutSettings,
  createPressurePassSettings,
} = require('../electron/cutter/pressure-test.cjs');
const { prepareSheetJob } = require('../electron/cutter/sheet-job.cjs');
const sheetJob = require('./fixtures/sheet-job.cjs');
const raw = (id: string, blade = 'dragKnife', pressures = [180, 80]) => ({
  _id: id,
  materialName: `Material ${id}`,
  tag: 'Paper',
  machineMaterials: [
    {
      machineTypeId: 24,
      name: 'gandalf',
      tools: [
        {
          name: blade,
          displayName: blade,
          precisionMode: {
            pressure: pressures[0],
            multiPass: pressures.length,
            multiPressure: pressures,
            deltaAdjustment: [-9, 0, 9],
            cutSpeed: 6,
            cutAccel: 50,
            moveToSpeed: 12,
            moveToAccel: 200,
          },
        },
      ],
    },
  ],
});
const data = (...materials: ReturnType<typeof raw>[]) => ({ customMaterials: { materials } });
const imported = () => normalizeMaterials(data(raw('sticker'))).profiles[0];

test('material selection loads the default pressure and passes, with a detached project snapshot', () => {
  const profile = imported(),
    settings = selectMaterial(profile);
  assert.equal(settings.cutPasses, 2);
  assert.equal(settings.cutPressure, 'medium');
  assert.deepEqual(passPressures(settings), [180, 80]);
  profile.pressures[0] = 300;
  assert.deepEqual(passPressures(settings), [180, 80]);
  assert.equal(selectMaterial(BUILTIN_MATERIALS[1]).cutPasses, 2);
  assert.deepEqual(
    passPressures({ ...settings, cutPressure: 'hard', cutPasses: 3 }),
    [189, 89, 89],
  );
});

test('all cached cutting blades import with stable distinct IDs and no account data', () => {
  const result = normalizeMaterials(
    data(raw('paper'), raw('foam', 'deepCut'), raw('paper', 'deepCut')),
  );
  assert.equal(result.profiles.length, 3);
  assert.equal(new Set(result.profiles.map((p: any) => p.id)).size, 3);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.profiles[0].motion, [6, 50, 12, 200]);
  assert.equal(result.profiles[1].blade, 'deepCut');
  assert.deepEqual(Object.keys(result.profiles[0]).sort(), Object.keys(imported()).sort());
  const bad = raw('bad');
  bad.machineMaterials[0].tools[0].precisionMode.multiPass = 1e9;
  const partial = normalizeMaterials(data(raw('good'), bad));
  assert.equal(partial.profiles.length, 1);
  assert.ok(partial.warnings.length);
});

test('local discovery reads every machine cache, deduplicates, and reports unavailable data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skarix-material-test-'));
  try {
    for (const [machine, materials] of [
      ['a', [raw('paper')]],
      ['b', [raw('paper'), raw('foam', 'deepCut')]],
    ] as const) {
      const dir = path.join(root, 'account', 'MaterialSettings', machine);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'MaterialSettings'), JSON.stringify(data(...materials)));
    }
    const result = await importDesignSpaceMaterials({ root });
    assert.equal(result.files, 2);
    assert.equal(result.profiles.length, 2);
    assert.deepEqual(result.warnings, []);
    await assert.rejects(
      importDesignSpaceMaterials({ root: path.join(root, 'missing') }),
      /No local/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('library refresh preserves edits and custom materials; restore uses the refreshed original', () => {
  const profile = imported();
  let library = mergeImportedMaterials(emptyMaterialLibrary(), [profile]);
  library = editLibraryMaterial(library, { ...profile, name: 'My sticker', pressures: [200, 100] });
  library = editLibraryMaterial(library, {
    ...profile,
    id: 'custom:test',
    source: 'custom',
    name: 'Custom',
  });
  library = mergeImportedMaterials(library, [{ ...profile, name: 'Updated original' }]);
  assert.equal(libraryMaterials(library).find((p) => p.id === profile.id)?.name, 'My sticker');
  library = resetLibraryMaterial(library, profile.id);
  assert.equal(
    libraryMaterials(library).find((p) => p.id === profile.id)?.name,
    'Updated original',
  );
  library = resetLibraryMaterial(library, 'custom:test');
  assert.ok(!libraryMaterials(library).some((p) => p.id === 'custom:test'));
  assert.deepEqual(validateLibrary(JSON.parse(JSON.stringify(library))), library);
  assert.throws(() => validateLibrary({ version: 99 }));
});

test('custom material snapshots survive portable cards and stickers and native sheet validation', () => {
  const settings = selectMaterial({ ...imported(), id: 'custom:portable', source: 'custom' });
  const card = validateProject(
    JSON.parse(
      JSON.stringify({
        version: 1,
        name: 'Test',
        entries: [],
        settings: { ...DEFAULT_SETTINGS, ...settings },
      }),
    ),
  );
  const sticker = newStickerProject();
  Object.assign(sticker.settings, settings);
  assert.deepEqual(readCutSettings(card.settings), settings);
  assert.deepEqual(
    readCutSettings(validateStickerProject(JSON.parse(JSON.stringify(sticker))).settings),
    settings,
  );
  const job = sheetJob();
  job.cutSettings = {
    material: settings.cutMaterial,
    pressurePreset: settings.cutPressure,
    passes: settings.cutPasses,
    profile: settings.cutProfile,
  };
  assert.deepEqual(prepareSheetJob(JSON.stringify(job), 0).resolved.passPressures, [180, 80]);
  job.cutSettings.profile.id = 'mismatch';
  assert.throws(() => prepareSheetJob(JSON.stringify(job), 0), /snapshot/);
});

test('native pass commands retain variable pressures, and reject incompatible blades and machine profiles', () => {
  const settings = selectMaterial(imported());
  const T = {
    PressurePassSettings: class {
      constructor(
        public count: number,
        public pressure: any,
      ) {}
    },
    PressureValueSettings: {
      Pressure: class {
        constructor(public grams: number) {}
      },
    },
    WeightMeasurement: { fromGrams: (n: number) => n },
    LengthMeasurement: { fromValue: () => 0 },
    UnitLength: { millimeters: 1 },
  };
  assert.deepEqual(
    createPressurePassSettings(T, settings).map((p: any) => p.pressure.grams),
    [180, 80],
  );
  assert.deepEqual(
    resolveCutSettings({ ...settings, cutPressure: 'light' }).passPressures,
    [171, 71],
  );
  for (const change of [
    { blade: 'deepCut' },
    { machineId: 3 },
    { pressures: [290, -290] },
    { pressures: [4000, 4000] },
  ]) {
    const value = { ...settings, cutProfile: { ...settings.cutProfile!, ...change } };
    assert.ok(directCutIssue(value));
    assert.throws(() => resolveCutSettings(value));
  }
  for (const change of [
    { pressures: [80] },
    { pressure: NaN },
    { passes: 0 },
    { adjustment: [0] },
    { motion: [0, 100, 12, 200] },
  ])
    assert.throws(() =>
      readCutSettings({ ...settings, cutProfile: { ...settings.cutProfile, ...change } }),
    );
});
