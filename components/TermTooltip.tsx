'use client';

import { useEffect, useRef, useState } from 'react';

export default function TermTooltip() {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const term = target.closest('.term') as HTMLElement | null;
      if (term) {
        e.preventDefault();
        setTitle(term.textContent || '');
        setBody(term.getAttribute('data-def') || '');
        const r = term.getBoundingClientRect();
        let top = r.bottom + 8;
        let left = r.left;
        if (ref.current) {
          if (top + ref.current.offsetHeight > window.innerHeight) top = r.top - ref.current.offsetHeight - 8;
          if (left + 340 > window.innerWidth) left = window.innerWidth - 350;
          if (left < 10) left = 10;
        }
        setPos({ top, left });
        setVisible(true);
      } else if (!target.closest('.term-tip')) {
        setVisible(false);
      }
    };

    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  return (
    <div ref={ref} className="term-tip" style={{ display: visible ? 'block' : 'none', top: pos.top, left: pos.left }}>
      <div className="tip-title">{title}</div>
      <div className="tip-body">{body}</div>
    </div>
  );
}
