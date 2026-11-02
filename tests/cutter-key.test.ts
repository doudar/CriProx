import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createProtectedKeyStore } = require('../electron/cutter/protected-key.cjs');
const { connectionKey, authenticateWithKey } = require('../electron/cutter/connection-key.cjs');
const version = '10.8.81';

test('model keys remain isolated across saving, reloading and forgetting', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skarix-model-keys-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createProtectedKeyStore({
    directory: () => dir,
    platform: 'win32',
    safeStorage: encryption(),
  });
  await store.save(version, 'explore-key');
  await store.save(version, 'maker-key', 'maker-5');
  assert.equal(await store.load(version), 'explore-key');
  assert.equal(await store.load(version, 'maker-5'), 'maker-key');
  assert.equal(await store.load(version, 'joy-2'), null);
  await store.clear('maker-5');
  assert.equal(await store.load(version, 'maker-5'), null);
  assert.equal(await store.load(version), 'explore-key');
  await assert.rejects(store.save(version, 'key', '../escape'));
});

// Authenticated encryption fixture exercises persistence/corruption without using real credentials.
function encryption() {
  const secret = randomBytes(32);
  return {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (text: string) => {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', secret, iv);
      const bytes = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    },
    decryptStringAsync: async (bytes: Buffer) => {
      const cipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return {
        result: Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(),
        shouldReEncrypt: false,
      };
    },
  };
}
test('protected cutter key persists as ciphertext, survives a new store, and can be forgotten', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'criprox-key-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = { directory: () => dir, platform: 'win32', safeStorage: encryption() };
  const store = createProtectedKeyStore(options);
  assert.equal(await store.load(version), null);
  await store.save(version, 'synthetic-machine-key');
  const bytes = await readFile(path.join(dir, 'cutter-key.bin'));
  assert.equal(bytes.includes(Buffer.from('synthetic-machine-key')), false);
  assert.deepEqual(await readdir(dir), ['cutter-key.bin']);
  const reopened = createProtectedKeyStore(options);
  assert.equal(await reopened.load(version), 'synthetic-machine-key');
  assert.equal(await reopened.load('uninspected'), null);
  await reopened.clear();
  assert.equal(await store.load(version), null);
  await reopened.clear();
});

test('unavailable protection, corrupt files, foreign users and wrong scopes never return a key', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'criprox-key-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const safeStorage = encryption(),
    options = { directory: () => dir, platform: 'win32', safeStorage };
  const store = createProtectedKeyStore(options);
  await assert.rejects(store.save('other', 'key'), /Invalid/);
  await assert.rejects(store.save(version, ''), /Invalid/);
  const unavailable = createProtectedKeyStore({
    ...options,
    safeStorage: {
      ...safeStorage,
      isAsyncEncryptionAvailable: async () => false,
    },
  });
  await assert.rejects(unavailable.save(version, 'key'), /unavailable/);
  assert.deepEqual(await readdir(dir), []);
  await store.save(version, 'key');
  assert.equal(await unavailable.load(version), null);
  assert.equal(
    await createProtectedKeyStore({ ...options, safeStorage: encryption() }).load(version),
    null,
  );
  assert.equal(
    await createProtectedKeyStore({ ...options, platform: 'linux' }).load(version),
    null,
  );
  for (const record of [
    { schema: 1, applicationVersion: version, machine: 'other', key: 'key' },
    { schema: 2, applicationVersion: version, machine: 'explore-5', key: 'key' },
    { schema: 1, applicationVersion: 'other', machine: 'explore-5', key: 'key' },
  ]) {
    await writeFile(
      path.join(dir, 'cutter-key.bin'),
      await safeStorage.encryptStringAsync(JSON.stringify(record)),
    );
    assert.equal(await store.load(version), null);
  }
  await writeFile(path.join(dir, 'cutter-key.bin'), 'corrupt');
  assert.equal(await store.load(version), null);
});

