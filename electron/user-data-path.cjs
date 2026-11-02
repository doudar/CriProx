const path = require('node:path');
const fs = require('node:fs');

function compatibleUserData(appData, exists = fs.existsSync) {
  for (const name of ['Skarix', 'CriProx', 'criprox']) {
    const candidate = path.join(appData, name);
    if (exists(candidate)) return candidate;
  }
  return path.join(appData, 'Skarix');
}
module.exports = { compatibleUserData };
