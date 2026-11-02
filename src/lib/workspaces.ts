export const WORKSPACES = [
  {
    id: 'stickers',
    name: 'Design studio',
    category: 'Artwork & cutting',
    description: 'Create artwork, arrange a sheet, and print with matching cut paths.',
    icon: 'stickers',
    action: 'Open design studio',
  },
] as const;
// 'cards' is retained only to read preserved legacy project metadata.
export type WorkspaceId = 'cards' | 'stickers';
export function workspaceName(id: WorkspaceId) {
  return id === 'cards' ? 'Preserved CriProx project' : 'Design studio';
}
