const path = require('node:path');
// Provider contract: fixed worker, platform support, credential scope and job validation.
// No paths, SDK class names or authentication endpoints come from renderer input.
module.exports = Object.freeze({
  id: 'cricut',
  platforms: Object.freeze(['win32', 'darwin']),
  transports(machine, platform) {
    return platform === 'darwin' ? (machine.id === 'explore-5' ? ['ble'] : []) : machine.transports;
  },
  worker: path.join(__dirname, '../../cutter/worker.cjs'),
  applicationVersion: '10.8.81',
  validateJob(text, sheetIndex, machine) {
    const prepared = require('../../cutter/sheet-job.cjs').prepareSheetJob(text, sheetIndex);
    if (prepared.machine !== machine.id)
      throw Error(
        'The prepared sheet belongs to a different cutter. Disconnect and select the matching machine.',
      );
    return prepared;
  },
});
