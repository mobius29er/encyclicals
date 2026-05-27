'use client';

interface Bookmark {
  id: string;
  label: string;
  timestamp: number;
}

interface BookmarksPanelProps {
  isOpen: boolean;
  bookmarks: Record<string, Bookmark>;
  onNavigate: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function BookmarksPanel({ isOpen, bookmarks, onNavigate, onRemove }: BookmarksPanelProps) {
  const entries = Object.entries(bookmarks).sort((a, b) => {
    const aNum = Number.parseInt(a[0].replace('p', ''), 10);
    const bNum = Number.parseInt(b[0].replace('p', ''), 10);
    return aNum - bNum;
  });

  return (
    <div className={`panel${isOpen ? ' open' : ''}`} style={{ top: 60, right: 14 }}>
      <div className="panel-label">Bookmarks</div>
      {entries.length === 0 ? (
        <p
          style={{ color: 'var(--ink3)', fontStyle: 'italic', textAlign: 'center', padding: 14, fontSize: 13 }}
        >
          Click ◇ on any card to bookmark.
        </p>
      ) : (
        <ul className="bm-list">
          {entries.map(([id, bm]) => (
            <li key={id} className="bm-item">
              <button
                onClick={() => onNavigate(id)}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', flex: 1, textAlign: 'left', padding: 0, fontSize: 14 }}
                type="button"
              >
                {bm.label}
              </button>
              <button
                onClick={() => onRemove(id)}
                style={{ background: 'none', border: 'none', color: 'var(--ink3)', cursor: 'pointer', fontSize: 16 }}
                type="button"
                aria-label={`Remove bookmark ${bm.label}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
