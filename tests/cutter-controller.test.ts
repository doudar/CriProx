import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCutterController } = require('../electron/cutter/controller.cjs');
const { sessionFromCache, getMachineKey } = require('../electron/cutter/session-key.cjs');
function fixture(options: Record<string, unknown> = {}) {
  const child = new EventEmitter() as EventEmitter & {
    send: Function;
    disconnect: Function;
    kill: Function;
  };
  const sent: any[] = [];
  child.send = (message: any, cb: Function) => {
    sent.push(message);
    cb();
  };
  child.disconnect = () => {
    queueMicrotask(() => child.emit('exit', 0));
  };
  child.kill = () => child.emit('exit', 0);
  let starts = 0;
  const controller = createCutterController({
    ...options,
    platform: 'win32',
    forkProcess: () => {
      starts++;
      return child;
    },
  });
  return {
    controller,
    child,
    sent,
    starts: () => starts,
    reply: (state: any) => child.emit('message', { type: 'reply', id: sent.at(-1).id, state }),
  };
}
test('key storage IPC stays private, requires a connection request, and forget cannot race a connection', async () => {
  let key: string | null = 'synthetic-key';
  const states: any[] = [];
  const f = fixture({
    onState: (state: any) => states.push(state),
    keyStore: {
      load: async () => key,
      save: async (_: string, next: string) => {
        key = next;
      },
      clear: async () => {
        key = null;
      },
    },
  });
  const connect = f.controller.command('connect', { transport: 'usb', authorized: true });
  const id = f.sent[0].id;
  await assert.rejects(f.controller.command('forgetKey'), /busy/);
  f.child.emit('message', {
    type: 'key-store',
    operation: 'load',
    requestId: 1,
    applicationVersion: '10.8.81',
  });
  await new Promise(setImmediate);
  assert.equal(f.sent.at(-1).result, 'synthetic-key');
  assert.equal(JSON.stringify(states).includes('synthetic-key'), false);
  f.child.emit('message', { type: 'reply', id, state: { status: 'connected', encrypted: true } });
  await connect;
  await assert.rejects(f.controller.command('forgetKey'), /Disconnect/);
  const sent = f.sent.length;
  f.child.emit('message', { type: 'key-store', operation: 'load', requestId: 2 });
  await new Promise(setImmediate);
  assert.equal(f.sent.length, sent);
  const disconnect = f.controller.command('disconnect');
  f.reply({ status: 'disconnected', encrypted: false });
  await disconnect;
  const forget = f.controller.command('forgetKey');
  await assert.rejects(
    f.controller.command('connect', { transport: 'usb', authorized: true }),
    /busy/,
  );
  await forget;
  assert.equal(key, null);
  assert.match(f.controller.snapshot().message, /forgotten/);
  const close = f.controller.close();
  f.reply({ status: 'disconnected', encrypted: false });
  await close;
});
test('native cutter commands require session authorization and a verified connection before motion', async () => {
  const f = fixture();
  await assert.rejects(f.controller.command('cut'), /Unsupported/);
  await assert.rejects(f.controller.command('connect', { transport: 'usb' }), /authorize/);
  await assert.rejects(
    f.controller.command('connect', { transport: 'serial', authorized: true }),
    /authorize/,
  );
  await assert.rejects(f.controller.command('home', { bladeRemoved: true }), /Connect securely/);
  assert.equal(f.starts(), 0);
  const connect = f.controller.command('connect', { transport: 'usb', authorized: true });
  await assert.rejects(
    f.controller.command('connect', { transport: 'usb', authorized: true }),
    /busy/,
  );
  f.reply({ status: 'connected', encrypted: true, firmware: '4.8.2', carriage: 'idle' });
  await connect;
  await assert.rejects(f.controller.command('home', { bladeRemoved: false }), /remove the blade/);
  const home = f.controller.command('home', { bladeRemoved: true });
  assert.deepEqual(Object.keys(f.sent.at(-1)).sort(), ['bladeRemoved', 'command', 'id']);
  f.reply({ status: 'connected', encrypted: true });
  await home;
  const close = f.controller.close();
  f.reply({ status: 'disconnected', encrypted: false });
  await close;
  assert.equal(f.controller.snapshot().status, 'disconnected');
  assert.equal(f.controller.snapshot().firmware, undefined);
  assert.equal(f.controller.snapshot().capabilities.cut, true);
});
test('sheet cuts validate prepared geometry and readiness and allow pause, resume and cancellation', async () => {
  const f = fixture();
  const job = require('./fixtures/sheet-job.cjs')();
  const options = { job: JSON.stringify(job), sheetIndex: 0, materialReady: true };
  await assert.rejects(f.controller.command('pressureTest', options), /Unsupported/);
  await assert.rejects(f.controller.command('cutSheet', options), /Connect securely/);
  const connect = f.controller.command('connect', { transport: 'usb', authorized: true });
  f.reply({ status: 'connected', encrypted: true });
  await connect;
  await assert.rejects(
    f.controller.command('cutSheet', { ...options, materialReady: false }),
    /confirm/,
  );
  await assert.rejects(f.controller.command('cutSheet', { ...options, sheetIndex: 9 }), /Invalid/);
  const cut = f.controller.command('cutSheet', {
    ...options,
    path: 'arbitrary',
    pressureGrams: 9000,
  });
  assert.deepEqual(Object.keys(f.sent.at(-1)).sort(), [
    'command',
    'id',
    'job',
    'materialReady',
    'sheetIndex',
  ]);
  f.reply({ status: 'cutting', encrypted: true });
  await cut;
  await assert.rejects(f.controller.command('disconnect'), /Cancel/);
  await assert.rejects(f.controller.command('cutSheet', options), /Cancel/);
  await assert.rejects(f.controller.command('resumeCut'), /not paused/);
  const pause = f.controller.command('pauseCut');
  f.reply({ status: 'cutting', encrypted: true, phase: 'paused' });
  await pause;
  const resume = f.controller.command('resumeCut', { passes: 99 });
  assert.deepEqual(Object.keys(f.sent.at(-1)).sort(), ['command', 'id']);
  f.reply({ status: 'cutting', encrypted: true, phase: 'working' });
  await resume;
  const cancel = f.controller.command('cancelCut');
  f.reply({ status: 'connected', encrypted: true });
  await cancel;
  const close = f.controller.close();
  f.reply({ status: 'disconnected', encrypted: false });
  await close;
});

