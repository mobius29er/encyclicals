'use client';

import { applyNDToHtml, removeNDFromHtml } from '@/lib/bionic';
import { ParagraphBlock } from '@/types/document';

interface ReaderCardProps {
  block: ParagraphBlock;
  isBookmarked: boolean;
  isTTSActive: boolean;
  isSearchHit: boolean;
  onToggleBookmark: (id: string, label: string) => void;
  ndMode: boolean;
}

export default function ReaderCard({
  block,
  isBookmarked,
  isTTSActive,
  isSearchHit,
  onToggleBookmark,
  ndMode,
}: ReaderCardProps) {
  const classes = ['card', isBookmarked ? 'bookmarked' : '', isTTSActive ? 'tts-active' : '', isSearchHit ? 'search-hit' : '']
    .filter(Boolean)
    .join(' ');
  const html = ndMode ? applyNDToHtml(block.html) : removeNDFromHtml(block.html);

  return (
    <div className={classes} id={block.id} data-nd={ndMode ? 'on' : 'off'}>
      <div className="card-top">
        <span className="card-num">{block.number}</span>
        <button
          className="bm-btn"
          onClick={() => onToggleBookmark(block.id, `§${block.number}`)}
          title="Bookmark"
          type="button"
        >
          ◇
        </button>
      </div>
      <div className="card-text">
        <p dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      {block.footnotes.length > 0 && (
        <div className="card-fn">
          {block.footnotes.map((fn) => (
            <div key={fn.num} className="fn-row">
              <span className="fn-num">{fn.num}.</span>
              <span className="fn-text" dangerouslySetInnerHTML={{ __html: fn.text }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
