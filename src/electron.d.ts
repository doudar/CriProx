export {};

declare global {
  const __APP_VERSION__: string;
  const __APP_CHANGELOG__: UpdateState['changelog'];

  type ReleaseUpdate = {
    currentVersion: string;
    latestVersion: string;
    releaseUrl: string;
    releaseNotes: string;
    releaseHeading: string;
    releaseNotesHtml: string;
    publishedAt: string | null;
    installerName: string | null;
    downloadSize: number | null;
    canDownload: boolean;
  };

  type UpdateState = {
    simulation?: string | null;
    currentVersion: string;
    status:
      | 'idle'
      | 'checking'
      | 'available'
      | 'up-to-date'
      | 'downloading'
      | 'verifying'
      | 'ready'
      | 'cancelled'
      | 'error';
    update: ReleaseUpdate | null;
    changelog: {
      version: string;
      publishedAt: string | null;
      releaseHeading: string;
      releaseNotesHtml: string;
      isNew: boolean;
      isInstalled: boolean;
    }[];
    lastChecked: string | null;
    transferred: number;
    total: number;
    error: string;
  };

  type ProjectSummary = {
    id: string;
    name: string;
    cardCount: number;
    artworkCount: number;
    updatedAt: string;
  };

  type ProjectLibrarySnapshot = {
    root: string;
    isDefault: boolean;
    canImportDocumentsLibrary: boolean;
    projects: ProjectSummary[];
    folders?: { id: string; name: string; parent: string; empty?: boolean }[];
  };

  interface Window {
    criprox?: {
      ai?: {
        status: () => Promise<{
          running: boolean;
          url: string;
          connectionFile: string;
          scope: string;
        }>;
        start: () => Promise<{
          running: boolean;
          url: string;
          connectionFile: string;
          scope: string;
        }>;
        stop: () => Promise<{
          running: boolean;
          url: string;
          connectionFile: string;
          scope: string;
        }>;
        copyConfig: () => Promise<boolean>;
        onCancel: (callback: () => void) => () => void;
        onRequest: (
          callback: (request: {
            id: string;
            name: string;
            args: unknown;
          }) => Promise<{ value?: unknown; error?: string }>,
        ) => () => void;
      };
      platform?: 'darwin' | 'win32' | 'linux';
      printing?: import('./lib/direct-print').PrintApi;
      materials?: {
        import: () => Promise<{
          profiles: import('./lib/cut-settings').MaterialProfile[];
          warnings: string[];
          files: number;
        }>;
      };
      cutter?: {
        state: () => Promise<import('./lib/cutter').CutterState>;
        keyStatus: (machine?: string) => Promise<{ available: boolean }>;
        connectSaved: (
          transport: 'usb' | 'ble',
          machine?: string,
        ) => Promise<import('./lib/cutter').CutterState>;
        connect: (
          transport: 'usb' | 'ble',
          authorized: boolean,
          machine?: string,
        ) => Promise<import('./lib/cutter').CutterState>;
        disconnect: () => Promise<import('./lib/cutter').CutterState>;
        forgetKey: (machine?: string) => Promise<import('./lib/cutter').CutterState>;
        home: (bladeRemoved: boolean) => Promise<import('./lib/cutter').CutterState>;
        cutSheet: (
          job: string,
          sheetIndex: number,
          materialReady: boolean,
        ) => Promise<import('./lib/cutter').CutterState>;
        cancel: () => Promise<import('./lib/cutter').CutterState>;
        pause: () => Promise<import('./lib/cutter').CutterState>;
        resume: () => Promise<import('./lib/cutter').CutterState>;
        onState: (callback: (state: import('./lib/cutter').CutterState) => void) => () => void;
      };
      saveProject?: (defaultName: string, data: string) => Promise<boolean>;
      cricut?: {
        inspect: () => Promise<{
          installed: boolean;
          version: string | null;
          bridgeInstalled: boolean;
        }>;
        open: () => Promise<void>;
      };
      upscayl?: {
        detect: () => Promise<{ cacheKey: string } | null>;
        run: (id: string, input: Uint8Array) => Promise<Uint8Array>;
        cancel: (id: string) => Promise<void>;
      };
      projects?: {
        list: () => Promise<ProjectLibrarySnapshot>;
        chooseDirectory: () => Promise<ProjectLibrarySnapshot | null>;
        importDocuments: () => Promise<{
          imported: number;
          snapshot: ProjectLibrarySnapshot;
        }>;
        beginSave: (
          projectId: string | null,
          name: string,
          folder?: string,
        ) => Promise<{ saveId: string; projectId: string }>;
        writeAsset: (saveId: string, dataUrl: string) => Promise<string>;
        finishSave: (
          saveId: string,
          data: string,
        ) => Promise<{ project: ProjectSummary; snapshot: ProjectLibrarySnapshot }>;
        abortSave: (saveId: string) => Promise<void>;
        open: (projectId: string) => Promise<string>;
        readAsset: (projectId: string, relativePath: string) => Promise<string>;
        delete: (projectId: string) => Promise<ProjectLibrarySnapshot>;
        createFolder: (
          parent: string,
          name: string,
        ) => Promise<{ folder: string; snapshot: ProjectLibrarySnapshot }>;
        deleteFolder: (folder: string) => Promise<ProjectLibrarySnapshot>;
        move: (
          projectId: string,
          folder: string,
        ) => Promise<{ project: ProjectSummary; snapshot: ProjectLibrarySnapshot }>;
        reveal: () => Promise<void>;
      };
      registrationTemplates?: {
        load: (
          templateId: string,
          slotCount: number,
          templateName?: string,
        ) => Promise<{ name: string; capturedAt: string; pdf: ArrayBuffer } | null>;
        save: (
          templateId: string,
          slotCount: number,
          pdf: ArrayBuffer,
          templateName?: string,
        ) => Promise<{ name: string; capturedAt: string }>;
      };
      releases?: {
        check: () => Promise<UpdateState>;
        state: () => Promise<UpdateState>;
        checkNow: () => Promise<UpdateState>;
        download: () => Promise<UpdateState>;
        cancel: () => Promise<UpdateState>;
        openInstaller: () => Promise<UpdateState>;
        copyMacCommand: () => Promise<void>;
        openTerminal: () => Promise<void>;
        onState: (callback: (state: UpdateState) => void) => () => void;
        open: (releaseUrl: string) => Promise<void>;
        openLink: (url: string) => Promise<void>;
      };
      windowControls?: {
        minimize: () => Promise<boolean>;
        toggleMaximize: () => Promise<boolean>;
        close: () => Promise<boolean>;
        isMaximized: () => Promise<boolean>;
        onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
      };
    };
  }
}
