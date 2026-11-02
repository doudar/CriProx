const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { findCricutInstallation } = require('../cricut-installation.cjs');
const { message, scalar, fields, one, frame, FrameReader } = require('./wire.cjs');

// This client deliberately has no transport-create/connect/send-to-device operation.
// Adapter IDs belong to our child process, never to an existing Design Space process.
class DiscoverySession {
  constructor(executable, { spawnProcess = spawn, timeoutMs = 3000 } = {}) {
    this.pending = null;
    this.failure = null;
    this.closing = false;
    this.timeoutMs = timeoutMs;
    this.adapters = new Set();
    this.process = spawnProcess(executable, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.closed = new Promise((resolve) =>
      this.process.once('close', (code) => {
        this.isClosed = true;
        if (!this.closing)
          this.fail(new Error(`DeviceIO exited unexpectedly (${code ?? 'signal'})`));
        resolve();
      }),
    );
    this.process.on('error', (error) => this.fail(error));
    this.process.stdin.on('error', (error) => this.fail(error));
    // Drain diagnostics, which can contain local identifiers; don't persist or send them to the renderer.
    this.process.stderr.on('data', () => {});
    const reader = new FrameReader((body) => this.receive(body));
    this.process.stdout.on('data', (bytes) => {
      try {
        reader.push(bytes);
      } catch (error) {
        this.fail(error);
      }
    });
  }
  fail(error) {
    this.failure ??= error;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
  }
  receive(body) {
    const envelope = fields(body);
    const pending = this.pending;
    if (!pending) return;
    let response = one(envelope, pending.envelopeField, 2);
    if (!response) return; // Logs and asynchronous notifications do not complete a request.
    if (pending.adapterId !== undefined) {
      const nested = fields(response),
        adapter = one(nested, 1, 2);
      if (!adapter || one(fields(adapter), 1, 0) !== pending.adapterId) return;
      response = one(nested, pending.responseField, 2);
      if (!response) return;
    }
    const decoded = fields(response);
    clearTimeout(pending.timer);
    this.pending = null;
    pending.resolve(decoded);
  }
  request(bytes, envelopeField, adapterId, responseField, timeoutMs = this.timeoutMs) {
    if (this.closing || this.failure)
      return Promise.reject(this.failure || new Error('DeviceIO is closed'));
    if (this.pending) return Promise.reject(new Error('DeviceIO operation already in progress'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error('DeviceIO response timed out')),
        timeoutMs,
      );
      this.pending = { resolve, reject, timer, envelopeField, adapterId, responseField };
      try {
        this.process.stdin.write(frame(bytes));
      } catch (error) {
        this.fail(error);
      }
    });
  }
  async create(kind) {
    const request = kind === 'usb' ? 40 : 30;
    const response = await this.request(message(request), request + 1);
    const error = one(response, 2, 2);
    if (error)
      throw new Error(
        `DeviceIO adapter: ${one(fields(error), 1, 2)?.toString('utf8') || 'creation failed'}`,
      );
    const adapter = one(response, 1, 2);
    const id = adapter && one(fields(adapter), 1, 0);
    if (!Number.isInteger(id) || id < 0 || id > 0xffffffff)
      throw new Error('DeviceIO returned no adapter ID');
    this.adapters.add(id);
    return id;
  }
  adapterRequest(id, request, response, timeoutMs) {
    if (!this.adapters.has(id)) throw new Error('Unknown DeviceIO adapter');
    return this.request(
      message(3, Buffer.concat([message(1, scalar(1, id)), message(request)])),
      3,
      id,
      response,
      timeoutMs,
    );
  }
  async enumerateUsb() {
    const id = await this.create('usb');
    const response = await this.adapterRequest(id, 51, 52);
    return response
      .filter((field) => field.number === 1)
      .map((field) => {
        if (field.wire !== 2) throw new Error('Invalid USB descriptor');
        const descriptor = fields(field.value);
        return {
          vendorId: one(descriptor, 1, 0) ?? 0,
          productId: one(descriptor, 2, 0) ?? 0,
          revision: one(descriptor, 3, 0) ?? 0,
          serialNumber: one(descriptor, 4, 2)?.toString('utf8') ?? '',
          osId: one(descriptor, 5, 2)?.toString('utf8') ?? '',
        };
      });
  }
  async waitForBluetoothReady(id, { signal, readinessTimeoutMs = 5000, pollMs = 250 } = {}) {
    if (
      !Number.isInteger(readinessTimeoutMs) ||
      readinessTimeoutMs < 0 ||
      readinessTimeoutMs > 5000 ||
      !Number.isInteger(pollMs) ||
      pollMs < 1 ||
      pollMs > 250
    )
      throw Error('Invalid Bluetooth readiness deadline.');
    const deadline = Date.now() + readinessTimeoutMs;
    do {
      signal?.throwIfAborted();
      if (this.failure || this.closing) throw this.failure || Error('DeviceIO is closed');
      const remaining = Math.max(1, deadline - Date.now());
      if (
        one(await this.adapterRequest(id, 35, 36, Math.min(this.timeoutMs, remaining)), 1, 0) === 1
      )
        return true;
      if (Date.now() >= deadline) return false;
      await delay(Math.min(pollMs, deadline - Date.now()), undefined, { signal });
    } while (Date.now() < deadline);
    return false;
  }
  async scanBluetooth(durationMs = 1500, options = {}) {
    const { signal } = options;
    signal?.throwIfAborted();
    const abort = () => this.fail(new Error('Bluetooth initialization or scan cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 5000)
        throw new Error('Bluetooth scan duration must be between 0 and 5000 ms');
      const id = await this.create('ble');
      const ready = await this.waitForBluetoothReady(id, options);
      if (!ready) return { ready: false, devices: [] };
      const checkError = (response) => {
        const error = one(response, 1, 2);
        if (error)
          throw new Error(
            `Bluetooth scan: ${one(fields(error), 1, 2)?.toString('utf8') || 'failed'}`,
          );
      };
      checkError(await this.adapterRequest(id, 12, 13));
      await delay(durationMs, undefined, { signal });
      const response = await this.adapterRequest(id, 31, 32);
      checkError(await this.adapterRequest(id, 14, 15));
      const devices = response
        .filter((field) => field.number === 1)
        .map((field) => {
          if (field.wire !== 2) throw new Error('Invalid Bluetooth descriptor');
          const descriptor = fields(field.value);
          return {
            deviceIdHigh: one(descriptor, 1, 0) ?? 0,
            deviceIdLow: one(descriptor, 2, 0) ?? 0,
            localName: one(descriptor, 3, 2)?.toString('utf8') ?? '',
            manufacturerData: one(descriptor, 4, 2) ?? Buffer.alloc(0),
          };
        });
      return { ready, devices };
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
  close() {
    this.closePromise ??= this.finishClose();
    return this.closePromise;
  }
  async finishClose() {
    // A timed-out protocol is no longer synchronized; don't issue another request on it.
    for (const id of this.adapters) {
      if (this.failure) break;
      try {
        await this.adapterRequest(id, 10, 11);
      } catch {
        break;
      }
    }
    this.closing = true;
    this.fail(new Error('DeviceIO session closed'));
    this.process.stdin.end();
    if (this.isClosed) return;
    const killTimer = setTimeout(() => this.process.kill(), 1000);
    try {
      await this.closed;
    } finally {
      clearTimeout(killTimer);
    }
  }
}

async function discoverCricutDevices({ bluetooth = false, installation, sessionOptions } = {}) {
  const installed = installation ?? (await findCricutInstallation());
  if (!installed?.bridgeInstalled) throw new Error('Cricut DeviceIO is not installed');
  if (
    installed.platform === 'darwin'
      ? installed.applicationVersion !== '10.8.81'
      : installed.version !== '43.2.0'
  )
    throw new Error('DeviceIO diagnostics require the inspected Design Space build.');
  const executable = installed.bridgeExecutable;
  const session = new DiscoverySession(executable, sessionOptions);
  try {
    const usb = await session.enumerateUsb();
    const ble = bluetooth ? await session.scanBluetooth() : null;
    return { designSpaceVersion: installed.version, bridgeResponded: true, usb, bluetooth: ble };
  } finally {
    await session.close();
  }
}

module.exports = { DiscoverySession, discoverCricutDevices };
