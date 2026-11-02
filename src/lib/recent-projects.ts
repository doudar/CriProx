import { get, set, del } from 'idb-keyval';
import type { Project } from './types';
import type { StickerProject } from './stickers';
import type { WorkspaceId } from './workspaces';

export type RecentProject = {
  id: string;
  workspace: WorkspaceId;
  name: string;
  count: number;
  updatedAt: string;
  bytes: number;
  preview?: string;
  identity?: string;
};
const INDEX = 'criprox-recent-projects-v1',
  key = (id: string) => `criprox-recent-project:${id}`;
let queue = Promise.resolve();
export function projectSummary(project: Project | StickerProject, workspace: WorkspaceId) {
  const stickers = 'kind' in project && project.kind === 'criprox-stickers';
  const count = stickers
    ? project.items.length
    : (project as Project).entries.reduce((sum, e) => sum + e.quantity, 0);
  const preview = stickers
    ? project.artwork[0]?.image
    : (project as Project).entries[0]?.card.faces[(project as Project).entries[0].face]?.preview;
  return { workspace, name: project.name, count, preview };
}
export async function listRecentProjects(): Promise<RecentProject[]> {
  const items = await get<RecentProject[]>(INDEX);
  return Array.isArray(items)
    ? items
        .filter(
          (p) =>
            p &&
            typeof p.id === 'string' &&
            typeof p.name === 'string' &&
            typeof p.updatedAt === 'string' &&
            Number.isFinite(Date.parse(p.updatedAt)) &&
            Number.isFinite(p.count) &&
            Number.isFinite(p.bytes) &&
            p.bytes >= 0 &&
            (p.workspace === 'cards' || p.workspace === 'stickers'),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : [];
}
export function pruneRecentProjects(items: RecentProject[]): RecentProject[] {
  const seen = new Set<string>();
  let total = 0;
  return items.filter((p) => {
    const identity = p.identity ?? p.id;
    if (seen.has(identity)) return false;
    seen.add(identity);
    if (seen.size > 8 || (total + p.bytes > 90_000_000 && total > 0)) return false;
    total += p.bytes;
    return true;
  });
}
export async function readRecentProject(id: string): Promise<Project | StickerProject> {
  const value = await get<Project | StickerProject>(key(id));
  if (!value) throw Error('This recent project is no longer cached. Open its saved project file.');
  return value;
}
/** Explicit snapshots preserve projects when switching files or starting fresh. Drafts keep autosaving separately. */
export function rememberRecentProject(
  project: Project | StickerProject,
  workspace: WorkspaceId,
  id: string = crypto.randomUUID(),
): Promise<RecentProject[]> {
  const snapshot = structuredClone(project);
  const task = queue
    .catch(() => {})
    .then(async () => {
      const summary = projectSummary(snapshot, workspace),
        bytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
      const entry: RecentProject = {
        id,
        ...summary,
        preview: summary.preview && summary.preview.length < 150_000 ? summary.preview : undefined,
        bytes,
        updatedAt: new Date().toISOString(),
        identity: `${workspace}:${snapshot.name}:${'kind' in snapshot ? snapshot.artwork.map((a) => a.id).join(',') : snapshot.entries.map((e) => e.id).join(',')}`,
      };
      const previous = await listRecentProjects(),
        ordered = [entry, ...previous.filter((p) => p.id !== id)];
      const keep = [
        ...pruneRecentProjects(ordered.filter((p) => p.workspace !== 'cards')),
        ...ordered.filter((p) => p.workspace === 'cards'),
      ];
      await set(key(id), snapshot);
      await set(INDEX, keep);
      await Promise.all(
        previous.filter((p) => !keep.some((k) => k.id === p.id)).map((p) => del(key(p.id))),
      );
      return keep;
    });
  queue = task.then(
    () => {},
    () => {},
  );
  return task;
}
