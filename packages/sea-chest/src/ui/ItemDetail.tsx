import { useEffect, useState } from 'react';
import type { SeaChestClient } from '../client.js';
import type { LockerItem, LockerVersionSummary } from '../types.js';

/**
 * One locker item (Locker_Spec §5): version history, metadata edit, publish toggle,
 * per-item install snippet. Pure client-driven; host provides the SeaChestClient.
 */
export function ItemDetail({
  client,
  name,
  onChanged,
}: {
  client: SeaChestClient;
  name: string;
  onChanged?: () => void;
}) {
  const [item, setItem] = useState<LockerItem | null>(null);
  const [versions, setVersions] = useState<LockerVersionSummary[]>([]);
  const [snippet, setSnippet] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItem(null);
    setSnippet(null);
    setError(null);
    Promise.all([client.getItem(name), client.listVersions(name)])
      .then(([loadedItem, loadedVersions]) => {
        if (cancelled) return;
        setItem(loadedItem);
        setDescription(loadedItem.description);
        setVersions(loadedVersions);
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [client, name]);

  if (error) return <p role="alert" className="sea-chest-error">{error}</p>;
  if (!item) return <p>Loading…</p>;

  const saveMeta = async (patch: { description?: string; published?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await client.updateItemMeta(item.name, patch);
      setItem(updated);
      setDescription(updated.description);
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sea-chest-item-detail" aria-label={`Item ${item.name}`}>
      <header>
        <h3>
          {item.name} <span className="sea-chest-kind">{item.kind}</span>
        </h3>
        <p>
          v{item.version} · {item.published ? 'published' : 'private'}
        </p>
      </header>

      <label>
        Description
        <textarea
          value={description}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <button
        disabled={busy || description === item.description}
        onClick={() => void saveMeta({ description })}
      >
        Save description
      </button>

      <label className="sea-chest-publish">
        <input
          type="checkbox"
          checked={item.published}
          disabled={busy}
          onChange={(e) => void saveMeta({ published: e.target.checked })}
        />
        Published (community marketplace, Locker_Spec phase 5)
      </label>

      <div>
        <button
          disabled={busy}
          onClick={() =>
            void client
              .installSnippet(item.name)
              .then((r) => setSnippet(r.snippet))
              .catch((err: Error) => setError(err.message))
          }
        >
          Show install snippet
        </button>
        {snippet && <pre data-testid="install-snippet">{snippet}</pre>}
      </div>

      <h4>Files</h4>
      <ul className="sea-chest-files">
        {Object.keys(item.content.files)
          .sort()
          .map((path) => (
            <li key={path}>{path}</li>
          ))}
      </ul>

      <h4>Version history</h4>
      <ol className="sea-chest-versions">
        {versions.map((v) => (
          <li key={v.version}>
            v{v.version} — {new Date(v.createdAt).toLocaleString()}
          </li>
        ))}
      </ol>
    </section>
  );
}
