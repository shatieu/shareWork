import { useCallback, useEffect, useState } from 'react';
import type { SeaChestClient } from '../client.js';
import { LOCKER_KINDS, type LockerItemSummary, type LockerKind } from '../types.js';
import { ItemDetail } from './ItemDetail.js';
import { ProfilesPanel } from './ProfilesPanel.js';
import { TokensPanel } from './TokensPanel.js';

/**
 * The locker page (Locker_Spec §5): browse items by kind, drill into version history /
 * metadata / publish toggle / install snippet, manage machine profiles and marketplace
 * tokens. Harbor mounts this on its signed-in locker route with a fetch client
 * (`createFetchSeaChestClient('/api/sea-chest')`).
 */
export function SeaChestPage({ client }: { client: SeaChestClient }) {
  const [items, setItems] = useState<LockerItemSummary[]>([]);
  const [kind, setKind] = useState<LockerKind | ''>('');
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    return client
      .listItems(kind === '' ? undefined : kind)
      .then(setItems)
      .catch((err: Error) => setError(err.message));
  }, [client, kind]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="sea-chest-page">
      <h2>Sea Chest</h2>
      {error && <p role="alert" className="sea-chest-error">{error}</p>}

      <label>
        Kind
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as LockerKind | '');
            setSelectedItem(null);
          }}
        >
          <option value="">all kinds</option>
          {LOCKER_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <ul className="sea-chest-items" aria-label="Locker items">
        {items.map((item) => (
          <li key={item.id}>
            <button onClick={() => setSelectedItem(item.name)}>
              {item.name} — {item.kind} v{item.version}
              {item.published ? ' · published' : ''}
            </button>
          </li>
        ))}
        {items.length === 0 && <li>(locker is empty{kind ? ` for kind ${kind}` : ''})</li>}
      </ul>

      {selectedItem && (
        <ItemDetail client={client} name={selectedItem} onChanged={() => void reload()} />
      )}

      <ProfilesPanel client={client} items={items} />
      <TokensPanel client={client} />
    </div>
  );
}