test('worker termination rejects the pending request and loses authenticated state', async () => {
  const f = fixture(),
    connect = f.controller.command('connect', { transport: 'usb', authorized: true });
  f.child.emit('exit', 1);
  await assert.rejects(connect, /service stopped/);
  assert.equal(f.controller.snapshot().encrypted, false);
  await assert.rejects(f.controller.command('home', { bladeRemoved: true }), /Connect securely/);
  await f.controller.close();
});
test('late worker replies cannot complete a different pending command', async () => {
  const f = fixture(),
    connect = f.controller.command('connect', { transport: 'usb', authorized: true });
  f.child.emit('message', {
    type: 'reply',
    id: 999,
    state: { status: 'connected', encrypted: true },
  });
  assert.equal(f.controller.snapshot().encrypted, false);
  f.reply({ status: 'connected', encrypted: true });
  await connect;
  const close = f.controller.close();
  f.reply({ status: 'disconnected', encrypted: false });
  await close;
});
test('closing waits for the cutter helper to exit before application quit can continue', async () => {
  const f = fixture();
  const connect = f.controller.command('connect', { transport: 'usb', authorized: true });
  f.reply({ status: 'connected', encrypted: true });
  await connect;
  f.child.disconnect = () => {};
  let finished = false;
  const closing = f.controller.close().then(() => {
    finished = true;
  });
  f.reply({ status: 'disconnected', encrypted: false });
  await new Promise(setImmediate);
  assert.equal(finished, false, 'close returned while the helper was still running');
  let secondFinished = false;
  const secondClose = f.controller.close().then(() => {
    secondFinished = true;
  });
  await new Promise(setImmediate);
  assert.equal(secondFinished, false, 'a repeated close bypassed pending helper cleanup');
  f.child.emit('exit', 0);
  await Promise.all([closing, secondClose]);
  assert.equal(finished, true);
});

test('closing terminates a helper that ignores IPC disconnect after a bounded grace period', async () => {
  const f = fixture();
  const connect = f.controller.command('connect', { transport: 'usb', authorized: true });
  f.reply({ status: 'connected', encrypted: true });
  await connect;
  f.child.disconnect = () => {};
  let killed = false;
  f.child.kill = () => {
    killed = true;
    f.child.emit('exit', 0);
  };
  const closing = f.controller.close();
  f.reply({ status: 'disconnected', encrypted: false });
  await closing;
  assert.equal(killed, true);
});

test('browser and unsupported hosts cannot start the native worker', async () => {
  const c = createCutterController({
    platform: 'linux',
    forkProcess: () => assert.fail('must not start'),
  });
  assert.equal(c.snapshot().supported, false);
  await assert.rejects(c.command('connect', { transport: 'usb', authorized: true }), /Windows/);
});

