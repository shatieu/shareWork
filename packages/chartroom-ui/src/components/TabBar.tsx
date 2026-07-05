import type { ReactElement } from 'react';

/** One Deck station tab. Docs is always present; further tabs (Voyage tonight; Inbox /
 * Settings / Console / Analytics later) are appended from what the hull reports. */
export interface DeckTab {
  id: string;
  title: string;
}

export interface TabBarProps {
  tabs: DeckTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
}

/** Station tab bar under the top chrome. Purely presentational -- the host owns the typed
 * `DeckTab[]` registry and maps selections onto hash routes. */
export function TabBar({ tabs, activeTabId, onSelect }: TabBarProps): ReactElement {
  return (
    <nav className="tab-bar" role="tablist" aria-label="Deck stations">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={isActive ? 'tab-bar__tab tab-bar__tab--active' : 'tab-bar__tab'}
            onClick={() => onSelect(tab.id)}
          >
            {tab.title}
          </button>
        );
      })}
    </nav>
  );
}
