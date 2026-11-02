import { readLocalSetting } from './storage';
import { BUILTIN_MATERIALS, validateMaterial, type MaterialProfile } from './cut-settings';
export type MaterialLibrary = {
  version: 1;
  imported: boolean;
  originals: MaterialProfile[];
  edits: MaterialProfile[];
};
export const MATERIAL_LIBRARY_KEY = 'skarix-material-library-v1';
export const emptyMaterialLibrary = (): MaterialLibrary => ({
  version: 1,
  imported: false,
  originals: BUILTIN_MATERIALS,
  edits: [],
});
export function validateLibrary(value: unknown): MaterialLibrary {
  const v = value as MaterialLibrary;
  if (
    !v ||
    v.version !== 1 ||
    typeof v.imported !== 'boolean' ||
    !Array.isArray(v.originals) ||
    !Array.isArray(v.edits) ||
    v.originals.length + v.edits.length > 20000
  )
    throw Error('The saved material library could not be read. Your saved data has been kept.');
  return {
    version: 1,
    imported: v.imported,
    originals: v.originals.map(validateMaterial),
    edits: v.edits.map(validateMaterial),
  };
}
export function libraryMaterials(library: MaterialLibrary) {
  const profiles = new Map(library.originals.map((p) => [p.id, p]));
  for (const p of library.edits) profiles.set(p.id, p);
  return [...profiles.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.bladeName.localeCompare(b.bladeName),
  );
}
export function mergeImportedMaterials(
  library: MaterialLibrary,
  incoming: MaterialProfile[],
): MaterialLibrary {
  const originals = new Map(library.originals.map((p) => [p.id, p]));
  for (const profile of incoming) {
    const p = validateMaterial(profile);
    originals.set(p.id, p);
  }
  return { ...library, imported: true, originals: [...originals.values()] };
}
export function editLibraryMaterial(
  library: MaterialLibrary,
  profile: MaterialProfile,
): MaterialLibrary {
  const p = validateMaterial(profile);
  return { ...library, edits: [...library.edits.filter((v) => v.id !== p.id), p] };
}
export function resetLibraryMaterial(library: MaterialLibrary, id: string): MaterialLibrary {
  return { ...library, edits: library.edits.filter((p) => p.id !== id) };
}
export function readMaterialLibrary(): MaterialLibrary {
  const saved = readLocalSetting(MATERIAL_LIBRARY_KEY);
  return saved ? validateLibrary(JSON.parse(saved)) : emptyMaterialLibrary();
}
export function saveMaterialLibrary(library: MaterialLibrary) {
  localStorage.setItem(MATERIAL_LIBRARY_KEY, JSON.stringify(validateLibrary(library)));
  window.dispatchEvent(new Event('skarix-materials-changed'));
}
let importing: Promise<{ library: MaterialLibrary; message: string }> | undefined;
export function importMaterialLibrary() {
  if (!importing)
    importing = (async () => {
      if (!window.skarix?.materials)
        throw Error(
          'Import from Design Space is available in the desktop app. You can create custom materials here.',
        );
      const result = await window.skarix.materials.import();
      const library = mergeImportedMaterials(readMaterialLibrary(), result.profiles);
      saveMaterialLibrary(library);
      return {
        library,
        message: `Imported ${result.profiles.length} material/blade profiles from ${result.files} local cache(s). ${result.warnings.join(' ')}`,
      };
    })().finally(() => {
      importing = undefined;
    });
  return importing;
}