test('key availability exposes only a boolean and saved-only commands cannot request account refresh', async () => {
  const f = fixture({ keyStore: { load: async () => 'never-publish-this-key' } });
  const status = await f.controller.keyStatus();
  assert.deepEqual(status, { available: true });
  assert.ok(!JSON.stringify(status).includes('never-publish'));
  assert.equal(f.starts(), 0);
  const connect = f.controller.command('connect', {
    transport: 'usb',
    authorized: true,
    savedOnly: true,
    refresh: true,
  });
  assert.equal(f.sent.at(-1).savedOnly, true);
  assert.equal(f.sent.at(-1).refresh, undefined);
  f.reply({ status: 'connected', encrypted: true });
  await connect;
  const close = f.controller.close();
  f.reply({ status: 'disconnected', encrypted: false });
  await close;
  const unavailable = fixture({
    keyStore: {
      load: async () => {
        throw Error('private storage details');
      },
    },
  });
  assert.deepEqual(await unavailable.controller.keyStatus(), { available: false });
});
function cache() {
  return [
    {
      cacheKey: '@@auth0spajs@@::test-client::api',
      expiresAt: 2000,
      body: {
        client_id: 'test-client',
        audience: 'https://apis.cricut.com/public',
        access_token: 'synthetic-test-token',
      },
    },
    {
      cacheKey: '@@auth0spajs@@::test-client::user',
      decodedToken: { user: { 'https://apis.cricut.com/claims/cricut-user-id': '12345' } },
    },
  ];
}
test('session reuse requires one unexpired Cricut audience and its matching identity', () => {
  assert.deepEqual(sessionFromCache(cache(), 1000000), {
    accessToken: 'synthetic-test-token',
    userId: '12345',
  });
  assert.throws(() => sessionFromCache(cache(), 2000000), /sign in again/);
  assert.throws(() => sessionFromCache([...cache(), cache()[0]], 1000000), /unique/);
  const other = cache();
  other[0].body!.audience = 'https://example.com';
  assert.throws(() => sessionFromCache(other, 1000000), /unique/);
  assert.throws(() => sessionFromCache([cache()[0]], 1000000), /account/);
});
test('machine key retrieval refuses missing consent and uninspected builds before reading any cache', async () => {
  const fetchImpl = () => assert.fail('no request permitted');
  await assert.rejects(getMachineKey('10.8.81', { fetchImpl, profile: 'missing' }), /Authorize/);
  await assert.rejects(
    getMachineKey('unknown', { authorized: true, fetchImpl, profile: 'missing' }),
    /inspected/,
  );
});

test('connection cancellation is forwarded without racing a second worker request', async () => {
  const f = fixture();
  const connect = f.controller.command('connect', { transport: 'ble', authorized: true });
  const id = f.sent[0].id;
  const cancel = f.controller.command('disconnect');
  assert.deepEqual(f.sent[1], { type: 'cancel-connect' });
  f.child.emit('message', {
    type: 'reply',
    id,
    state: { status: 'disconnected', encrypted: false, message: 'Connection cancelled.' },
  });
  await connect;
  assert.equal((await cancel).status, 'disconnected');
});

test('macOS Explore 5 BLE exposes verified cutting and scopes saved keys to the model', async () => {
  let child: any;
  const sent: any[] = [];
  const c = createCutterController({
    platform: 'darwin',
    keyStore: { load: async () => 'synthetic' },
    forkProcess: () => {
      child = new EventEmitter();
      child.send = (m: any, callback: Function) => {
        sent.push(m);
        callback();
      };
      return child;
    },
  });
  assert.equal(c.snapshot().supported, true);
  assert.equal(c.snapshot().capabilities.cut, true);
  assert.equal(c.snapshot().experimental, false);
  assert.deepEqual(c.snapshot().transports, ['ble']);
  assert.deepEqual(await c.keyStatus('explore-5'), { available: true });
  const connect = c.command('connect', {
    transport: 'ble',
    authorized: true,
    machine: 'explore-5',
  });
  child.emit('message', {
    type: 'reply',
    id: sent[0].id,
    state: { status: 'connected', encrypted: true },
  });
  await connect;
  const cut = c.command('cutSheet', {
    job: JSON.stringify(require('./fixtures/sheet-job.cjs')()),
    sheetIndex: 0,
    materialReady: true,
  });
  assert.equal(sent.at(-1).command, 'cutSheet');
  child.emit('message', {
    type: 'reply',
    id: sent.at(-1).id,
    state: { status: 'cutting', encrypted: true },
  });
  await cut;
});
