import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MACHINES, getMachine, generatedSheetIssue } from '../src/lib/machine-guides';
import { newStickerProject, validateStickerProject } from '../src/lib/stickers';
const require = createRequire(import.meta.url);
const { getProvider } = require('../electron/cutters/registry.cjs');
const {
  createDevice,
  bifrostMachine,
  matchesDescriptor,
} = require('../electron/cutter/bifrost-device.cjs');
const { prepareSheetJob } = require('../electron/cutter/sheet-job.cjs');
const { BUILTIN_MATERIALS } = require('../electron/cutter/materials.cjs');
const { createCutterController } = require('../electron/cutter/controller.cjs');
const sheetJob = require('./fixtures/sheet-job.cjs');

test('every listed cutter survives project validation without changing its model', () => {
  for (const machine of MACHINES.filter((m) => m.id !== 'manual')) {
    const project = newStickerProject();
    project.machine = machine.id as typeof project.machine;
    assert.equal(validateStickerProject(JSON.parse(JSON.stringify(project))).machine, machine.id);
  }
  assert.equal(getMachine('explore-5').name, 'Explore 5');
  assert.throws(() => getMachine('__proto__'));
});

test('model factories and descriptor filters cannot connect a different Cricut family', () => {
  for (const id of ['explore-5', 'maker-5', 'joy-2']) {
    const model = bifrostMachine(id);
    const connection = {};
    const B = {
      [model.deviceClass]: {
        createDevice: (value: object) => ({ connection: value, family: model.machineFamily }),
      },
      DeviceType: { fromUsbSerialDescriptor: () => model.deviceType },
    };
    assert.deepEqual(createDevice(B, model, connection), {
      connection,
      family: model.machineFamily,
    });
    assert.equal(matchesDescriptor(B, model, 'usb', {}), true);
    B.DeviceType.fromUsbSerialDescriptor = () => 'unrelated';
    assert.equal(matchesDescriptor(B, model, 'usb', {}), false);
    assert.throws(() => createDevice({}, model, connection), /runtime does not support/);
  }
  assert.throws(() => bifrostMachine('maker-4'), /legacy driver/);
});

test('registered jobs require the matching connected model and material family', () => {
  const model = getMachine('maker-5');
  const job = sheetJob();
  job.machine = model.id;
  assert.throws(() => prepareSheetJob(JSON.stringify(job), 0), /Maker 5 material profile/);
  job.cutSettings.profile = {
    ...BUILTIN_MATERIALS[0],
    machineId: 20,
    machineName: 'Cricut Maker 5',
  };
  job.cutSettings.material = job.cutSettings.profile.id;
  const provider = getProvider(model);
  assert.equal(provider.validateJob(JSON.stringify(job), 0, model).machine, model.id);
  assert.throws(
    () => provider.validateJob(JSON.stringify(job), 0, getMachine('explore-5')),
    /different cutter/,
  );
  for (const id of ['joy', 'joy-2', 'expression']) {
    assert.ok(generatedSheetIssue(id, 'letter'));
    job.machine = id;
    assert.throws(() => prepareSheetJob(JSON.stringify(job), 0));
  }
});

test('unsupported providers and platforms never launch a cutter service', async () => {
  let starts = 0;
  const controller = createCutterController({
    platform: 'darwin',
    forkProcess: () => {
      starts++;
      throw Error();
    },
  });
  await assert.rejects(
    controller.command('connect', { machine: 'maker-5', transport: 'usb', authorized: true }),
    /supported connection type/,
  );
  await assert.rejects(
    controller.command('connect', { machine: 'maker-4', transport: 'usb', authorized: true }),
    /legacy driver/,
  );
  await assert.rejects(
    controller.command('connect', { machine: '../../other', transport: 'usb', authorized: true }),
    /Unknown cutting machine/,
  );
  assert.equal(starts, 0);
});
