import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  fields,
  one,
  uint,
  scalar,
  message,
  frame,
  FrameReader,
} = require('../electron/cutter/wire.cjs');
const { DiscoverySession, discoverCricutDevices } = require('../electron/cutter/discovery.cjs');

function fakeBridge(handler: (bytes: Buffer, reply: (bytes: Buffer) => void) => void) {
  const child = new EventEmitter() as any;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCount = 0;
  const reply = (bytes: Buffer) => {
    // Real stdout can split anywhere, including inside the length prefix.
    const bytesWithHeader = frame(bytes);
    child.stdout.write(bytesWithHeader.subarray(0, 2));
    child.stdout.write(bytesWithHeader.subarray(2, 5));
    child.stdout.write(bytesWithHeader.subarray(5));
  };
  const reader = new FrameReader((bytes: Buffer) => handler(bytes, reply));
  child.stdin = new Writable({
    write(bytes, _encoding, done) {
      reader.push(bytes);
      done();
    },
    final(done) {
      done();
      queueMicrotask(() => child.emit('close', 0));
    },
  });
  child.kill = () => {
    child.killCount++;
    child.emit('close', null);
  };
  return child;
}

test('DeviceIO encodes observed native adapter frames and reconstructs arbitrary chunks', () => {
  assert.equal(frame(message(40)).toString('hex'), '03000000c20200');
  const nativeResponse = Buffer.from('07000000ca02040a020801', 'hex');
  const actual: string[] = [];
  const reader = new FrameReader((bytes: Buffer) => actual.push(bytes.toString('hex')));
  const combined = Buffer.concat([nativeResponse, nativeResponse]);
  for (const byte of combined) reader.push(Buffer.from([byte]));
  assert.deepEqual(actual, ['ca02040a020801', 'ca02040a020801']);
  assert.equal(reader.pending.length, 0);
});

test('DeviceIO rejects oversized, truncated, invalid and ambiguous messages', () => {
  assert.throws(() => new FrameReader(() => {}).push(Buffer.from('ffffffff', 'hex')), /frame size/);
  assert.throws(() => new FrameReader(() => {}).push(Buffer.alloc(4)), /frame size/);
  assert.throws(() => fields(Buffer.from('0a04ff', 'hex')), /Truncated/);
  assert.throws(() => fields(Buffer.from('0880', 'hex')), /Truncated/);
  assert.throws(() => fields(Buffer.from('00', 'hex')), /Invalid/);
  assert.throws(() => fields(Buffer.from('0b', 'hex')), /Unsupported/);
  assert.throws(() => one(fields(Buffer.concat([scalar(1, 1), scalar(1, 2)])), 1, 0), /Invalid/);
  assert.throws(() => one(fields(message(1)), 1, 0), /Invalid/);
  assert.throws(() => uint(-1), /uint32/);
  assert.throws(() => uint(0x100000000), /uint32/);
  assert.equal(one(fields(scalar(1, 0xffffffff)), 1, 0), 0xffffffff);
});

test('USB discovery ignores logs and other adapter notifications, then destroys only its adapter', async () => {
  const sent: string[] = [];
  const child = fakeBridge((bytes, reply) => {
    sent.push(bytes.toString('hex'));
    if (sent.length === 1) {
      reply(message(1, message(2, Buffer.from('native log'))));
      reply(Buffer.from('ca02040a020807', 'hex'));
    } else if (sent.length === 2) {
      const descriptor = Buffer.concat([
        scalar(1, 1234),
        scalar(2, 24),
        scalar(3, 1),
        message(4, Buffer.from('fixture')),
        message(5, Buffer.from('test-usb')),
      ]);
      reply(message(3, Buffer.concat([message(1, scalar(1, 99)), message(52)])));
      reply(message(3, Buffer.concat([message(1, scalar(1, 7)), message(50)])));
      reply(
        message(3, Buffer.concat([message(1, scalar(1, 7)), message(52, message(1, descriptor))])),
      );
    } else reply(message(3, Buffer.concat([message(1, scalar(1, 7)), message(11)])));
  });
  const session = new DiscoverySession('fixture.exe', {
    spawnProcess: (executable: string, args: string[], options: any) => {
      assert.equal(executable, 'fixture.exe');
      assert.deepEqual(args, []);
      assert.equal(options.windowsHide, true);
      return child;
    },
  });
  try {
    assert.deepEqual(await session.enumerateUsb(), [
      { vendorId: 1234, productId: 24, revision: 1, serialNumber: 'fixture', osId: 'test-usb' },
    ]);
  } finally {
    await session.close();
  }
  assert.deepEqual(sent, ['c20200', '1a070a0208079a0300', '1a060a0208075200']);
  assert.equal(child.killCount, 0);
});

