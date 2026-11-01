'use client';

import Link from 'next/link';
import { useShell } from '@/components/app/shell-context';
import { ScannerView } from '@/components/signals/scanner-view';
import { FiiFootprints } from './fii-footprints';
import { NiftyResearch } from './nifty-research';
import { StudyView } from './study-view';
import { RESEARCH_VIEWS, type ResearchSlug } from '@/lib/research-views';

/** Research views; each has its own page (/research/<slug>), and these tabs link between them. */
export function ResearchModule({ view }: { view: ResearchSlug }) {
  const { openChart } = useShell();
  return (
    <div className="grid min-h-0 grid-cols-1 grid-rows-[auto_1fr] gap-2">
      <nav aria-label="Research views" className="flex flex-wrap justify-self-start rounded-[20px] bg-panel p-1 shadow-[var(--shadow-panel)]">
        {RESEARCH_VIEWS.map((v) => (
          <Link key={v.slug} href={`/research/${v.slug}`} aria-current={v.slug === view ? 'page' : undefined}
            className={`rounded-full px-3 py-1 text-[12.5px] font-semibold whitespace-nowrap ${v.slug === view ? 'bg-inverse text-on-inverse' : 'text-ink-2 hover:bg-raised'}`}>{v.label}</Link>
        ))}
      </nav>
      {view === 'scanner' ? <ScannerView onOpenChart={openChart} /> : view === 'fii' ? <FiiFootprints /> : view === 'study' ? <StudyView /> : <NiftyResearch />}
    </div>
  );
}
