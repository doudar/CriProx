const { build } = require('../package.json');
const { identity, ...mac } = build.mac;

// Load as a separate config file: merging an override into package.json would
// retain its identity:null and silently keep signing disabled.
module.exports = {
  ...build,
  extends: null,
  forceCodeSigning: true,
  mac: {
    ...mac,
    hardenedRuntime: true,
    notarize: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
  },
  dmg: { sign: true },
};
