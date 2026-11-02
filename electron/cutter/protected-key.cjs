// Main-process only. This fixed store never accepts paths or credentials from the renderer.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { bifrostMachine } = require('./bifrost-device.cjs');
const VERSION = '10.8.81';
const validKey = (key) => typeof key === 'string' && key.length > 0 && key.length <= 16384;

function createProtectedKeyStore({ safeStorage, directory, platform = process.platform }) {
  const file = (machine) => {
    bifrostMachine(machine);
    return path.join(
      directory(),
      machine === 'explore-5' ? 'cutter-key.bin' : `cutter-key-${machine}.bin`,
    );
  };
  async function available() {
    return (
      ['win32', 'darwin'].includes(platform) && (await safeStorage.isAsyncEncryptionAvailable())
    );
  }
  async function save(applicationVersion, key, machine = 'explore-5') {
    const target = file(machine);
    if (applicationVersion !== VERSION || !validKey(key)) throw Error('Invalid cutter key.');
    if (!(await available())) throw Error('Protected storage unavailable.');
    const encrypted = await safeStorage.encryptStringAsync(
      JSON.stringify({
        schema: 1,
        machine,
        applicationVersion,
        key,
      }),
    );
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  async function load(applicationVersion, machine = 'explore-5') {
    if (applicationVersion !== VERSION) return null;
    try {
      if (!(await available())) return null;
      const target = file(machine);
      if ((await fs.stat(target)).size > 128 * 1024) return null;
      const decrypted = await safeStorage.decryptStringAsync(await fs.readFile(target));
      const record = JSON.parse(decrypted.result);
      if (
        record.schema !== 1 ||
        record.machine !== machine ||
        record.applicationVersion !== applicationVersion ||
        !validKey(record.key)
      )
        return null;
      if (decrypted.shouldReEncrypt) await save(applicationVersion, record.key, machine);
      return record.key;
    } catch {
      // Missing, corrupt, foreign-user or unavailable storage falls back to ordinary sign-in.
      return null;
    }
  }
  async function clear(machine = 'explore-5') {
    await fs.rm(file(machine), { force: true });
  }
  return { load, save, clear };
}
module.exports = { createProtectedKeyStore, validKey };
