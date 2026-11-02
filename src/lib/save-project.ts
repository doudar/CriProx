import type { Project } from './types';
import { download } from './export';
import { filenameStem } from './filenames';

type WritableFile = {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
};
type SaveFileHandle = { createWritable: () => Promise<WritableFile> };
type SaveFilePicker = (options: {
  suggestedName: string;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<SaveFileHandle>;

export function projectFilename(name: string) {
  return `${filenameStem(name, 'project')}.skarix.json`;
}

export async function saveProjectAs(project: Project): Promise<boolean> {
  const data = JSON.stringify(project, null, 2);
  const defaultName = projectFilename(project.name);
  if (window.skarix?.saveProject) return window.skarix.saveProject(defaultName, data);

  const picker = (window as typeof window & { showSaveFilePicker?: SaveFilePicker })
    .showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker.call(window, {
        suggestedName: defaultName,
        types: [
          {
            description: 'Skarix project',
            accept: { 'application/json': ['.skarix.json'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return false;
      throw error;
    }
  }

  download(new Blob([data], { type: 'application/json' }), defaultName);
  return true;
}
