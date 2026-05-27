'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DocumentData, DocumentBlock } from '@/types/document';
import Toolbar from './Toolbar';
import Sidebar from './Sidebar';
import ReaderCard from './ReaderCard';
import ChapterHeader from './ChapterHeader';
import SettingsPanel from './SettingsPanel';
import BookmarksPanel from './BookmarksPanel';
import TTSBar from './TTSBar';
import TermTooltip from './TermTooltip';
import { storageGet, storageSet } from '@/lib/storage';

interface Bookmark {
  id: string;
  label: string;
  timestamp: number;
}

function getInitialBookmarks(slug: string): Record<string, Bookmark> {
  const raw = storageGet(`bms_${slug}`);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, Bookmark>;
  } catch {
    return {};
  }
}

function getInitialFontSize(): number {
  const raw = storageGet('fsz');
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isNaN(parsed) ? 18 : parsed;
}

function getInitialNDMode(): boolean {
  return storageGet('ndmode') === '1';
}

export default function DocumentReader({ doc }: { doc: DocumentData }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [ndOn, setNdOn] = useState(false);
  const [fontSize, setFontSizeState] = useState(18);
  const [bookmarks, setBookmarks] = useState<Record<string, Bookmark>>({}); 
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [activeId, setActiveId] = useState(doc.toc[0]?.id ?? '');
  const [ttsOpen, setTTSOpen] = useState(false);
  const [ttsActiveBlock, setTTSActiveBlock] = useState<string | null>(null);

  const searchHits = useMemo(() => {
    if (searchQuery.trim().length < 2) return [] as string[];
    const q = searchQuery.toLowerCase();
    return doc.blocks.flatMap((block) => {
      if (block.type !== 'paragraph') return [];
      const text = block.html.replace(/<[^>]+>/g, '').toLowerCase();
      return text.includes(q) ? [block.id] : [];
    });
  }, [searchQuery, doc.blocks]);
  const effectiveSearchIndex = searchHits.length ? Math.min(searchIndex, searchHits.length - 1) : 0;

  // Hydrate global settings from localStorage after mount (avoids SSR/client mismatch)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFontSizeState(getInitialFontSize());
    setNdOn(getInitialNDMode());
  }, []);

  // Hydrate bookmarks whenever the document changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBookmarks(getInitialBookmarks(doc.slug));
  }, [doc.slug]);

  useEffect(() => {
    document.documentElement.style.setProperty('--fsz', `${fontSize}px`);
    storageSet('fsz', String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    document.body.classList.toggle('nd-mode', ndOn);
    storageSet('ndmode', ndOn ? '1' : '0');
  }, [ndOn]);

  useEffect(() => {
    const spos = storageGet(`spos_${doc.slug}`);
    if (!spos) return;
    const y = Number.parseInt(spos, 10);
    if (y > 80) window.setTimeout(() => window.scrollTo({ top: y }), 100);
  }, [doc.slug]);

  useEffect(() => {
    const pb = document.getElementById('pb-reader');
    let saveTimer: number | undefined;

    const onScroll = () => {
      const h = document.documentElement;
      const pct = h.scrollHeight > h.clientHeight ? (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100 : 0;
      if (pb) pb.style.width = `${pct}%`;
      const stt = document.getElementById('stt-reader');
      if (stt) stt.classList.toggle('vis', h.scrollTop > 300);
      if (saveTimer) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => storageSet(`spos_${doc.slug}`, String(window.scrollY)), 500);
      const allHeads = document.querySelectorAll<HTMLElement>('.chapter-header, .sec-head, .sub-head');
      let cur = '';
      const sp = window.scrollY + 200;
      allHeads.forEach((el) => {
        if (el.offsetTop <= sp && el.id) cur = el.id;
      });
      if (cur) setActiveId(cur);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      if (saveTimer) window.clearTimeout(saveTimer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [doc.slug]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.panel') && !target.closest('.ibtn')) {
        setSettingsOpen(false);
        setBookmarksOpen(false);
      }
      if (window.innerWidth <= 1024 && sidebarOpen && !target.closest('.side') && !target.closest('.menu-btn')) {
        setSidebarOpen(false);
      }
    };

    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [sidebarOpen]);

  useEffect(() => {
    if (searchHits.length === 0) return;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(searchHits[effectiveSearchIndex]);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [effectiveSearchIndex, searchHits]);

  const toggleBookmark = useCallback(
    (id: string, label: string) => {
      setBookmarks((prev) => {
        const next = { ...prev };
        if (next[id]) delete next[id];
        else next[id] = { id, label, timestamp: Date.now() };
        storageSet(`bms_${doc.slug}`, JSON.stringify(next));
        return next;
      });
    },
    [doc.slug],
  );

  const navigateToBlock = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setBookmarksOpen(false);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setSearchIndex(0);
  }, []);

  const handleSearchNav = useCallback(
    (dir: -1 | 1) => {
      if (!searchHits.length) return;
      const next = (effectiveSearchIndex + dir + searchHits.length) % searchHits.length;
      setSearchIndex(next);
      const el = document.getElementById(searchHits[next]);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    [effectiveSearchIndex, searchHits],
  );

  return (
    <>
      <div className="pbar" id="pb-reader" />
      <Toolbar
        onMenuClick={() => setSidebarOpen((s) => !s)}
        onSearch={handleSearchChange}
        searchValue={searchQuery}
        onSearchNav={handleSearchNav}
        onSearchClear={() => {
          setSearchQuery('');
          setSearchIndex(0);
        }}
        searchCount={searchHits.length}
        searchIndex={effectiveSearchIndex}
        onTTSStart={() => setTTSOpen(true)}
        onToggleND={() => setNdOn((n) => !n)}
        ndOn={ndOn}
        onToggleBookmarks={() => {
          setBookmarksOpen((b) => !b);
          setSettingsOpen(false);
        }}
        onToggleSettings={() => {
          setSettingsOpen((s) => !s);
          setBookmarksOpen(false);
        }}
      />
      <SettingsPanel
        isOpen={settingsOpen}
        fontSize={fontSize}
        onSetFontSize={setFontSizeState}
        ndOn={ndOn}
        onToggleND={() => setNdOn((n) => !n)}
      />
      <BookmarksPanel
        isOpen={bookmarksOpen}
        bookmarks={bookmarks}
        onNavigate={navigateToBlock}
        onRemove={(id) => toggleBookmark(id, '')}
      />
      <TermTooltip />
      <div className="wrap">
        <Sidebar toc={doc.toc} isOpen={sidebarOpen} activeId={activeId} docTitle={doc.title} />
        <main id="main">
          <div className="doc-header">
            <h1 className="doc-title">{doc.title}</h1>
            {doc.subtitle && (
              <p className="doc-subtitle">{doc.subtitle}</p>
            )}
            <p className="doc-meta">{doc.author} · {doc.dateDisplay}</p>
          </div>
          {doc.blocks.map((block) =>
            renderBlock(block, bookmarks, ttsActiveBlock, searchHits, toggleBookmark, ndOn),
          )}
          <div className="signature">
            <p>
              <em>Given in Rome, at Saint Peter&apos;s, on {doc.dateDisplay}, the second of my Pontificate.</em>
            </p>
            <p className="sig-name">{doc.author.toUpperCase().replace('POPE ', '')}</p>
          </div>
        </main>
      </div>
      <button className="stt" id="stt-reader" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} type="button">
        ↑
      </button>
      {ndOn && <div className="nd-badge">✦ FOCUS MODE</div>}
      {ttsOpen && (
        <TTSBar
          blocks={doc.blocks}
          slug={doc.slug}
          isOpen={ttsOpen}
          onClose={() => setTTSOpen(false)}
          onActiveBlock={setTTSActiveBlock}
        />
      )}
    </>
  );
}

function renderBlock(
  block: DocumentBlock,
  bookmarks: Record<string, { id: string; label: string; timestamp: number }>,
  ttsActiveBlock: string | null,
  searchHits: string[],
  toggleBookmark: (id: string, label: string) => void,
  ndOn: boolean,
) {
  switch (block.type) {
    case 'chapter-header':
      return <ChapterHeader key={block.id} block={block} />;
    case 'sec-head':
      return <h3 key={block.id} className="sec-head" id={block.id} dangerouslySetInnerHTML={{ __html: block.html }} />;
    case 'sub-head':
      return <h4 key={block.id} className="sub-head" id={block.id} dangerouslySetInnerHTML={{ __html: block.html }} />;
    case 'signature':
      return <div key={block.id} className="signature" dangerouslySetInnerHTML={{ __html: block.html }} />;
    case 'paragraph':
      return (
        <ReaderCard
          key={block.id}
          block={block}
          isBookmarked={Boolean(bookmarks[block.id])}
          isTTSActive={ttsActiveBlock === block.id}
          isSearchHit={searchHits.includes(block.id)}
          onToggleBookmark={toggleBookmark}
          ndMode={ndOn}
        />
      );
    default:
      return null;
  }
}