test('saved keys avoid session/network access, while refresh bypasses them and consent remains required', async () => {
  let reads = 0,
    fetches = 0;
  const options = {
    authorized: true,
    store: {
      load: async () => {
        reads++;
        return 'saved-key';
      },
    },
    fetchKey: async () => {
      fetches++;
      return 'fresh-key';
    },
  };
  assert.deepEqual(await connectionKey(version, options), { key: 'saved-key', cached: true });
  assert.equal(fetches, 0);
  assert.deepEqual(await connectionKey(version, { ...options, fresh: true }), {
    key: 'fresh-key',
    cached: false,
  });
  assert.equal(reads, 1);
  assert.deepEqual(
    await connectionKey(version, { ...options, store: { load: async () => null } }),
    { key: 'fresh-key', cached: false },
  );
  await assert.rejects(connectionKey(version, { ...options, authorized: false }), /Authorize/);
  await assert.rejects(connectionKey('unknown', options), /inspected/);
  assert.equal(reads, 1);
  assert.equal(fetches, 2);
});

test('only verified handshakes save keys; failed saved keys are removed for a fresh connection', async () => {
  const events: string[] = [];
  let encrypted = true;
  const device = {
    handshakeSkill: {
      establishEncryption: async () => {
        events.push('handshake');
      },
      isConnectionEncrypted: async () => {
        events.push('verify');
        return encrypted;
      },
    },
  };
  const store = {
    save: async () => {
      events.push('save');
      return true;
    },
    clear: async () => {
      events.push('clear');
    },
  };
  const record = { key: 'synthetic', cached: false };
  assert.equal(await authenticateWithKey(device, record, store, version), true);
  assert.deepEqual(events, ['handshake', 'verify', 'save']);
  assert.equal(record.key, undefined);
  events.length = 0;
  encrypted = false;
  await assert.rejects(
    authenticateWithKey(device, { key: 'synthetic', cached: true }, store, version),
    { code: 'RETRY_FRESH_KEY' },
  );
  assert.deepEqual(events, ['handshake', 'verify', 'clear']);
  events.length = 0;
  await assert.rejects(
    authenticateWithKey(device, { key: 'synthetic', cached: false }, store, version),
    /authentication failed/,
  );
  assert.deepEqual(events, ['handshake', 'verify']);
  encrypted = true;
  assert.equal(
    await authenticateWithKey(
      device,
      { key: 'synthetic', cached: false },
      {
        ...store,
        save: async () => {
          throw Error('disk unavailable');
        },
      },
      version,
    ),
    false,
  );
});

test('automatic saved-key connections never read the account session or fetch a replacement key', async () => {
  let fetches = 0;
  const fetchKey = async () => {
    fetches++;
    throw Error('must not fetch');
  };
  const saved = await connectionKey(version, {
    authorized: true,
    savedOnly: true,
    store: { load: async () => 'saved-key' },
    fetchKey,
  });
  assert.deepEqual(saved, { key: 'saved-key', cached: true });
  await assert.rejects(
    connectionKey(version, {
      authorized: true,
      savedOnly: true,
      store: { load: async () => null },
      fetchKey,
    }),
    /Open Design Space/,
  );
  await assert.rejects(
    connectionKey(version, {
      authorized: true,
      savedOnly: true,
      fresh: true,
      store: { load: async () => 'saved-key' },
      fetchKey,
    }),
    /Open Design Space/,
  );
  assert.equal(fetches, 0);
});

test('macOS protected storage supports saving, loading and deletion; Keychain denial never returns plaintext', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skarix-mac-key-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = { directory: () => dir, platform: 'darwin', safeStorage: encryption() };
  const store = createProtectedKeyStore(options);
  await store.save(version, 'synthetic-mac-key');
  assert.equal(await store.load(version), 'synthetic-mac-key');
  const denied = createProtectedKeyStore({
    ...options,
    safeStorage: { ...options.safeStorage, isAsyncEncryptionAvailable: async () => false },
  });
  assert.equal(await denied.load(version), null);
  await assert.rejects(denied.save(version, 'never-written'), /unavailable/);
  await store.clear();
  assert.equal(await store.load(version), null);
});
