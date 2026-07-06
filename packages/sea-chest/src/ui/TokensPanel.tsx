import { useEffect, useState } from 'react';
import type { SeaChestClient } from '../client.js';
import type { MarketplaceTokenInfo } from '../types.js';

/**
 * Marketplace tokens (Locker_Spec §2.1 "private, token-authed marketplace endpoint").
 * The plaintext token is shown exactly once after minting -- the server stores only a hash.
 */
export function TokensPanel({ client }: { client: SeaChestClient }) {
  const [tokens, setTokens] = useState<MarketplaceTokenInfo[]>([]);
  const [label, setLabel] = useState('');
  const [minted, setMinted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    client
      .listTokens()
      .then(setTokens)
      .catch((err: Error) => setError(err.message));

  useEffect(() => {
    void reload();
    // reload identity changes each render; effect intentionally keys on the client only.
  }, [client]);

  const mint = async () => {
    setError(null);
    try {
      const { token } = await client.createToken(label.trim());
      setMinted(token);
      setLabel('');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const revoke = async (id: string) => {
    setError(null);
    try {
      await client.revokeToken(id);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section aria-label="Marketplace tokens" className="sea-chest-tokens">
      <h3>Marketplace tokens</h3>
      {error && <p role="alert" className="sea-chest-error">{error}</p>}
      {minted && (
        <p data-testid="minted-token" className="sea-chest-minted">
          Copy it now — shown once: <code>{minted}</code>
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void mint();
        }}
      >
        <label>
          Label
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="work-vm"
          />
        </label>
        <button type="submit" disabled={label.trim() === ''}>
          Mint token
        </button>
      </form>
      <ul>
        {tokens.map((t) => (
          <li key={t.id}>
            {t.label} · created {new Date(t.createdAt).toLocaleDateString()} ·{' '}
            {t.revokedAt ? (
              'revoked'
            ) : (
              <button onClick={() => void revoke(t.id)}>Revoke</button>
            )}
          </li>
        ))}
        {tokens.length === 0 && <li>(no tokens yet)</li>}
      </ul>
    </section>
  );
}
