import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { fetchSearch, type SearchResult } from '../api/client.js';

export interface SearchModalProps {
  onClose: () => void;
  onNavigate: (repoId: string, docKey: string) => void;
}

const DEBOUNCE_MS = 150;

/**
 * ⌘K global search overlay: dark backdrop, brass-framed input, results grouped by repo,
 * ↑/↓ + Enter keyboard navigation, Esc closes. Queries `GET /api/search?q=…` with a 150ms
 * debounce.
 */
export function SearchModal({ onClose, onNavigate }: SearchModalProps): ReactElement {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearched(false);
      return;
    }
    const timer = setTimeout(() => {
      fetchSearch(q)
        .then((r) => {
          setResults(r);
          setActiveIndex(0);
          setSearched(true);
        })
        .catch(() => {
          setResults([]);
          setSearched(true);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Grouped by repo for display; the flat order (which drives ↑/↓) is the grouped order.
  const groups = useMemo(() => {
    const byRepo = new Map<string, SearchResult[]>();
    for (const result of results) {
      const existing = byRepo.get(result.repoName);
      if (existing) existing.push(result);
      else byRepo.set(result.repoName, [result]);
    }
    return [...byRepo.entries()];
  }, [results]);

  const flat = useMemo(() => groups.flatMap(([, groupResults]) => groupResults), [groups]);

  useEffect(() => {
    const el = listRef.current?.querySelector('.search-result--active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = flat[activeIndex];
      if (hit) onNavigate(hit.repoId, hit.docKey);
    }
  }

  let flatIndex = -1;

  return (
    <div
      className="search-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="search-modal" role="dialog" aria-modal="true" aria-label="Search all repos">
        <div className="search-modal__inner">
          <div className="search-modal__input-row">
            <span className="search-modal__glyph" aria-hidden="true">
              ⌕
            </span>
            <input
              ref={inputRef}
              className="search-modal__input"
              type="text"
              placeholder="Search all repos — docs, ids, headings…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Search all repos"
            />
            <span className="chrome__kbd">esc</span>
          </div>
          {flat.length > 0 && (
            <div className="search-modal__results" ref={listRef}>
              {groups.map(([repoName, groupResults]) => (
                <div key={repoName}>
                  <div className="search-modal__group-label">{repoName}</div>
                  {groupResults.map((result) => {
                    flatIndex += 1;
                    const index = flatIndex;
                    return (
                      <button
                        key={`${result.repoId}-${result.docKey}-${result.matchKind}-${result.heading ?? ''}`}
                        type="button"
                        className={index === activeIndex ? 'search-result search-result--active' : 'search-result'}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => onNavigate(result.repoId, result.docKey)}
                      >
                        <span className="search-result__kind">{result.matchKind}</span>
                        <span className="search-result__title">
                          {result.title}
                          {result.heading && <span className="search-result__heading"> › {result.heading}</span>}
                        </span>
                        <span className="search-result__path">{result.path}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {searched && flat.length === 0 && query.trim() && (
            <div className="search-modal__empty">Nothing found for “{query.trim()}”.</div>
          )}
          <div className="search-modal__hint">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>esc close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
