const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const MAC_UNBLOCK_COMMAND = 'xattr -dr com.apple.quarantine "/Applications/Skarix.app"';

function launchAppImage(file) {
  return new Promise((resolve, reject) => {
    // The new AppImage establishes its own runtime paths.
    const env = { ...process.env };
    for (const key of ['APPIMAGE', 'APPDIR', 'ARGV0', 'ELECTRON_RUN_AS_NODE']) delete env[key];
    const child = spawn(file, [], { detached: true, stdio: 'ignore', env });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function createInstallerHandoff({
  platform,
  downloads,
  openPath,
  chooseDestination,
  launch = launchAppImage,
}) {
  return async (file) => {
    if (platform !== 'linux') return openPath(file);
    const result = await chooseDestination({
      title: 'Save and launch updated Skarix AppImage',
      defaultPath: path.join(downloads, path.basename(file)),
      filters: [{ name: 'AppImage', extensions: ['AppImage'] }],
    });
    // null distinguishes a cancelled handoff from a successful shell.openPath ("").
    if (result.canceled || !result.filePath) return null;
    const destination = path.resolve(result.filePath);
    const cacheRoot = await fs.realpath(path.dirname(file));
    const parent = await fs.realpath(path.dirname(destination));
    if (parent === cacheRoot || parent.startsWith(`${cacheRoot}${path.sep}`))
      throw new Error('Choose a permanent location outside the update cache.');
    const staged = path.join(parent, `.criprox-update-${crypto.randomUUID()}.AppImage`);
    try {
      await fs.copyFile(file, staged, fs.constants.COPYFILE_EXCL);
      await fs.chmod(staged, 0o700);
      // Replace atomically, including when the chosen destination is the running AppImage.
      await fs.rename(staged, destination);
    } finally {
      await fs.rm(staged, { force: true });
    }
    await launch(destination);
    return '';
  };
}

function createMacUpdateHelp({ platform, clipboard, openPath }) {
  function requireMac() {
    if (platform !== 'darwin') throw new Error('This update action is only available on macOS.');
  }
  return {
    copyCommand() {
      requireMac();
      clipboard.writeText(MAC_UNBLOCK_COMMAND);
    },
    async openTerminal() {
      requireMac();
      // Open Apple's Terminal without pasting or executing the unblock command.
      const error = await openPath('/System/Applications/Utilities/Terminal.app');
      if (error) throw new Error(error);
    },
  };
}

module.exports = { createInstallerHandoff, createMacUpdateHelp, MAC_UNBLOCK_COMMAND };
