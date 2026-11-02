import { readLocalSetting } from '../lib/storage';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, ChevronDown } from 'lucide-react';

/** Completion is a local workflow preference, separate from projects and cut templates. */
export default function PrintSection({
  layoutKey,
  section,
  title,
  summary,
  version = '1',
  autoComplete = false,
  canComplete = true,
  busy = false,
  children,
}: {
  layoutKey: string;
  section: string;
  title: string;
  summary: string;
  version?: string;
  autoComplete?: boolean;
  canComplete?: boolean;
  busy?: boolean;
  children: ReactNode;
}) {
  const storageKey = `skarix:print-section:${layoutKey}:${section}`;
  // Artwork can be a large data URL. Store a compact fingerprint rather than duplicating it.
  const fingerprint = useMemo(() => {
    let first = 2166136261,
      second = 5381;
    for (let i = 0; i < version.length; i++) {
      first = Math.imul(first ^ version.charCodeAt(i), 16777619);
      second = Math.imul(second, 33) ^ version.charCodeAt(i);
    }
    return `${version.length}:${first >>> 0}:${second >>> 0}`;
  }, [version]);
  const [doneVersion, setDoneVersion] = useState(() => {
    try {
      return readLocalSetting(storageKey);
    } catch {
      return null;
    }
  });
  const completed = autoComplete || (canComplete && doneVersion === fingerprint);
  const [open, setOpen] = useState(!completed);
  const contentId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (completed && content.current?.contains(document.activeElement)) toggle.current?.focus();
    setOpen(!completed);
  }, [completed]);

  function finish() {
    toggle.current?.focus();
    setDoneVersion(fingerprint);
    setOpen(false);
    try {
      localStorage.setItem(storageKey, fingerprint);
    } catch {
      // Keep the section usable when local preference storage is unavailable.
    }
  }

  return (
    <section className={`print-section ${completed ? 'completed' : ''}`}>
      <h3 className="print-section-heading">
        <button
          ref={toggle}
          type="button"
          className="print-section-toggle"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen(!open)}
        >
          {completed && <CheckCircle2 size={18} className="print-section-check" />}
          <span className="print-section-label">
            <span>{title}</span>
            <small>{summary}</small>
          </span>
          <span className="print-section-status">{completed ? 'Done' : 'Review'}</span>
          <ChevronDown size={16} className={open ? 'expanded' : ''} />
        </button>
      </h3>
      <div ref={content} id={contentId} className="print-section-content" hidden={!open}>
        {children}
        {canComplete && (
          <div className="print-section-actions">
            <button type="button" className="secondary compact" disabled={busy} onClick={finish}>
              <CheckCircle2 size={14} /> Done
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
