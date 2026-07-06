import { useEffect, useState } from 'react';
import type { SeaChestClient } from '../client.js';
import type { LockerItemSummary, MachineProfile } from '../types.js';

/** Machine profiles (Locker_Spec §5): named item sets for `locker_setup_machine`. */
export function ProfilesPanel({
  client,
  items,
}: {
  client: SeaChestClient;
  items: LockerItemSummary[];
}) {
  const [profiles, setProfiles] = useState<MachineProfile[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    client
      .listProfiles()
      .then(setProfiles)
      .catch((err: Error) => setError(err.message));

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const toggle = (itemName: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemName)) next.delete(itemName);
      else next.add(itemName);
      return next;
    });
  };

  const save = async () => {
    setError(null);
    try {
      await client.saveProfile(name.trim(), [...selected].sort());
      setName('');
      setSelected(new Set());
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section aria-label="Machine profiles" className="sea-chest-profiles">
      <h3>Machine profiles</h3>
      {error && <p role="alert" className="sea-chest-error">{error}</p>}
      <ul>
        {profiles.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong>: {p.itemNames.join(', ') || '(empty)'}
          </li>
        ))}
        {profiles.length === 0 && <li>(no profiles yet)</li>}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Profile name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="laptop-default"
          />
        </label>
        <fieldset>
          <legend>Items</legend>
          {items.map((item) => (
            <label key={item.name}>
              <input
                type="checkbox"
                checked={selected.has(item.name)}
                onChange={() => toggle(item.name)}
              />
              {item.name} ({item.kind})
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={name.trim() === ''}>
          Save profile
        </button>
      </form>
    </section>
  );
}
