// Isolated native/WASM owner. The renderer never receives credentials, paths, or raw packets.
const { loadInstalledRuntime } = require('./runtime.cjs');
const { DeviceSession } = require('./device-session.cjs');
const { connectionKey, authenticateWithKey } = require('./connection-key.cjs');
const { homeIdleDevice } = require('./home.cjs');
const { startSheetJob } = require('./sheet-job.cjs');
const { bifrostMachine, createDevice, matchesDescriptor } = require('./bifrost-device.cjs');
let selectedMachine = bifrostMachine('explore-5');
const { one, scalar } = require('./wire.cjs');
console.log = console.error = () => {}; // Installed runtime diagnostics may contain device data.
let state = { status: 'disconnected', encrypted: false, message: 'Not connected' };
let storageRequestId = 0;
const storageRequests = new Map();
function storage(operation, applicationVersion, key) {
  return new Promise((resolve, reject) => {
    const requestId = ++storageRequestId;
    const timer = setTimeout(() => {
      storageRequests.delete(requestId);
      reject(Error('Could not access protected cutter key storage.'));
    }, 5000);
    storageRequests.set(requestId, { resolve, reject, timer });
    process.send?.({
      type: 'key-store',
      requestId,
      operation,
      applicationVersion,
      key,
      machine: selectedMachine.id,
    });
  });
}
const keyStore = {
  load: (version) => storage('load', version).catch(() => null),
  save: (version, key) => storage('save', version, key),
  clear: () => storage('clear'),
};
let initialization,
  session,
  activeJob,
  jobDeadline,
  connection,
  device,
  runtime,
  timer,
  polling,
  busy = false,
  closing = false;
