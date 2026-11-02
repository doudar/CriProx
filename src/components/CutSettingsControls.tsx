import { useEffect, useId, useRef, useState } from 'react';
import { Search, SlidersHorizontal, X, Plus, Copy } from 'lucide-react';
import {
  CUT_PRESSURES,
  CUT_PRESSURE_LABELS,
  MAX_CUT_PASSES,
  materialForSettings,
  passPressures,
  selectMaterial,
  directCutIssue,
  validateMaterial,
  type CutSettings,
  type MaterialProfile,
} from '../lib/cut-settings';
import {
  emptyMaterialLibrary,
  readMaterialLibrary,
  saveMaterialLibrary,
  libraryMaterials,
  editLibraryMaterial,
  resetLibraryMaterial,
  importMaterialLibrary,
  type MaterialLibrary,
} from '../lib/material-library';
import './MaterialManager.css';

export default function CutSettingsControls({
  value,
  onChange,
}: {
  value: CutSettings;
  onChange: (patch: Partial<CutSettings>) => void;
}) {
  const id = useId();
  const [library, setLibrary] = useState<MaterialLibrary>(emptyMaterialLibrary);
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false),
    [search, setSearch] = useState('');
  const selected = materialForSettings(value);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      try {
        const next = readMaterialLibrary();
        if (active) setLibrary(next);
      } catch (e) {
        if (active) setError(String(e));
      }
    };
    window.addEventListener('criprox-materials-changed', refresh);
    window.addEventListener('storage', refresh);
    try {
      const next = readMaterialLibrary();
      setLibrary(next);
      if (!next.imported && window.criprox?.materials) {
        setBusy(true);
        void importMaterialLibrary()
          .then((result) => {
            if (active) {
              setLibrary(result.library);
              setMessage(result.message);
            }
          })
          .catch((e) => {
            if (active) setError(String(e));
          })
          .finally(() => {
            if (active) setBusy(false);
          });
      }
    } catch (e) {
      setError(String(e));
    }
    return () => {
      active = false;
      window.removeEventListener('criprox-materials-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  const profiles = libraryMaterials(library);
  if (!profiles.some((p) => p.id === selected.id)) profiles.push(selected);
  const options = profiles.filter(
    (p) =>
      p.id === selected.id ||
      `${p.name} ${p.category} ${p.machineName} ${p.bladeName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const issue = directCutIssue(value);
  async function importAll() {
    setBusy(true);
    setError('');
    try {
      const result = await importMaterialLibrary();
      setLibrary(result.library);
      setMessage(result.message);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cut-settings-controls">
      <div className="material-heading">
        <strong>Material & cut settings</strong>
        <button type="button" onClick={() => setManage(true)}>
          <SlidersHorizontal size={15} /> Manage materials
        </button>
      </div>
      <div className="setting-group cut-material-setting">
        <label htmlFor={`${id}-search`}>Find a material</label>
        <div className="material-search">
          <Search size={15} />
          <input
            id={`${id}-search`}
            type="search"
            placeholder="Search paper, vinyl, cardstock…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label htmlFor={`${id}-material`}>Cut material</label>
        <select
          id={`${id}-material`}
          value={value.cutMaterial}
          onChange={(e) => {
            const profile = profiles.find((p) => p.id === e.target.value);
            if (profile) onChange(selectMaterial(profile));
          }}
        >
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.bladeName}
              {p.machineId !== 24 ? ` · ${p.machineName}` : ''}
              {p.source === 'custom' ? ' · Custom' : p.source === 'builtin' ? ' · Built-in' : ''}
            </option>
          ))}
        </select>
        <span className="field-note">
          {selected.machineName} · {selected.bladeName}. Selecting a material fills in its pressure
          and passes.
        </span>
      </div>
      <div className="setting-group">
        <label htmlFor={`${id}-pressure`}>Pressure adjustment</label>
        <select
          id={`${id}-pressure`}
          value={value.cutPressure}
          onChange={(e) => onChange({ cutPressure: e.target.value as CutSettings['cutPressure'] })}
        >
          {CUT_PRESSURES.map((p) => (
            <option key={p} value={p}>
              {CUT_PRESSURE_LABELS[p]}
              {p === 'medium' ? ' (material default)' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="setting-group">
        <label htmlFor={`${id}-grams`}>Cut pressure (g)</label>
        <input
          id={`${id}-grams`}
          type="number"
          min={1}
          max={4500}
          step={1}
          value={passPressures(value)[0]}
          onChange={(e) => {
            const pressure = Number(e.target.value);
            if (Number.isInteger(pressure) && pressure >= 1 && pressure <= 4500)
              onChange({
                cutPressure: 'medium',
                cutProfile: {
                  ...selected,
                  pressure,
                  pressures: Array(selected.passes).fill(pressure),
                },
              });
          }}
        />
      </div>
      <div className="setting-group">
        <label htmlFor={`${id}-passes`}>Number of passes</label>
        <select
          id={`${id}-passes`}
          value={value.cutPasses}
          onChange={(e) => onChange({ cutPasses: Number(e.target.value) })}
        >
          {Array.from({ length: MAX_CUT_PASSES }, (_, i) => i + 1).map((p) => (
            <option key={p} value={p}>
              {p} {p === 1 ? 'pass' : 'passes'}
            </option>
          ))}
        </select>
      </div>
      <p className="field-note material-pressure">
        <strong>{passPressures(value).join(' / ')} g</strong> · pressure for each pass. Editing Cut
        pressure sets every pass to that value. Extra passes repeat the final pressure. Saved with
        this project and cut job.
      </p>
      {issue && (
        <p className="field-note" role="status">
          {issue}
        </p>
      )}
      {busy && (
        <p className="field-note" role="status">
          Importing Design Space materials…
        </p>
      )}
      {error && (
        <p className="field-note" role="alert">
          {error}
        </p>
      )}
      {manage && (
        <MaterialManager
          profiles={profiles}
          library={library}
          selected={selected}
          busy={busy}
          message={message}
          error={error}
          onImport={() => void importAll()}
          onClose={() => setManage(false)}
          onSave={(profile) => {
            saveMaterialLibrary(editLibraryMaterial(readMaterialLibrary(), profile));
            onChange(selectMaterial(profile));
          }}
          onReset={(profile) => {
            const next = resetLibraryMaterial(readMaterialLibrary(), profile.id);
            saveMaterialLibrary(next);
            return libraryMaterials(next).find((p) => p.id === profile.id);
          }}
          onUse={(profile) => {
            onChange(selectMaterial(profile));
            setManage(false);
          }}
        />
      )}
    </div>
  );
}

function MaterialManager({
  profiles,
  library,
  selected,
  busy,
  message,
  error,
  onImport,
  onClose,
  onSave,
  onReset,
  onUse,
}: {
  profiles: MaterialProfile[];
  library: MaterialLibrary;
  selected: MaterialProfile;
  busy: boolean;
  message: string;
  error: string;
  onImport: () => void;
  onClose: () => void;
  onSave: (p: MaterialProfile) => void;
  onReset: (p: MaterialProfile) => MaterialProfile | undefined;
  onUse: (p: MaterialProfile) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    id = useId();
  const [query, setQuery] = useState(''),
    [customOnly, setCustomOnly] = useState(false);
  const [draft, setDraft] = useState(selected),
    [sequence, setSequence] = useState(selected.pressures.join(', '));
  const [notice, setNotice] = useState(''),
    [editError, setEditError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const choose = (p: MaterialProfile) => {
    setDraft(structuredClone(p));
    setSequence(p.pressures.join(', '));
    setNotice('');
    setEditError('');
  };
  const matches = profiles.filter(
    (p) =>
      (!customOnly || p.source === 'custom' || library.edits.some((e) => e.id === p.id)) &&
      `${p.name} ${p.category} ${p.bladeName} ${p.machineName}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const original = library.originals.find((p) => p.id === draft.id);
  function validated() {
    return validateMaterial({
      ...draft,
      pressures: sequence.split(',').map((s) => (s.trim() ? Number(s) : NaN)),
    });
  }
  const run = (action: () => void) => {
    setEditError('');
    try {
      action();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <dialog
      className="material-manager"
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <header className="material-manager-header">
        <div>
          <p className="eyebrow">Shared by cards and stickers</p>
          <h2 id={`${id}-title`}>Material manager</h2>
        </div>
        <button type="button" aria-label="Close material manager" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="material-manager-toolbar">
        <button type="button" disabled={busy || !window.criprox?.materials} onClick={onImport}>
          {busy ? 'Importing…' : 'Refresh from Design Space'}
        </button>
        <button
          type="button"
          onClick={() =>
            choose({
              ...selected,
              id: `custom:${crypto.randomUUID()}`,
              name: 'New material',
              category: 'Custom',
              source: 'custom',
              machineId: 24,
              machineName: 'Cricut Explore 5',
              blade: 'dragKnife',
              bladeName: 'Fine-Point Blade',
              pressure: 80,
              passes: 1,
              pressures: [80],
              adjustment: [-4, 0, 4],
              motion: [10, 100, 12, 200],
            })
          }
        >
          <Plus size={15} /> New material
        </button>
        <span>{profiles.length} profiles</span>
      </div>
      <p className="material-manager-help">
        Import every cached cutting material from Design Space. Edits stay in Skarix; refresh keeps
        your changes. Other machines and blades are labeled.
      </p>
      <div className="material-manager-body">
        <aside className="material-browser">
          <label htmlFor={`${id}-filter`}>Search materials</label>
          <input
            autoFocus
            id={`${id}-filter`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, category, or blade"
          />
          <label className="material-custom-filter">
            <input
              type="checkbox"
              checked={customOnly}
              onChange={(e) => setCustomOnly(e.target.checked)}
            />{' '}
            My customizations
          </label>
          <div className="material-list" aria-label="Material profiles">
            {matches.map((p) => (
              <button
                type="button"
                key={p.id}
                className={draft.id === p.id ? 'selected' : ''}
                aria-pressed={draft.id === p.id}
                onClick={() => choose(p)}
              >
                <strong>{p.name}</strong>
                <span>
                  {p.category || 'Custom'} · {p.bladeName}
                </span>
                <small>
                  {p.machineName} · {p.pressures.join(' / ')} g · {p.passes}{' '}
                  {p.passes === 1 ? 'pass' : 'passes'}
                </small>
              </button>
            ))}
            {!matches.length && <p>No matching materials.</p>}
          </div>
        </aside>
        <section className="material-editor" aria-label="Edit material">
          <div className="material-editor-heading">
            <h3>Edit material</h3>
            <button
              type="button"
              onClick={() =>
                run(() =>
                  choose({
                    ...validated(),
                    id: `custom:${crypto.randomUUID()}`,
                    name: `${draft.name.slice(0, 170)} copy`,
                    source: 'custom',
                  }),
                )
              }
            >
              <Copy size={14} /> Duplicate
            </button>
          </div>
          <label htmlFor={`${id}-name`}>Material name</label>
          <input
            id={`${id}-name`}
            maxLength={180}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <label htmlFor={`${id}-category`}>Category</label>
          <input
            id={`${id}-category`}
            maxLength={100}
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          />
          <p className="field-note">
            {draft.machineName} · {draft.bladeName} ·{' '}
            {draft.source === 'design-space'
              ? 'Imported from Design Space'
              : draft.source === 'builtin'
                ? 'Built-in material'
                : 'Custom material'}
          </p>
          <div className="material-editor-numbers">
            <div>
              <label htmlFor={`${id}-grams`}>Cut pressure (g)</label>
              <input
                id={`${id}-grams`}
                type="number"
                min={1}
                max={4500}
                step={1}
                value={Number.isNaN(draft.pressure) ? '' : draft.pressure}
                onChange={(e) => {
                  const pressure = e.target.value ? Number(e.target.value) : NaN;
                  setDraft({ ...draft, pressure });
                  setSequence(Array(draft.passes).fill(pressure).join(', '));
                }}
              />
            </div>
            <div>
              <label htmlFor={`${id}-count`}>Number of passes</label>
              <select
                id={`${id}-count`}
                value={draft.passes}
                onChange={(e) => {
                  const passes = Number(e.target.value),
                    values = sequence.split(',').map(Number);
                  setDraft({ ...draft, passes });
                  setSequence(
                    Array.from(
                      { length: passes },
                      (_, i) => values[Math.min(i, values.length - 1)],
                    ).join(', '),
                  );
                }}
              >
                {Array.from({ length: MAX_CUT_PASSES }, (_, i) => i + 1).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label htmlFor={`${id}-sequence`}>Pressure for each pass (g)</label>
          <input
            id={`${id}-sequence`}
            value={sequence}
            onChange={(e) => setSequence(e.target.value)}
          />
          <p className="field-note">
            One comma-separated pressure per pass. Changing Cut pressure replaces the whole
            sequence. Imported sequences retain their original values.
          </p>
          <div className="material-editor-numbers">
            {[0, 2].map((index) => (
              <div key={index}>
                <label htmlFor={`${id}-delta-${index}`}>
                  {index === 0 ? 'Light' : 'Hard'} adjustment (g)
                </label>
                <input
                  id={`${id}-delta-${index}`}
                  type="number"
                  min={-500}
                  max={500}
                  step={1}
                  value={Number.isNaN(draft.adjustment[index]) ? '' : draft.adjustment[index]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      adjustment: draft.adjustment.map((v, i) =>
                        i === index ? (e.target.value ? Number(e.target.value) : NaN) : v,
                      ),
                    })
                  }
                />
              </div>
            ))}
          </div>
          {editError && <p role="alert">{editError}</p>}
          {notice && <p role="status">{notice}</p>}
          <div className="material-editor-actions">
            <button
              type="button"
              className="primary"
              onClick={() =>
                run(() => {
                  const p = validated();
                  onSave(p);
                  setNotice('Saved and applied to this project.');
                })
              }
            >
              Save and use
            </button>
            <button type="button" onClick={() => run(() => onUse(validated()))}>
              Use without saving
            </button>
            <button
              type="button"
              disabled={!library.edits.some((p) => p.id === draft.id)}
              onClick={() =>
                run(() => {
                  const restored = onReset(draft);
                  choose(restored || original || selected);
                  setNotice(
                    original
                      ? 'Original settings restored in the library. Use them to update this project.'
                      : 'Custom material deleted. Existing projects keep their saved settings.',
                  );
                })
              }
            >
              {original ? 'Restore original' : 'Delete custom'}
            </button>
          </div>
        </section>
      </div>
      <footer className="material-manager-footer">
        <p role={error ? 'alert' : 'status'}>
          {error ||
            message ||
            'Materials are saved locally. Each project keeps its own copy of the selected settings.'}
        </p>
        <button type="button" onClick={onClose}>
          Done
        </button>
      </footer>
    </dialog>
  );
}
