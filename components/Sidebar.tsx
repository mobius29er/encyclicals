'use client';

import { TocChapter } from '@/types/document';

interface SidebarProps {
  toc: TocChapter[];
  isOpen: boolean;
  activeId: string;
  docTitle: string;
}

export default function Sidebar({ toc, isOpen, activeId, docTitle }: SidebarProps) {
  return (
    <nav className={`side${isOpen ? ' open' : ''}`} id="side" aria-label={`${docTitle} table of contents`}>
      <div className="side-title">Contents</div>
      {toc.map((chapter) => (
        <div key={chapter.id}>
          <a className={`toc-ch${activeId === chapter.id ? ' active' : ''}`} href={`#${chapter.id}`}>
            {chapter.label}
          </a>
          {chapter.sections.map((sec) => (
            <a key={sec.id} className={`toc-sec${activeId === sec.id ? ' active' : ''}`} href={`#${sec.id}`}>
              {sec.label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}
