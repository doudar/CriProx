const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Clean up after Electron and Chromium exit, rather than during app.quit(),
// when Chromium may still write session files back into the profile.
function launchUpdateDemo({
  appPath = '.',
  args = process.argv.slice(2),
  electronPath = require('electron'),
} = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'skarix-update-demo-'));
  const child = spawn(electronPath, [appPath, '--simulate-updates', ...args], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, SKARIX_UPDATE_DEMO_PROFILE: profile },
    stdio: 'inherit',
  });
  const cleanup = () =>
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  child.once('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once('close', (code, signal) => {
    try {
      cleanup();
    } catch (error) {
      console.error(`Remove the temporary demo profile at ${profile}: ${error.message}`);
    }
    process.exitCode = code ?? (signal ? 1 : 0);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  return { child, profile };
}

if (require.main === module) launchUpdateDemo();
module.exports = { launchUpdateDemo };