test('Bluetooth discovery enumerates while scanning, then stops and cleans up', async () => {
  const requests: number[] = [];
  const child = fakeBridge((bytes, reply) => {
    const top = fields(bytes);
    if (one(top, 30, 2)) {
      reply(message(31, message(1, scalar(1, 2))));
      return;
    }
    const nested = fields(one(top, 3, 2));
    const request = nested.find((field: any) => field.number !== 1).number;
    requests.push(request);
    let data = Buffer.alloc(0);
    if (request === 35) data = scalar(1, 1);
    if (request === 31)
      data = message(
        1,
        Buffer.concat([
          scalar(1, 1),
          scalar(2, 2),
          message(3, Buffer.from('test-device')),
          message(4, Buffer.from([1, 2, 3])),
        ]),
      );
    reply(message(3, Buffer.concat([message(1, scalar(1, 2)), message(request + 1, data)])));
  });
  const session = new DiscoverySession('fixture.exe', { spawnProcess: () => child });
  try {
    const result = await session.scanBluetooth(0);
    assert.equal(result.ready, true);
    assert.equal(result.devices[0].localName, 'test-device');
    assert.deepEqual(result.devices[0].manufacturerData, Buffer.from([1, 2, 3]));
  } finally {
    await session.close();
  }
  assert.deepEqual(requests, [35, 12, 31, 14, 10]);
});

test('Timeout poisons a session so late replies cannot satisfy a later request', async () => {
  const child = fakeBridge(() => {});
  const session = new DiscoverySession('fixture.exe', { spawnProcess: () => child, timeoutMs: 10 });
  await assert.rejects(session.enumerateUsb(), /timed out/);
  await assert.rejects(session.enumerateUsb(), /timed out/);
  await session.close();
  assert.equal(session.pending, null);
});

test('Malformed payload rejects the pending request instead of hanging', async () => {
  const child = fakeBridge((_bytes, reply) => reply(message(41, Buffer.from('0a04ff', 'hex'))));
  const session = new DiscoverySession('fixture.exe', { spawnProcess: () => child });
  await assert.rejects(session.enumerateUsb(), /Truncated/);
  await session.close();
});

test('Adapter errors and unsupported installations are explicit', async () => {
  const child = fakeBridge((_bytes, reply) =>
    reply(message(41, message(2, message(1, Buffer.from('fixture failure'))))),
  );
  const session = new DiscoverySession('fixture.exe', { spawnProcess: () => child });
  await assert.rejects(session.enumerateUsb(), /fixture failure/);
  await session.close();
  await assert.rejects(
    discoverCricutDevices({ installation: { bridgeInstalled: true, version: '99.0.0' } }),
    /inspected Design Space/,
  );
});

