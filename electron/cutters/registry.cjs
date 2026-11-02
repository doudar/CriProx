const cricut = require('./providers/cricut.cjs');
// Explicit allowlist. A future Silhouette provider can use its own worker, protocol,
// registration validation and platforms without loading any Cricut runtime code.
const providers = new Map([[cricut.id, cricut]]);
function getProvider(machine) {
  const provider = providers.get(machine.provider);
  if (!provider) throw Error('No direct cutter provider is installed for this machine.');
  return provider;
}
module.exports = { getProvider };
