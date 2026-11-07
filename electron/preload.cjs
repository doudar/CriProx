const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'skarix',
  Object.freeze({
    platform: process.platform,
    ai: Object.freeze({
      status: () => ipcRenderer.invoke('ai-design-status'),
      start: () => ipcRenderer.invoke('ai-design-start'),
      stop: () => ipcRenderer.invoke('ai-design-stop'),
      copyConfig: () => ipcRenderer.invoke('ai-design-copy-config'),
      onCancel: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('ai-design-cancel', listener);
        return () => ipcRenderer.removeListener('ai-design-cancel', listener);
      },
      onRequest: (callback) => {
        const listener = async (_event, request) => {
          let result;
          try {
            result = await callback(request);
          } catch {
            result = { error: 'The design request failed.' };
          }
          await ipcRenderer.invoke('ai-design-response', { id: request.id, ...result });
        };
        ipcRenderer.on('ai-design-request', listener);
        void ipcRenderer.invoke('ai-design-ready').catch((error) => console.error(error));
        return () => ipcRenderer.removeListener('ai-design-request', listener);
      },
    }),
    materials: Object.freeze({ import: () => ipcRenderer.invoke('materials-import') }),
    printing: Object.freeze({
      begin: (settings) => ipcRenderer.invoke('print-begin', settings),
      page: (id, index, png) => ipcRenderer.invoke('print-page', id, index, png),
      finish: (id) => ipcRenderer.invoke('print-finish', id),
      abort: (id) => ipcRenderer.invoke('print-abort', id),
    }),
    cutter: Object.freeze({
      state: () => ipcRenderer.invoke('cutter-state'),
      keyStatus: (machine) => ipcRenderer.invoke('cutter-key-status', machine),
      connectSaved: (transport, machine) =>
        ipcRenderer.invoke('cutter-connect-saved', { transport, machine }),
      connect: (transport, authorized, machine) =>
        ipcRenderer.invoke('cutter-connect', { transport, authorized, machine }),
      disconnect: () => ipcRenderer.invoke('cutter-disconnect'),
      forgetKey: (machine) => ipcRenderer.invoke('cutter-forget-key', machine),
      home: (bladeRemoved) => ipcRenderer.invoke('cutter-home', { bladeRemoved }),
      cutSheet: (job, sheetIndex, materialReady) =>
        ipcRenderer.invoke('cutter-cut-sheet', { job, sheetIndex, materialReady }),
      cancel: () => ipcRenderer.invoke('cutter-cancel'),
      pause: () => ipcRenderer.invoke('cutter-pause'),
      resume: () => ipcRenderer.invoke('cutter-resume'),
      onState: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('cutter-state', listener);
        return () => ipcRenderer.removeListener('cutter-state', listener);
      },
    }),
    cricut: Object.freeze({
      inspect: () => ipcRenderer.invoke('cricut-installation'),
      open: () => ipcRenderer.invoke('cricut-open'),
    }),
    saveProject: (defaultName, data) => ipcRenderer.invoke('save-project', { defaultName, data }),
    upscayl: Object.freeze({
      detect: () => ipcRenderer.invoke('upscayl-detect'),
      run: (id, input) => ipcRenderer.invoke('upscayl-run', { id, input }),
      cancel: (id) => ipcRenderer.invoke('upscayl-cancel', id),
    }),
    projects: Object.freeze({
      list: () => ipcRenderer.invoke('list-projects'),
      chooseDirectory: () => ipcRenderer.invoke('choose-projects-directory'),
      importDocuments: () => ipcRenderer.invoke('import-documents-projects'),
      beginSave: (projectId, name, folder) =>
        ipcRenderer.invoke('begin-managed-project-save', { projectId, name, folder }),
      writeAsset: (saveId, dataUrl) =>
        ipcRenderer.invoke('write-managed-project-asset', { saveId, dataUrl }),
      finishSave: (saveId, data) =>
        ipcRenderer.invoke('finish-managed-project-save', { saveId, data }),
      abortSave: (saveId) => ipcRenderer.invoke('abort-managed-project-save', saveId),
      open: (projectId) => ipcRenderer.invoke('open-managed-project', projectId),
      readAsset: (projectId, relativePath) =>
        ipcRenderer.invoke('read-managed-project-asset', { projectId, relativePath }),
      delete: (projectId) => ipcRenderer.invoke('delete-managed-project', projectId),
      createFolder: (parent, name) => ipcRenderer.invoke('create-project-folder', { parent, name }),
      deleteFolder: (folder) => ipcRenderer.invoke('delete-project-folder', folder),
      move: (projectId, folder) =>
        ipcRenderer.invoke('move-managed-project', { projectId, folder }),
      reveal: () => ipcRenderer.invoke('reveal-project-library'),
    }),
    registrationTemplates: Object.freeze({
      load: (templateId, slotCount, templateName) =>
        ipcRenderer.invoke('load-registration-template', { templateId, slotCount, templateName }),
      save: (templateId, slotCount, pdf, templateName) =>
        ipcRenderer.invoke('save-registration-template', {
          templateId,
          slotCount,
          pdf,
          templateName,
        }),
    }),
    releases: Object.freeze({
      check: () => ipcRenderer.invoke('release-check'),
      open: (releaseUrl) => ipcRenderer.invoke('open-release-page', releaseUrl),
      openLink: (url) => ipcRenderer.invoke('open-release-notes-link', url),
      state: () => ipcRenderer.invoke('update-state'),
      checkNow: () => ipcRenderer.invoke('update-check'),
      download: () => ipcRenderer.invoke('update-download'),
      cancel: () => ipcRenderer.invoke('update-cancel'),
      openInstaller: () => ipcRenderer.invoke('update-open'),
      copyMacCommand: () => ipcRenderer.invoke('update-copy-mac-command'),
      openTerminal: () => ipcRenderer.invoke('update-open-terminal'),
      onState: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('update-state', listener);
        return () => ipcRenderer.removeListener('update-state', listener);
      },
    }),
    windowControls: Object.freeze({
      minimize: () => ipcRenderer.invoke('window-control', 'minimize'),
      toggleMaximize: () => ipcRenderer.invoke('window-control', 'maximize'),
      close: () => ipcRenderer.invoke('window-control', 'close'),
      isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
      onMaximizedChange: (callback) => {
        const listener = (_event, maximized) => callback(Boolean(maximized));
        ipcRenderer.on('window-maximized-change', listener);
        return () => ipcRenderer.removeListener('window-maximized-change', listener);
      },
    }),
  }),
);
