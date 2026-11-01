/** Research views, one page each (/research/<slug>). Plain module: read by server pages and client components. */
export const RESEARCH_VIEWS = [
  { slug: 'study', label: 'Condition study' },
  { slug: 'nifty-days', label: 'NIFTY day by day' },
  { slug: 'fii', label: 'FII footprints' },
  { slug: 'scanner', label: 'Scanner' },
] as const;
export type ResearchSlug = (typeof RESEARCH_VIEWS)[number]['slug'];
