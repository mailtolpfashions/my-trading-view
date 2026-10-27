# Third-party notices

My Trading View includes or adapts the following open-source software.

## TradingView Lightweight Charts™

- Library: `lightweight-charts` (installed from npm, used unmodified).
- Adapted code: plugin examples `trend-line`, `rectangle-drawing-tool`, `user-price-lines` and `vertical-line`, and
  `PluginBase` from `@tradingview/lwc-toolkit`, from https://github.com/tradingview/lightweight-charts
  (commit c9ec1ce, October 2026). Adapted in `apps/web/src/lib/chart/drawings/layer.ts`: merged into one drawing
  layer for all drawing kinds, with timeframe-independent point mapping, selection handles, a measure tool, alert
  lines and our styling.

```
TradingView Lightweight Charts™
Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/
```

Licensed under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0). Unless required by
applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

The charts display TradingView's attribution, as the library requires.
