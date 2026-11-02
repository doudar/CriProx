const { fork } = require('node:child_process');
const { getMachine } = require('../cutters/catalog.cjs');
const { getProvider } = require('../cutters/registry.cjs');
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
  let connectionDone,
    child,
    closing,
    childProvider,
    selectedMachine = getMachine('explore-5'),
    storageWork = Promise.resolve(),
    nextId = 0,
    pending,
    forgetting = false,
    state = { status: 'disconnected', encrypted: false, message: 'Not connected' };
  const snapshot = () => ({
    ...state,
    machine: selectedMachine.id,
    provider: selectedMachine.provider,
    supported:
      selectedMachine.directConnect &&
      getProvider(selectedMachine).platforms.includes(platform) &&
      getProvider(selectedMachine).transports(selectedMachine, platform).length > 0,
    transports: getProvider(selectedMachine).transports(selectedMachine, platform),
    experimental: platform === 'darwin' || !selectedMachine.hardwareVerified,
    capabilities: {
      ...CAPABILITIES,
      cut: selectedMachine.directCut,
      registrationScan: selectedMachine.directCut,
    },
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
    const provider = getProvider(selectedMachine);
    if (child && childProvider !== provider.id) {
      const previous = child;
      child = undefined;
      previous.disconnect();
      previous.kill();
    }
    if (child) return;
    const current = forkProcess(provider.worker, [], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    child = current;
    childProvider = provider.id;
    current.on('message', (event) => {
      if (child !== current || !event || typeof event !== 'object') return;
      if (event.type === 'key-store') {
        // Private worker IPC only; never publish the request or its result to the renderer.
        if (pending?.name !== 'connect' || !Number.isInteger(event.requestId)) return;
        if ((event.machine ?? 'explore-5') !== selectedMachine.id) return;
        const connectionRequest = pending.id;
        storageWork = storageWork
          .then(async () => {
            if (child !== current || pending?.id !== connectionRequest) return;
            let result = null,
              error;
            try {
              if (event.operation === 'load')
                result =
                  (await keyStore?.load(event.applicationVersion, selectedMachine.id)) ?? null;
              else if (event.operation === 'save' && keyStore) {
                await keyStore.save(event.applicationVersion, event.key, selectedMachine.id);
                result = true;
              } else if (event.operation === 'clear' && keyStore) {
                await keyStore.clear(selectedMachine.id);
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
    if (name === 'disconnect' && pending?.name === 'connect') {
      child.send({ type: 'cancel-connect' }, () => {});
      await connectionDone;
      return snapshot();
    }
    if (pending || forgetting) throw Error('The cutter is busy. Wait for the current operation.');
    if (name === 'connect') {
      if (!['usb', 'ble'].includes(options.transport) || options.authorized !== true)
        throw Error('Choose USB or Bluetooth and authorize remembering the cutter key.');
      const machine = getMachine(options.machine ?? 'explore-5');
      if (!machine.directConnect) throw Error(machine.unavailableReason);
      if (!getProvider(machine).platforms.includes(platform))
        throw Error('This cutter provider requires the Windows or macOS desktop app.');
      if (!getProvider(machine).transports(machine, platform).includes(options.transport))
        throw Error(
          'Choose a supported connection type. macOS currently supports Explore 5 over Bluetooth LE.',
        );
      if (!['disconnected', 'error'].includes(state.status))
        throw Error('Disconnect the current cutter before connecting another machine.');
      selectedMachine = machine;
    }
    if (state.status === 'cutting' && !['cancelCut', 'pauseCut', 'resumeCut'].includes(name))
      throw Error('The cutter job is active. Cancel it before another operation.');
    if (name === 'forgetKey') {
      if (!['disconnected', 'error'].includes(state.status))
        throw Error('Disconnect the cutter before forgetting its saved key.');
      // Reserve the controller while deletion is in progress, including against reconnects.
      forgetting = true;
      try {
        await storageWork;
        const machine = getMachine(options.machine ?? selectedMachine.id);
        await keyStore?.clear(machine.id);
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
      if (!selectedMachine.directCut) throw Error(selectedMachine.unavailableReason);
      getProvider(selectedMachine).validateJob(options.job, options.sheetIndex, selectedMachine);
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
    const completion = new Promise((resolve, reject) => {
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
                machine: selectedMachine.id,
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
    if (name === 'connect') connectionDone = completion.then(snapshot, snapshot);
    return completion;
  }
  function close() {
    if (!closing)
      closing = finishClose().finally(() => {
        closing = undefined;
      });
    return closing;
  }
  async function finishClose() {
    if (pending?.name === 'connect') await command('disconnect');
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
  async function keyStatus(machineId = 'explore-5') {
    const machine = getMachine(machineId);
    if (!machine.directConnect || forgetting) return { available: false };
    const provider = getProvider(machine);
    if (!provider.platforms.includes(platform)) return { available: false };
    try {
      return { available: !!(await keyStore?.load(provider.applicationVersion, machine.id)) };
    } catch {
      return { available: false };
    }
  }
  return { snapshot, command, close, keyStatus };
}
module.exports = { createCutterController, CAPABILITIES };
