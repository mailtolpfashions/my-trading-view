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

## lightweight-charts-indicators and oakscriptjs

- `lightweight-charts-indicators` 0.16.8 (https://github.com/deepentropy/lightweight-charts-indicators): used unmodified.
  Only its standard indicators and candlestick patterns are offered; its community ports are not used.
- `oakscriptjs` 0.12.3 (https://github.com/deepentropy/oakscriptJS): used unmodified (dependency of the above).

```
Copyright (c) 2025 Odyssée (lightweight-charts-indicators)
Copyright (c) 2025-2026 Odyssée (oakscriptjs)
```

Both licensed under the MIT License: Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following
conditions: The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