const publish = (patch) => {
  state = { ...state, ...patch };
  process.send?.({ type: 'state', state });
};
function message(error) {
  const text = error instanceof Error ? error.message : 'The cutter did not respond.';
  // Only our descriptive errors are passed to the renderer, never SDK dumps.
  return /^(Open Design Space|The Cricut account|Could not|Cricut |Authenticated |Authorize |Invalid |Expected one|Bluetooth is|Carriage |Homing |The cutter|The research|Unverified|Missing or invalid|Cannot isolate)/.test(
    text,
  )
    ? text.slice(0, 300)
    : 'The cutter did not respond. Close Design Space, check the connection, and restart the cutter if needed.';
}
async function cleanup() {
  closing = true;
  clearTimeout(jobDeadline);
  const test = activeJob;
  activeJob = undefined;
  if (test) {
    try {
      if (state.encrypted) await test.cancel();
      else await test.abort();
    } catch {}
  }
  clearInterval(timer);
  timer = undefined;
  try {
    await polling;
  } catch {}
  try {
    await session?.sendQueue;
  } catch {}
  try {
    await connection?.disconnect();
  } catch {}
  try {
    if (session?.transportId !== undefined && !session.failure) await session.operation(10, 11);
  } catch {}
  try {
    await session?.close();
  } catch {}
  session = connection = device = undefined;
  closing = false;
}
async function connect(
  transport,
  authorized,
  fresh = false,
  savedOnly = false,
  machineId = 'explore-5',
) {
  const machine = bifrostMachine(machineId);
  if (!machine.transports.includes(transport))
    throw Error('Invalid connection type for this machine.');
  if (!['usb', 'ble'].includes(transport) || authorized !== true)
    throw Error('Authorize the Design Space connection first.');
  await cleanup();
  selectedMachine = machine;
  publish({
    status: 'connecting',
    machine: machine.id,
    transport,
    encrypted: false,
    firmware: undefined,
    name: undefined,
    message: fresh ? 'Refreshing the cutter key from Cricut…' : 'Checking saved cutter key…',
  });
  initialization?.signal.throwIfAborted();
  runtime ??= await loadInstalledRuntime();
  const keyRecord = await connectionKey(runtime.applicationVersion, {
    authorized,
    store: keyStore,
    fresh,
    savedOnly,
    machine: machine.id,
  });
  initialization?.signal.throwIfAborted();
  const { Bifrost: B, Runtime: R } = runtime.api;
  const config = B.ConnectionConfig.create(
    transport === 'usb' ? 'usbSerial' : 'bluetoothLowEnergySerial',
    machine.deviceType,
  );
  session = new DeviceSession(runtime.installation.bridgeExecutable, { timeoutMs: 12000 });
  let devices;
  publish({
    message: transport === 'usb' ? `Finding ${machine.name} on USB…` : 'Scanning Bluetooth…',
  });
  if (transport === 'usb') {
    devices = (await session.enumerateUsb()).filter((d) =>
      matchesDescriptor(B, machine, transport, d),
    );
    session.adapterId = [...session.adapters][0];
  } else {
    const found = await session.scanBluetooth(5000, { signal: initialization?.signal });
    if (!found.ready)
      throw Error(
        'Bluetooth is not ready after initialization. Enable Bluetooth and allow Bluetooth access for Skarix and its helper in system privacy settings, then try again.',
      );
    session.adapterId = [...session.adapters][0];
    devices = found.devices.filter((d) => matchesDescriptor(B, machine, transport, d));
  }
  if (devices.length !== 1)
    throw Error(
      `Expected one ${machine.name}; found ${devices.length}. Quit Design Space and other apps using the cutter, then connect one powered-on cutter. Select Explore 5 inside Skarix; do not pair it in system Bluetooth settings.`,
    );
  if (transport === 'usb') await session.createUsbTransport(devices[0]);
  else
    await session.createTransport(devices[0], {
      tx: B.DeviceType.getBluetoothLowEnergyTxUUID(machine.deviceType),
      rx: B.DeviceType.getBluetoothLowEnergyRxUUID(machine.deviceType),
    });
  let connectError;
  connection = B.GenericPhysicalConnection.create(
    async () => {
      try {
        await session.operation(12, 13, scalar(1, 8000));
        return R.Result.success();
      } catch (e) {
        connectError = e;
        return R.Result.failure('operationFailed');
      }
    },
    async () => {
      try {
        await session.operation(14, 15);
        return R.Result.success();
      } catch {
        return R.Result.failure('operationFailed');
      }
    },
    async (bytes) => {
      try {
        await session.send(bytes);
        return R.Result.success(bytes.byteLength);
      } catch {
        return R.Result.failure('operationFailed');
      }
    },
    { connectionParameters: config.connectionParams },
  );
  session.onBytes = (bytes) =>
    connection?.onDataReceived(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  session.onState = (value) => {
    if (value === 0) {
      connection?.onDisconnected();
      const test = activeJob;
      activeJob = undefined;
      clearTimeout(jobDeadline);
      if (test) void test.abort().catch(() => {});
      if (!closing && state.status !== 'connecting')
        publish({
          status: 'error',
          encrypted: false,
          message: 'The cutter disconnected. Reconnect before continuing.',
        });
    }
  };
  await connection.connect();
  if (connectError) throw connectError;
  publish({ message: `Authenticating ${machine.name}…` });
  device = createDevice(B, machine, connection);
  let remembered;
  try {
    remembered = await authenticateWithKey(device, keyRecord, keyStore, runtime.applicationVersion);
  } catch (error) {
    if (error.code === 'RETRY_FRESH_KEY' && !fresh && !savedOnly) {
      // A new transport/handshake is required; never retry on a half-open connection.
      return connect(transport, authorized, true, false, machine.id);
    }
    throw error;
  }
  initialization?.signal.throwIfAborted();
  const version = await device.deviceInformationSkill.getVersion();
  initialization?.signal.throwIfAborted();
  publish({
    status: 'connected',
    encrypted: true,
    firmware: `${version.major}.${version.minor}.${version.patch}`,
    name: `${machine.manufacturer} ${machine.name}`,
    message: remembered
      ? 'Connected and authenticated. Cutter key saved with operating system protection.'
      : 'Connected and authenticated. Could not save the cutter key; sign-in may be needed next time.',
  });
  timer = setInterval(() => {
    if (busy || polling || !device || state.status !== 'connected') return;
    polling = (async () => {
      try {
        const result = await device.moveSkill.getCarriageStatus();
        publish({ carriage: result.carriageState, queuedMoves: result.queuedMovesCount });
      } catch {
        publish({
          status: 'error',
          encrypted: false,
          message: 'Lost communication with the cutter. Reconnect before continuing.',
        });
      } finally {
        polling = undefined;
      }
    })();
  }, 3000);
}
process.on('message', async (request) => {
  if (request?.type === 'cancel-connect') {
    initialization?.abort();
    return;
  }
  if (request?.type === 'key-store-reply') {
    const pending = storageRequests.get(request.requestId);
    if (!pending) return;
    storageRequests.delete(request.requestId);
    clearTimeout(pending.timer);
    if (request.error) pending.reject(Error('Could not access protected cutter key storage.'));
    else pending.resolve(request.result);
    return;
  }
  if (!request || !Number.isInteger(request.id)) return;
  const reply = (error) =>
    process.send?.({ type: 'reply', id: request.id, state, ...(error ? { error } : {}) });
  if (busy) {
    reply('The cutter is busy. Wait for the current operation to finish.');
    return;
  }
  busy = true;
  try {
    if (activeJob && !['cancelCut', 'pauseCut', 'resumeCut'].includes(request.command))
      throw Error('The cutter job is active. Cancel it first.');
    if (request.command === 'connect') {
      initialization = new AbortController();
      await connect(
        request.transport,
        request.authorized,
        false,
        request.savedOnly === true,
        request.machine ?? 'explore-5',
      );
    } else if (request.command === 'disconnect') {
      publish({ status: 'disconnecting', message: 'Disconnecting…' });
      await cleanup();
      publish({
        status: 'disconnected',
        encrypted: false,
        message: 'Not connected',
        firmware: undefined,
        carriage: undefined,
        queuedMoves: undefined,
      });
    } else if (request.command === 'home') {
      if (state.status !== 'connected' || state.encrypted !== true || !device)
        throw Error('Authenticated connection required before homing.');
      if (request.bladeRemoved !== true)
        throw Error('The cutter homing test requires the blade to be removed.');
      await polling;
      publish({ status: 'homing', message: 'Homing the carriage…' });
      await homeIdleDevice(device);
      publish({
        status: 'connected',
        carriage: 'idle',
        queuedMoves: 0,
        message: 'Homing complete — carriage idle',
      });
    } else if (request.command === 'cutSheet') {
      if (state.status !== 'connected' || !state.encrypted || !device)
        throw Error('Authenticated connection required before cutting.');
      await polling;
      if (state.status !== 'connected' || !state.encrypted)
        throw Error('Authenticated connection lost before cutting.');
      const job = await startSheetJob({
        api: runtime.api,
        device,
        machine: selectedMachine.id,
        request,
        onUpdate: (message) => publish({ message }),
        onPhase: (phase) => publish({ phase }),
      });
      activeJob = job;
      publish({
        status: 'cutting',
        cutSettings: job.resolved,
        message:
          'Job ready. Load the printed sheet on the mat. Registration scanning and cutting will follow measurement.',
      });
      jobDeadline = setTimeout(
        () => {
          if (activeJob !== job) return;
          publish({ message: 'Cut job timed out. Cancelling…' });
          void job.cancel().catch(() =>
            publish({
              status: 'error',
              encrypted: false,
              message: 'Could not confirm cancellation. Stop the cutter using its controls.',
            }),
          );
        },
        30 * 60 * 1000,
      );
      job.done
        .then((result) => {
          if (activeJob !== job) return;
          activeJob = undefined;
          clearTimeout(jobDeadline);
          publish({
            status: 'connected',
            phase: undefined,
            cutSettings: undefined,
            message: result.cancelled ? 'Cut cancelled.' : 'Sheet cut complete — carriage idle.',
          });
        })
        .catch(async () => {
          if (activeJob !== job) return;
          activeJob = undefined;
          clearTimeout(jobDeadline);
          publish({
            status: 'error',
            encrypted: false,
            phase: undefined,
            cutSettings: undefined,
            message:
              'The cutter did not confirm a successful registered cut. Check the printed marks, material, and machine before reconnecting.',
          });
          await cleanup();
        });
    } else if (['cancelCut', 'pauseCut', 'resumeCut'].includes(request.command)) {
      if (!activeJob || !state.encrypted) throw Error('The cutter job is no longer active.');
      if (request.command === 'cancelCut') {
        publish({ message: 'Cancelling the cut…' });
        await activeJob.cancel();
      } else if (request.command === 'pauseCut') await activeJob.pause();
      else await activeJob.resume();
    } else throw Error('Unsupported cutter operation.');
    reply();
  } catch (e) {
    const error = message(e);
    const cancelled = request.command === 'connect' && initialization?.signal.aborted;
    await cleanup();
    if (cancelled) {
      publish({ status: 'disconnected', encrypted: false, message: 'Connection cancelled.' });
      reply();
      return;
    }
    publish({ status: 'error', encrypted: false, message: error });
    reply(error);
  } finally {
    if (request.command === 'connect') initialization = undefined;
    busy = false;
  }
});
process.on('disconnect', () => {
  initialization?.abort();
  void cleanup().finally(() => process.exit(0));
});
process.send?.({ type: 'ready', state });