test('Unavailable Bluetooth does not start a scan', async () => {
  const requests: number[] = [];
  const child = fakeBridge((bytes, reply) => {
    const top = fields(bytes);
    if (one(top, 30, 2)) {
      reply(message(31, message(1, scalar(1, 2))));
      return;
    }
    const request = fields(one(top, 3, 2)).find((field: any) => field.number !== 1).number;
    requests.push(request);
    reply(message(3, Buffer.concat([message(1, scalar(1, 2)), message(request + 1)])));
  });
  const session = new DiscoverySession('fixture.exe', { spawnProcess: () => child });
  assert.deepEqual(await session.scanBluetooth(0, { readinessTimeoutMs: 0 }), {
    ready: false,
    devices: [],
  });
  await Promise.all([session.close(), session.close()]);
  assert.deepEqual(requests, [35, 10]);
});

test('Unexpected native process exit rejects the active request', async () => {
  const child = fakeBridge(() => queueMicrotask(() => child.emit('close', 9)));
  const session = new DiscoverySession('fixture.exe', { spawnProcess: () => child });
  await assert.rejects(session.enumerateUsb(), /exited unexpectedly/);
  await session.close();
});

const { DeviceSession } = require('../scripts/lib/cricut-device-session.cjs');

test('BLE transport routes notifications without completing the wrong request', async () => {
  const seen: number[] = [],
    received: string[] = [],
    states: number[] = [];
  const envelope = (transport: number, field: number, data = Buffer.alloc(0), adapter = 2) =>
    message(
      3,
      Buffer.concat([
        message(1, scalar(1, adapter)),
        message(100, Buffer.concat([message(1, scalar(1, transport)), message(field, data)])),
      ]),
    );
  const child = fakeBridge((bytes, reply) => {
    const top = fields(bytes);
    if (one(top, 30, 2)) {
      reply(message(31, message(1, scalar(1, 2))));
      return;
    }
    const adapter = fields(one(top, 3, 2));
    const create = one(adapter, 33, 2);
    if (create) {
      const params = fields(one(fields(create), 1, 2));
      assert.equal(one(params, 3, 2).toString('hex'), '49535343884143f4a8d4ecbe34729bb3');
      assert.equal(one(params, 8, 0), 0);
      reply(
        message(
          3,
          Buffer.concat([message(1, scalar(1, 2)), message(34, message(1, scalar(1, 7)))]),
        ),
      );
      return;
    }
    const payload = one(adapter, 100, 2);
    if (!payload) {
      reply(message(3, Buffer.concat([message(1, scalar(1, 2)), message(11)])));
      return;
    }
    const operation = fields(payload).find((f: any) => f.number !== 1);
    seen.push(operation.number);
    reply(envelope(7, operation.number + 1, scalar(1, 2), 99));
    reply(envelope(99, operation.number + 1, scalar(1, 2)));
    reply(envelope(7, 18, scalar(1, 2)));
    reply(envelope(7, 21, Buffer.concat([message(1, Buffer.from([0x02, 0x1a])), scalar(2, 1)])));
    queueMicrotask(() => reply(envelope(7, operation.number + 1, scalar(1, 1))));
  });
  const session = new DeviceSession('fixture.exe', { spawnProcess: () => child });
  try {
    session.adapterId = await session.create('ble');
    session.onBytes = (data: Buffer) => received.push(data.toString('hex'));
    session.onState = (state: number) => states.push(state);
    await session.createTransport(
      { deviceIdHigh: 1, deviceIdLow: 2 },
      {
        tx: '49535343-8841-43F4-A8D4-ECBE34729BB3',
        rx: '49535343-1E4D-4BD9-BA61-23C647249616',
      },
    );
    await session.operation(12, 13, scalar(1, 8000));
    await Promise.all([session.send(Buffer.from([1])), session.send(Buffer.from([2]))]);
    await session.operation(14, 15);
    await session.operation(10, 11);
    assert.deepEqual(seen, [12, 19, 19, 14, 10]);
    assert.deepEqual(received, Array(5).fill('021a'));
    assert.deepEqual(states, Array(5).fill(2));
  } finally {
    await session.close();
  }
  assert.equal(child.killCount, 0);
});

