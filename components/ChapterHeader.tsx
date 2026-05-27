'use client';

import { ChapterHeaderBlock } from '@/types/document';

export default function ChapterHeader({ block }: { block: ChapterHeaderBlock }) {
  return (
    <div className="chapter-header" id={block.id}>
      <div className="chapter-tag">{block.tag}</div>
      <h2>{block.title}</h2>
      <div className="ch-orn">✦</div>
    </div>
  );
}
