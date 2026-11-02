const { getMachineKey } = require('./session-key.cjs');

async function connectionKey(
  applicationVersion,
  {
    authorized,
    store,
    fresh = false,
    savedOnly = false,
    fetchKey = getMachineKey,
    machine = 'explore-5',
  } = {},
) {
  if (authorized !== true) throw Error('Authorize the cutter connection first.');
  if (applicationVersion !== '10.8.81')
    throw Error(
      'Authenticated connections currently require the inspected Design Space 10.8.81 build.',
    );
  const saved = fresh ? null : await store.load(applicationVersion);
  if (!saved && savedOnly)
    throw Error(
      'Open Design Space, sign in and connect your cutter, then close it and connect in Skarix.',
    );
  return {
    key: saved || (await fetchKey(applicationVersion, { authorized, machine })),
    cached: !!saved,
  };
}
async function authenticateWithKey(device, record, store, applicationVersion) {
  try {
    try {
      await device.handshakeSkill.establishEncryption(record.key);
      if ((await device.handshakeSkill.isConnectionEncrypted()) !== true) throw Error();
    } catch {
      if (record.cached) {
        await store.clear();
        const error = Error('Could not authenticate with the saved cutter key.');
        error.code = 'RETRY_FRESH_KEY';
        throw error;
      }
      throw Error(
        'The cutter connected, but authentication failed. Power it off for 10 seconds, then reconnect with Design Space closed.',
      );
    }
    if (record.cached) return true;
    try {
      return (await store.save(applicationVersion, record.key)) === true;
    } catch {
      return false;
    }
  } finally {
    record.key = undefined;
  }
}
module.exports = { connectionKey, authenticateWithKey };
