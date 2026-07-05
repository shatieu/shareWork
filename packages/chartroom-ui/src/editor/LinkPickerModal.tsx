// Ctrl+K fuzzy link picker (plan §7/§1.4) — hand-rolled modal, not `cmdk` (approved,
// DECISIONS-NEEDED.md "Package 3": cheap, no new dependency shape risk, easy to swap later if a
// broader command-palette feel is wanted). `fuse.js` does the fuzzy matching over the already-
// fetched per-repo doc list; this component owns only text-input + filtered-list + keyboard-nav +
// Escape-to-close + selection -> `insertLink()` (pure function, unit-tested separately, §9.3).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';
import Fuse from 'fuse.js';
import type { DocSummary } from '../api/client.js';
import { insertLink } from './insertLink.js';

export interface LinkPickerModalProps {
  docs: DocSummary[];
  currentDocPath: string;
  /** Text the user had selected in the editor at Ctrl+K time, if any (plan §7: used as link text
   * when present, falling back to the target doc's title otherwise). */
  selectedText?: string;
  onInsert: (markdown: string) => void;
  onClose: () => void;
}

/** Weighted keys: title highest, then path, then id (plan §1.4 — a reasonable default, not
 * empirically tuned). */
const FUSE_OPTIONS = {
  keys: [
    { name: 'title', weight: 3 },
    { name: 'path', weight: 2 },
    { name: 'id', weight: 1 },
  ],
  threshold: 0.4,
};

export function LinkPickerModal({
  docs,
  currentDocPath,
  selectedText,
  onInsert,
  onClose,
}: LinkPickerModalProps): ReactElement {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const fuse = useMemo(() => new Fuse(docs, FUSE_OPTIONS), [docs]);

  const results = useMemo<DocSummary[]>(() => {
    if (query.trim().length === 0) return docs.slice(0, 20);
    return fuse.search(query).slice(0, 20).map((r) => r.item);
  }, [fuse, query, docs]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function commit(target: DocSummary): void {
    onInsert(insertLink(currentDocPath, target, selectedText));
    onClose();
  }

  function handleKeyDown(event: ReactKeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[activeIndex];
      if (target) commit(target);
    }
  }

  return (
    <div className="link-picker-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="link-picker-modal"
        role="dialog"
        aria-label="Insert link"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="link-picker-modal__input"
          type="text"
          placeholder="Search docs by title, path, or id..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <ul className="link-picker-modal__list" role="listbox">
          {results.map((doc, i) => (
            <li
              key={doc.id ?? doc.path}
              role="option"
              aria-selected={i === activeIndex}
              className={i === activeIndex ? 'link-picker-modal__item link-picker-modal__item--active' : 'link-picker-modal__item'}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => commit(doc)}
            >
              <span className="link-picker-modal__item-title">{doc.title}</span>
              <span className="link-picker-modal__item-path">{doc.path}</span>
            </li>
          ))}
          {results.length === 0 && <li className="link-picker-modal__empty">No matching docs.</li>}
        </ul>
      </div>
    </div>
  );
}
