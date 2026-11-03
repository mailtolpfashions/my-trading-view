'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

const WIDTH = 340;

/**
 * A small ⓘ button that shows an explanation on click, so notes about method, sources and limits stay out of the
 * way until someone wants them. The popover is fixed to the viewport (never clipped by a scrolling panel) and closes
 * on Escape, an outside click, or scrolling. Rendered into <body>, so it can sit inside headings and paragraphs.
 */
export function InfoTip({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number; up: boolean } | null>(null);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onDown = (e: PointerEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); btn.current?.focus(); } };
    // Scrolling the page moves the button away from the popover; scrolling the popover's own text does not, and
    // neither does a scroll still settling just after the click (trackpad momentum).
    const opened = Date.now();
    const onScroll = (e: Event) => { if (Date.now() - opened > 300 && !pop.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [at]);

  const toggle = (e: React.MouseEvent) => {
    // Inside a <summary> or <label>, the click must not also toggle the details or focus the field.
    e.preventDefault();
    e.stopPropagation();
    if (at) return setAt(null);
    const r = btn.current!.getBoundingClientRect();
    const w = Math.min(WIDTH, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    const up = r.bottom + 220 > window.innerHeight && r.top > 240; // open upwards near the bottom of the screen
    setAt({ top: up ? r.top - 6 : r.bottom + 6, left, up });
  };

  return (
    <>
      <button ref={btn} type="button" onClick={toggle} aria-label={label} aria-expanded={!!at} title={label}
        className={`inline-grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full align-middle text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent ${at ? 'bg-raised text-ink' : ''} ${className}`}>
        <Info size={14} aria-hidden="true" />
      </button>
      {at && createPortal(
        <div ref={pop} role="dialog" aria-label={label}
          className="fixed z-[60] max-h-[60vh] overflow-y-auto rounded-[14px] bg-panel px-4 py-3 text-left text-[12.5px] leading-relaxed font-normal tracking-normal text-ink-2 normal-case shadow-[var(--shadow-pop)] [&_p+p]:mt-2"
          style={{ left: at.left, width: Math.min(WIDTH, window.innerWidth - 16), ...(at.up ? { bottom: window.innerHeight - at.top } : { top: at.top }) }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
