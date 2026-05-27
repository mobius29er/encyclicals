'use client';

import { useTheme } from './ThemeProvider';

interface ToolbarProps {
  onMenuClick: () => void;
  onSearch: (q: string) => void;
  searchValue: string;
  onSearchNav: (dir: -1 | 1) => void;
  onSearchClear: () => void;
  searchCount: number;
  searchIndex: number;
  onTTSStart: () => void;
  onToggleND: () => void;
  ndOn: boolean;
  onToggleBookmarks: () => void;
  onToggleSettings: () => void;
}

export default function Toolbar({
  onMenuClick,
  onSearch,
  searchValue,
  onSearchNav,
  onSearchClear,
  searchCount,
  searchIndex,
  onTTSStart,
  onToggleND,
  ndOn,
  onToggleBookmarks,
  onToggleSettings,
}: ToolbarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <>
      <div className="toolbar">
        <button className="ibtn menu-btn" onClick={onMenuClick} type="button">
          ☰
        </button>
        <div className="brand">✦ ENCYCLICALS</div>
        <div className="spacer"></div>
        <input
          className="sinput"
          value={searchValue}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search…"
        />
        <div className="tdiv"></div>
        <button className="ibtn" onClick={onTTSStart} title="Read Aloud" type="button">
          🔊
        </button>
        <button
          className={`ibtn${ndOn ? ' nd-active' : ''}`}
          onClick={onToggleND}
          title="Focus Mode"
          type="button"
        >
          ND
        </button>
        <div className="tdiv"></div>
        <button className="ibtn" onClick={onToggleBookmarks} title="Bookmarks" type="button">
          ◇
        </button>
        <button className="ibtn" onClick={onToggleSettings} title="Settings" type="button">
          ⚙
        </button>
        <button className="ibtn" onClick={toggleTheme} title="Theme" type="button">
          {theme === 'dark' ? '☽' : '☀'}
        </button>
      </div>
      {searchCount > 0 && (
        <div className="sbanner vis">
          <span>
            {searchIndex + 1} / {searchCount}
          </span>
          <button className="snav" onClick={() => onSearchNav(-1)} type="button">
            ↑
          </button>
          <button className="snav" onClick={() => onSearchNav(1)} type="button">
            ↓
          </button>
          <button className="snav" onClick={onSearchClear} type="button">
            ✕
          </button>
        </div>
      )}
    </>
  );
}