test('BLE transport timeout invalidates the session and rejects subsequent writes', async () => {
  let writes = 0;
  const child = fakeBridge(() => {
    writes++;
  });
  const session = new DeviceSession('fixture.exe', { spawnProcess: () => child, timeoutMs: 10 });
  session.adapterId = 2;
  session.transportId = 7;
  await assert.rejects(session.operation(12, 13), /timed out/);
  await assert.rejects(session.send(Buffer.from([1])), /timed out/);
  await session.close();
  assert.equal(writes, 1);
});

test('USB transport uses observed composite interface defaults and closes its own adapter', async () => {
  const child = fakeBridge((bytes, reply) => {
    const top = fields(bytes);
    if (one(top, 40, 2)) {
      reply(message(41, message(1, scalar(1, 3))));
      return;
    }
    const adapter = fields(one(top, 3, 2)),
      create = one(adapter, 53, 2);
    if (create) {
      const params = fields(one(fields(create), 1, 2));
      assert.equal(one(params, 1, 2).toString(), 'fixture');
      assert.equal(one(params, 2, 0), 1234);
      assert.equal(one(params, 3, 0), 24);
      assert.equal(one(params, 4, 0), 0);
      assert.equal(one(params, 5, 0), 1);
      reply(
        message(
          3,
          Buffer.concat([message(1, scalar(1, 3)), message(54, message(1, scalar(1, 8)))]),
        ),
      );
    } else reply(message(3, Buffer.concat([message(1, scalar(1, 3)), message(11)])));
  });
  const session = new DeviceSession('fixture.exe', { spawnProcess: () => child });
  try {
    session.adapterId = await session.create('usb');
    await session.createUsbTransport({ serialNumber: 'fixture', vendorId: 1234, productId: 24 });
    assert.equal(session.transportId, 8);
    await assert.rejects(
      session.createUsbTransport({ serialNumber: 'fixture', vendorId: 1234, productId: 24 }),
      /already created/,
    );
  } finally {
    await session.close();
  }
  assert.equal(child.killCount, 0);
});

test('Bluetooth waits for delayed readiness before starting the scan', async () => {
  let polls = 0;
  const requests: number[] = [];
  const child = fakeBridge((bytes, reply) => {
    const top = fields(bytes);
    if (one(top, 30, 2)) {
      reply(message(31, message(1, scalar(1, 2))));
      return;
    }
    const request = fields(one(top, 3, 2)).find((f: any) => f.number !== 1).number;
    requests.push(request);
    const payload = request === 35 ? scalar(1, ++polls >= 3 ? 1 : 0) : Buffer.alloc(0);
    reply(message(3, Buffer.concat([message(1, scalar(1, 2)), message(request + 1, payload)])));
  });
  const session = new DiscoverySession('fixture', { spawnProcess: () => child });
  assert.deepEqual(await session.scanBluetooth(0, { pollMs: 1 }), { ready: true, devices: [] });
  await session.close();
  assert.deepEqual(requests, [35, 35, 35, 12, 31, 14, 10]);
});

test('Bluetooth initialization can be cancelled without starting a scan or reusing an unsynchronized adapter', async () => {
  const abort = new AbortController();
  const requests: number[] = [];
  const child = fakeBridge((bytes, reply) => {
    const top = fields(bytes);
    if (one(top, 30, 2)) {
      reply(message(31, message(1, scalar(1, 2))));
      return;
    }
    const request = fields(one(top, 3, 2)).find((f: any) => f.number !== 1).number;
    requests.push(request);
    reply(message(3, Buffer.concat([message(1, scalar(1, 2)), message(request + 1)])));
    if (request === 35) queueMicrotask(() => abort.abort());
  });
  const session = new DiscoverySession('fixture', { spawnProcess: () => child });
  await assert.rejects(session.scanBluetooth(0, { signal: abort.signal }), /abort|cancel/i);
  await session.close();
  assert.deepEqual(requests, [35]);
});
