const { fork } = require('node:child_process');
const path = require('node:path');
const { prepareSheetJob } = require('./sheet-job.cjs');
const CAPABILITIES = Object.freeze({
  connect: true,
  home: true,
  registrationScan: true,
  cut: true,
  pause: true,
  cancel: true,
  pressureTest: false,
});
function createCutterController({
  forkProcess = fork,
  platform = process.platform,
  onState = () => {},
  keyStore,
} = {}) {
  let child,
    closing,
    storageWork = Promise.resolve(),
    nextId = 0,
    pending,
    forgetting = false,
    state = { status: 'disconnected', encrypted: false, message: 'Not connected' };
  const snapshot = () => ({
    ...state,
    supported: platform === 'win32',
    capabilities: { ...CAPABILITIES },
  });
  const publish = (patch) => {
    state = { ...state, ...patch };
    if (['connecting', 'disconnected', 'error'].includes(state.status)) {
      delete state.carriage;
      delete state.queuedMoves;
      delete state.firmware;
      delete state.name;
      delete state.cutSettings;
      delete state.phase;
    }
    onState(snapshot());
  };
  const rejectPending = (error) => {
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = undefined;
    }
  };
  function start() {
    if (child) return;
    const current = forkProcess(path.join(__dirname, 'worker.cjs'), [], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    child = current;
    current.on('message', (event) => {
      if (child !== current || !event || typeof event !== 'object') return;
      if (event.type === 'key-store') {
        // Private worker IPC only; never publish the request or its result to the renderer.
        if (pending?.name !== 'connect' || !Number.isInteger(event.requestId)) return;
        const connectionRequest = pending.id;
        storageWork = storageWork
          .then(async () => {
            if (child !== current || pending?.id !== connectionRequest) return;
            let result = null,
              error;
            try {
              if (event.operation === 'load')
                result = (await keyStore?.load(event.applicationVersion)) ?? null;
              else if (event.operation === 'save' && keyStore) {
                await keyStore.save(event.applicationVersion, event.key);
                result = true;
              } else if (event.operation === 'clear' && keyStore) {
                await keyStore.clear();
                result = true;
              } else throw Error('Unsupported storage operation.');
            } catch {
              error = 'Could not access protected cutter key storage.';
            }
            if (child === current && current.connected !== false)
              current.send(
                { type: 'key-store-reply', requestId: event.requestId, result, error },
                () => {},
              );
          })
          .catch(() => {});
        return;
      }
      if (event.type === 'state' && event.state) publish(event.state);
      if (event.type === 'reply' && pending?.id === event.id) {
        const request = pending;
        pending = undefined;
        clearTimeout(request.timer);
        if (event.state) publish(event.state);
        if (event.error) request.reject(new Error(event.error));
        else request.resolve(snapshot());
      }
    });
    const ended = () => {
      if (child !== current) return;
      child = undefined;
      rejectPending(new Error('The cutter service stopped. Reconnect to continue.'));
      publish({
        status: 'error',
        encrypted: false,
        message: 'The cutter service stopped. Reconnect to continue.',
      });
    };
    current.on('error', ended);
    current.on('exit', ended);
  }
  async function command(name, options = {}) {
    if (platform !== 'win32')
      throw new Error('Direct Explore 5 connection currently requires Windows.');
    if (
      ![
        'connect',
        'disconnect',
        'forgetKey',
        'home',
        'cutSheet',
        'cancelCut',
        'pauseCut',
        'resumeCut',
      ].includes(name)
    )
      throw Error('Unsupported cutter command.');
    if (pending || forgetting) throw Error('The cutter is busy. Wait for the current operation.');
    if (state.status === 'cutting' && !['cancelCut', 'pauseCut', 'resumeCut'].includes(name))
      throw Error('The cutter job is active. Cancel it before another operation.');
    if (name === 'forgetKey') {
      if (!['disconnected', 'error'].includes(state.status))
        throw Error('Disconnect the cutter before forgetting its saved key.');
      // Reserve the controller while deletion is in progress, including against reconnects.
      forgetting = true;
      try {
        await storageWork;
        await keyStore?.clear();
        publish({
          status: 'disconnected',
          encrypted: false,
          message:
            'Saved cutter key forgotten. A current Design Space sign-in is needed to connect again.',
        });
        return snapshot();
      } catch {
        throw Error('Could not forget the saved cutter key. Try again.');
      } finally {
        forgetting = false;
      }
    }
    if (name === 'cutSheet') {
      if (state.status !== 'connected' || !state.encrypted || options.materialReady !== true)
        throw Error('Connect securely and confirm the printed sheet and fine-point blade first.');
      prepareSheetJob(options.job, options.sheetIndex);
    }
    if (
      ['cancelCut', 'pauseCut', 'resumeCut'].includes(name) &&
      (state.status !== 'cutting' || !state.encrypted)
    )
      throw Error('No cutter job is active.');
    if (name === 'resumeCut' && state.phase !== 'paused') throw Error('The cutter is not paused.');
    if (
      name === 'connect' &&
      (!['usb', 'ble'].includes(options.transport) || options.authorized !== true)
    )
      throw new Error('Choose USB or Bluetooth and authorize remembering the cutter key.');
    if (
      name === 'home' &&
      (options.bladeRemoved !== true || state.status !== 'connected' || !state.encrypted)
    )
      throw new Error('Connect securely and remove the blade before the homing test.');
    if (name === 'disconnect' && !child) {
      publish({ status: 'disconnected', encrypted: false, message: 'Not connected' });
      return snapshot();
    }
    start();
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          rejectPending(
            new Error('The cutter operation timed out. Check the machine before reconnecting.'),
          );
          const old = child;
          child = undefined;
          old?.disconnect();
          setTimeout(() => old?.kill(), 3000).unref?.();
          publish({
            status: 'error',
            encrypted: false,
            message: 'Operation timed out. Check the cutter before reconnecting.',
          });
        },
        name === 'connect' ? 120000 : name === 'home' ? 45000 : 25000,
      );
      pending = { id, name, timer, resolve, reject };
      child.send(
        {
          id,
          command: name,
          ...(name === 'connect'
            ? {
                transport: options.transport,
                authorized: true,
                ...(options.savedOnly === true ? { savedOnly: true } : {}),
              }
            : {}),
          ...(name === 'home' ? { bladeRemoved: true } : {}),
          ...(name === 'cutSheet'
            ? { materialReady: true, job: options.job, sheetIndex: options.sheetIndex }
            : {}),
        },
        (error) => {
          if (error) rejectPending(new Error('Could not contact the cutter service.'));
        },
      );
    });
  }
  function close() {
    if (!closing)
      closing = finishClose().finally(() => {
        closing = undefined;
      });
    return closing;
  }
  async function finishClose() {
    // Let an in-flight bounded operation finish before the ordinary disconnect.
    if (pending || forgetting) {
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (!pending && !forgetting) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      });
    }
    if (!child) return;
    if (state.status === 'cutting') {
      try {
        await command('cancelCut');
      } catch {}
    }
    try {
      await command('disconnect');
    } catch {}
    const old = child;
    child = undefined;
    if (old) {
      // The app awaits close() before quitting. Keep the fallback alive until
      // this worker exits; an unref'ed timer disappears when the parent quits.
      await new Promise((resolve) => {
        let timer;
        const finished = () => {
          clearTimeout(timer);
          old.removeListener('exit', finished);
          resolve();
        };
        old.once('exit', finished);
        timer = setTimeout(() => {
          try {
            old.kill();
          } finally {
            finished();
          }
        }, 3000);
        try {
          old.disconnect();
        } catch {
          try {
            old.kill();
          } finally {
            finished();
          }
        }
      });
    }
  }
  async function keyStatus() {
    if (platform !== 'win32' || forgetting) return { available: false };
    try {
      return { available: !!(await keyStore?.load('10.8.81')) };
    } catch {
      return { available: false };
    }
  }
  return { snapshot, command, close, keyStatus };
}
module.exports = { createCutterController, CAPABILITIES };
