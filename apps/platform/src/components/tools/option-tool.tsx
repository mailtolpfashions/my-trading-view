'use client';

import { OPTION_TOOLS, type Tool } from '@/lib/tools';
import { ContractTool, MultiStrikeTool, OiClustersTool, StrategyChartTool, TimeseriesChainTool } from './options/history-tools';
import { GexTool, OiSpurtsTool, VegaTool } from './options/exposure';
import { MaxPainTool } from './options/max-pain';
import { OpenInterestTool } from './options/open-interest';
import { PcrTool } from './options/pcr';
import { PeCeTool, PriceVsOiTool } from './options/oi-series';
import { IntradaySellerTool } from './options/intraday-seller';
import { SellingReportTool } from './options/selling-report';
import { SellingStudyTool } from './options/selling-study';
import { DecayTool, StraddleTool } from './options/straddle';
import { IvGridTool, IvTool, SkewTool } from './options/volatility';

const TOOLS: Record<string, (p: { tool: Tool }) => React.ReactNode> = {
  'open-interest': OpenInterestTool,
  pcr: PcrTool,
  'max-pain': MaxPainTool,
  straddle: StraddleTool,
  decay: DecayTool,
  'pe-ce': PeCeTool,
  'multi-strike': MultiStrikeTool,
  'price-vs-oi': PriceVsOiTool,
  contract: ContractTool,
  timeseries: TimeseriesChainTool,
  iv: IvTool,
  skew: SkewTool,
  'iv-grid': IvGridTool,
  vega: VegaTool,
  gex: GexTool,
  'oi-spurts': OiSpurtsTool,
  'oi-clusters': OiClustersTool,
  'strategy-chart': StrategyChartTool,
  'selling-study': SellingStudyTool,
  'intraday-seller': IntradaySellerTool,
  'selling-report': SellingReportTool,
};

/** One option analysis tool, chosen by its slug (/options/<slug>). */
export function OptionTool({ slug }: { slug: string }) {
  const tool = OPTION_TOOLS.find((t) => t.slug === slug)!;
  const View = TOOLS[slug];
  return View ? <View tool={tool} /> : <p className="p-6 text-[13px] text-muted">{tool.label} is not built yet.</p>;
}
