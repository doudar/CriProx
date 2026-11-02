export type ProjectSort = 'updated' | 'name' | 'cards';
export const PROJECT_DRAG_TYPE = 'application/x-skarix-project';

export function projectFolder(projectId: string): string {
  return projectId.split('/').slice(0, -1).join('/');
}

export function canMoveProjectToFolder(
  library: Pick<ProjectLibrarySnapshot, 'projects' | 'folders'> | null,
  projectId: string | null,
  folder: string,
): boolean {
  return Boolean(
    library &&
    projectId &&
    library.projects.some((item) => item.id === projectId) &&
    (folder === '' || library.folders?.some((item) => item.id === folder)) &&
    projectFolder(projectId) !== folder,
  );
}

export function explorerProjects(
  projects: ProjectSummary[],
  folder: string,
  query: string,
  allProjects: boolean,
  sort: ProjectSort,
): ProjectSummary[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return projects
    .filter((project) => {
      const haystack = `${project.name} ${projectFolder(project.id)}`.toLocaleLowerCase();
      return (
        (words.length || allProjects || projectFolder(project.id) === folder) &&
        words.every((word) => haystack.includes(word))
      );
    })
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      const primary =
        sort === 'name'
          ? byName
          : sort === 'cards'
            ? b.cardCount - a.cardCount
            : b.updatedAt.localeCompare(a.updatedAt);
      return primary || byName || a.id.localeCompare(b.id);
    });
}
