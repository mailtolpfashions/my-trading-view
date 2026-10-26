// TradingView-style chart workspace kit for the design samples.
// Prices are illustrative; the real app plugs in the market-data feed.
(function () {
  const LWC = window.LightweightCharts;
  const UP = '#089981', DOWN = '#f23645';

  // ---------- icons ----------
  const P = {
    cross: 'M12 3v6M12 15v6M3 12h6M15 12h6',
    trend: 'M5 19L19 5M5 19m-2 0a2 2 0 104 0a2 2 0 10-4 0M19 5m-2 0a2 2 0 104 0a2 2 0 10-4 0',
    hline: 'M3 12h18M7 12m-2 0a2 2 0 104 0a2 2 0 10-4 0',
    fib: 'M3 5h18M3 10h18M3 15h18M3 20h18',
    pattern: 'M3 18l5-9 4 5 4-9 5 8',
    brush: 'M4 20c2.5 0 4-1.5 4-4l9-9 3 3-9 9c-2.5 0-4.5 1-7 1z',
    text: 'M5 6V4h14v2M12 4v16M9 20h6',
    emoji: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9 10h.01M15 10h.01M8.5 14.5c2 2 5 2 7 0',
    ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
    zoom: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5M11 8v6M8 11h6',
    magnet: 'M6 3v9a6 6 0 0012 0V3h-4v9a2 2 0 01-4 0V3zM6 7h4M14 7h4',
    lock: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    plus: 'M12 5v14M5 12h14',
    plusc: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 8v8M8 12h8',
    ind: 'M3 17l5-6 4 3 4-7 5 5',
    alert: 'M12 20a7 7 0 100-14 7 7 0 000 14zM12 10v3l2 2M5 4L3 6M19 4l2 2',
    replay: 'M11 6l-7 6 7 6zM20 6l-7 6 7 6z',
    undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
    redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    camera: 'M4 8h4l2-3h4l2 3h4v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
    gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .2-1.4-1.4L17 5l-3-1-1 2h-2L10 4 7 5l.4 1.8L6 8.2 4 8l-1 3 2 1v0l-2 1 1 3 2-.2 1.4 1.4L7 19l3 1 1-2h2l1 2 3-1-.4-1.8 1.4-1.4 2 .2 1-3z',
    full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    candles: 'M7 4v16M17 4v16M5 8h4v8H5zM15 6h4v8h-4z',
    list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
    bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4',
    cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    chain: 'M3 5h18v14H3zM12 5v14M3 9.5h18M3 14h18',
    oi: 'M5 20V10M10 20V4M15 20v-7M20 20V8',
    signal: 'M2 12h4l3-8 6 16 3-8h4',
    scan: 'M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M7 12h10',
    news: 'M4 5h13v14H6a2 2 0 01-2-2zM17 9h3v8a2 2 0 01-2 2M8 9h5M8 13h5',
    help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01',
    paper: 'M6 3h9l4 4v14H6zM9 12h6M9 16h4',
    chev: 'M6 9l6 6 6-6',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
    algo: 'M8 6l-5 6 5 6M16 6l5 6-5 6M14 4l-4 16',
    bt: 'M12 8v4l3 2M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8M3 3v5h5',
  };
  const icon = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;

  // ---------- data ----------
  function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }
  const DAYS = [[9, 19], [9, 20], [9, 21], [9, 22], [9, 23], [9, 26]]; // Oct 2026 sessions
  const DAY = 86400, OPEN = 9 * 3600 + 15 * 60;

  // 5-minute bars in NSE hours. IST wall-clock is encoded as UTC because the chart renders UTC.
  function intraday(seed, endClose, vol) {
    const r = rng(seed), out = [];
    let c = 0, i = 0, bias = 0;
    for (const [m, d] of DAYS) {
      let t = Date.UTC(2026, m, d) / 1000 + OPEN;
      c += (r() - 0.5) * vol * 4; // overnight gap
      for (let b = 0; b < 75; b++, i++, t += 300) {
        if (i % 20 === 0) bias = (r() - 0.5) * vol * 0.6; // trend regimes
        const shock = r() < 0.04 ? (r() - 0.5) * vol * 5 : 0;
        const o = c, drift = bias + (r() - 0.5) * vol * 1.3 + shock;
        c = o + drift;
        out.push({ time: t, open: o, high: Math.max(o, c) + r() * vol * 0.5, low: Math.min(o, c) - r() * vol * 0.5, close: c, volume: Math.round(5e4 + r() * 2e5 + Math.abs(drift / vol) * 2e5) });
      }
    }
    return shift(out, endClose - c);
  }
  function daily(seed, endClose, vol) {
    const r = rng(seed + 7), out = [];
    let c = 0, t = Date.UTC(2025, 9, 27) / 1000;
    while (out.length < 250) {
      t += DAY; const wd = new Date(t * 1000).getUTCDay(); if (wd === 0 || wd === 6) continue;
      const o = c + (r() - 0.5) * vol; c = o + (r() - 0.48) * vol * 3;
      out.push({ time: t, open: o, high: Math.max(o, c) + r() * vol * 1.5, low: Math.min(o, c) - r() * vol * 1.5, close: c, volume: Math.round(2e7 + r() * 2e7) });
    }
    return shift(out, endClose - c);
  }
  const shift = (a, s) => a.map((d) => ({ ...d, open: +(d.open + s).toFixed(2), high: +(d.high + s).toFixed(2), low: +(d.low + s).toFixed(2), close: +(d.close + s).toFixed(2) }));

  function aggregate(data, minutes) {
    if (minutes === 5) return data;
    const out = [], span = minutes * 60;
    for (const d of data) {
      const day = d.time - (d.time % DAY);
      const bucket = day + OPEN + Math.floor((d.time - day - OPEN) / span) * span;
      const last = out[out.length - 1];
      if (last && last.time === bucket) { last.high = Math.max(last.high, d.high); last.low = Math.min(last.low, d.low); last.close = d.close; last.volume += d.volume; }
      else out.push({ ...d, time: bucket });
    }
    return out;
  }
  const heikin = (data) => { const out = []; data.forEach((d, i) => { const c = (d.open + d.high + d.low + d.close) / 4; const o = i ? (out[i - 1].open + out[i - 1].close) / 2 : (d.open + d.close) / 2; out.push({ time: d.time, open: o, close: c, high: Math.max(d.high, o, c), low: Math.min(d.low, o, c) }); }); return out; };

  // ---------- indicators ----------
  const ema = (d, p, src = (x) => x.close) => { const k = 2 / (p + 1); let e = src(d[0]); return d.map((x) => ({ time: x.time, value: (e = src(x) * k + e * (1 - k)) })); };
  const sma = (d, p) => d.map((x, i) => i < p - 1 ? { time: x.time } : { time: x.time, value: d.slice(i - p + 1, i + 1).reduce((a, y) => a + y.close, 0) / p });
  const rsi = (d, p = 14) => { let g = 0, l = 0; return d.map((x, i) => { if (!i) return { time: x.time }; const ch = x.close - d[i - 1].close; g = (g * (p - 1) + Math.max(ch, 0)) / p; l = (l * (p - 1) + Math.max(-ch, 0)) / p; return i < p ? { time: x.time } : { time: x.time, value: 100 - 100 / (1 + g / (l || 1e-9)) }; }); };
  const smaOf = (pts, p) => pts.map((x, i) => { const w = pts.slice(Math.max(0, i - p + 1), i + 1).filter((y) => y.value != null); return w.length < p ? { time: x.time } : { time: x.time, value: w.reduce((a, y) => a + y.value, 0) / p }; });
  function boll(d, p = 20, m = 2) { const u = [], mid = [], lo = []; d.forEach((x, i) => { if (i < p - 1) { u.push({ time: x.time }); mid.push({ time: x.time }); lo.push({ time: x.time }); return; } const w = d.slice(i - p + 1, i + 1).map((y) => y.close); const av = w.reduce((a, b) => a + b, 0) / p; const sd = Math.sqrt(w.reduce((a, b) => a + (b - av) ** 2, 0) / p); u.push({ time: x.time, value: av + m * sd }); mid.push({ time: x.time, value: av }); lo.push({ time: x.time, value: av - m * sd }); }); return [u, mid, lo]; }
  function vwap(d) { let pv = 0, v = 0, day = -1; return d.map((x) => { const dd = x.time - (x.time % DAY); if (dd !== day) { day = dd; pv = 0; v = 0; } const tp = (x.high + x.low + x.close) / 3; pv += tp * x.volume; v += x.volume; return { time: x.time, value: pv / v }; }); }
  function supertrend(d, p = 10, m = 3) {
    let atr = 0, up = 0, dn = 0, dir = 1; const out = [];
    d.forEach((x, i) => {
      const tr = i ? Math.max(x.high - x.low, Math.abs(x.high - d[i - 1].close), Math.abs(x.low - d[i - 1].close)) : x.high - x.low;
      atr = i ? (atr * (p - 1) + tr) / p : tr;
      const hl = (x.high + x.low) / 2, bu = hl + m * atr, bl = hl - m * atr;
      up = i && d[i - 1].close <= up ? Math.min(bu, up) : bu; dn = i && d[i - 1].close >= dn ? Math.max(bl, dn) : bl;
      if (x.close > up) dir = 1; else if (x.close < dn) dir = -1;
      out.push(i < p ? { time: x.time } : { time: x.time, value: dir > 0 ? dn : up, color: dir > 0 ? UP : DOWN });
    });
    return out;
  }

  const fmt = (n, d = 2) => n == null ? '—' : n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

  // ---------- chart ----------
  const SYMBOLS = {
    NIFTY: { name: 'Nifty 50 Index', ex: 'NSE', seed: 11, close: 24872.35, vol: 9, prev: 24718.95 },
    BANKNIFTY: { name: 'Nifty Bank Index', ex: 'NSE', seed: 23, close: 53418.9, vol: 26, prev: 53531.3 },
    'NIFTY FUT': { name: 'NIFTY Oct 2026 Fut', ex: 'NFO', seed: 31, close: 24921.4, vol: 9, prev: 24760.0 },
    RELIANCE: { name: 'Reliance Industries Ltd', ex: 'NSE', seed: 47, close: 2894.6, vol: 2.2, prev: 2856.3 },
    'NIFTY 24900 STRADDLE': { name: 'ATM straddle 28 Oct', ex: 'NFO', seed: 59, close: 212.4, vol: 1.6, prev: 236.1 },
  };

  const INDICATORS = {
    'EMA 9': { pane: 'main', make: (s, d) => [s.chart.addLineSeries(line('#2962ff', 1))], data: (d) => [ema(d, 9)] },
    'EMA 21': { pane: 'main', make: (s) => [s.chart.addLineSeries(line('#ff9800', 1))], data: (d) => [ema(d, 21)] },
    'SMA 50': { pane: 'main', make: (s) => [s.chart.addLineSeries(line('#9c27b0', 1))], data: (d) => [sma(d, 50)] },
    'VWAP': { pane: 'main', make: (s) => [s.chart.addLineSeries(line('#e91e63', 2))], data: (d) => [vwap(d)] },
    'Bollinger Bands 20 2': { pane: 'main', make: (s) => [s.chart.addLineSeries(line('#2196f3', 1)), s.chart.addLineSeries(line('#ff6d00', 1)), s.chart.addLineSeries(line('#2196f3', 1))], data: (d) => boll(d) },
    'Supertrend 10 3': { pane: 'main', make: (s) => [s.chart.addLineSeries({ ...line(UP, 2) })], data: (d) => [supertrend(d)] },
  };
  const line = (color, width) => ({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  const ALL_INDICATORS = ['EMA 9', 'EMA 21', 'SMA 50', 'VWAP', 'Bollinger Bands 20 2', 'Supertrend 10 3', 'RSI 14', 'MACD 12 26 9', 'Stochastic RSI', 'ADX / DMI', 'ATR 14', 'Ichimoku Cloud', 'Parabolic SAR', 'Pivot Points Standard', 'CPR (Central Pivot Range)', 'Keltner Channels', 'Donchian Channels', 'OBV', 'MFI', 'CCI', 'Williams %R', 'Volume Profile (VRVP)', 'Anchored VWAP', 'Open Interest'];

  function baseOpts(compact) {
    return {
      autoSize: true,
      layout: { background: { type: 'solid', color: '#ffffff' }, textColor: '#131722', fontSize: compact ? 10 : 11, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', attributionLogo: false },
      grid: { vertLines: { color: '#f2f3f5' }, horzLines: { color: '#f2f3f5' } },
      crosshair: { mode: 0, vertLine: { color: '#9598a1', style: 3, labelBackgroundColor: '#131722' }, horzLine: { color: '#9598a1', style: 3, labelBackgroundColor: '#131722' } },
      rightPriceScale: { borderColor: '#e0e3eb', minimumWidth: compact ? 56 : 74 },
      timeScale: { borderColor: '#e0e3eb', timeVisible: true, rightOffset: 6, barSpacing: compact ? 4 : 6 },
    };
  }

  /**
   * Mounts a TradingView-style chart: main pane (candles, volume, session shading, watermark, legend)
   * plus an optional RSI pane. Returns a handle for switching symbol/interval/type and drawing.
   */
  function mountChart(host, opts = {}) {
    const st = { symbol: opts.symbol || 'NIFTY', tf: opts.tf || '5', type: 'candles', inds: [], tool: 'cross', pending: null, compact: !!opts.compact, onTrade: opts.onTrade };
    host.classList.add('tvc');
    host.innerHTML = `
      <div class="tvc-main"><div class="tvc-wm"><b></b><span></span></div><div class="tvc-legend"></div></div>
      ${opts.rsi === false ? '' : '<div class="tvc-rsi"><div class="tvc-legend small"></div></div>'}`;
    const mainEl = host.querySelector('.tvc-main'), rsiEl = host.querySelector('.tvc-rsi');
    st.chart = LWC.createChart(mainEl, { ...baseOpts(st.compact), timeScale: { ...baseOpts(st.compact).timeScale, visible: !rsiEl } });
    st.sep = st.chart.addHistogramSeries({ priceScaleId: 'sep', color: 'rgba(41,98,255,0.06)', lastValueVisible: false, priceLineVisible: false });
    st.chart.priceScale('sep').applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    st.vol = st.chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    st.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });

    if (rsiEl) {
      st.rchart = LWC.createChart(rsiEl, { ...baseOpts(st.compact), rightPriceScale: { ...baseOpts(st.compact).rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.08 } } });
      st.band = st.rchart.addBaselineSeries({ baseValue: { type: 'price', price: 30 }, topFillColor1: 'rgba(126,87,194,0.09)', topFillColor2: 'rgba(126,87,194,0.09)', topLineColor: 'rgba(0,0,0,0)', lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
      st.rsi = st.rchart.addLineSeries({ color: '#7e57c2', lineWidth: 1, priceLineVisible: false, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
      st.rsiMa = st.rchart.addLineSeries({ color: '#fdd835', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      [30, 50, 70].forEach((p) => st.rsi.createPriceLine({ price: p, color: '#b2b5be', lineStyle: 2, lineWidth: 1, axisLabelVisible: false }));
      let lock = false;
      const link = (a, b) => a.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (lock || !r) return; lock = true; b.timeScale().setVisibleLogicalRange(r); lock = false; });
      link(st.chart, st.rchart); link(st.rchart, st.chart);
      st.rchart.subscribeCrosshairMove((p) => synced(() => { crossMain(p.time); renderLegend(p.time); }));
    }

    st.chart.subscribeCrosshairMove((p) => synced(() => {
      crossRsi(p.time);
      renderLegend(p.time);
      opts.onCrosshair && opts.onCrosshair(p.time);
    }));
    // setCrosshairPosition re-fires crosshairMove, so guard against ping-pong between panes and charts.
    function synced(fn) { if (st.syncing) return; st.syncing = true; try { fn(); } finally { st.syncing = false; } }
    const at = (arr, t) => { const x = arr && arr.find((d) => d.time === t); return x && (x.close ?? x.value); };
    function crossMain(t) { const v = at(st.raw, t); if (t && v != null) st.chart.setCrosshairPosition(v, t, st.main); else st.chart.clearCrosshairPosition(); }
    function crossRsi(t) { if (!st.rchart) return; const v = at(st.rsiData, t); if (t && v != null) st.rchart.setCrosshairPosition(v, t, st.rsi); else st.rchart.clearCrosshairPosition(); }
    st.chart.subscribeClick(onClick);

    function setMainSeries() {
      if (st.main) st.chart.removeSeries(st.main);
      const c = { upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN };
      st.main = st.type === 'line' ? st.chart.addLineSeries({ color: '#2962ff', lineWidth: 2 })
        : st.type === 'area' ? st.chart.addAreaSeries({ lineColor: '#2962ff', topColor: 'rgba(41,98,255,0.28)', bottomColor: 'rgba(41,98,255,0.02)', lineWidth: 2 })
        : st.type === 'bars' ? st.chart.addBarSeries({ upColor: UP, downColor: DOWN })
        : st.chart.addCandlestickSeries(c);
    }

    function load() {
      const s = SYMBOLS[st.symbol];
      st.raw = st.tf === 'D' ? daily(s.seed, s.close, s.vol * 8) : aggregate(intraday(s.seed, s.close, s.vol), +st.tf);
      const shown = st.type === 'ha' ? heikin(st.raw) : st.raw;
      setMainSeries();
      st.main.setData(st.type === 'line' || st.type === 'area' ? st.raw.map((d) => ({ time: d.time, value: d.close })) : shown);
      st.vol.setData(st.raw.map((d) => ({ time: d.time, value: d.volume, color: d.close >= d.open ? 'rgba(8,153,129,0.25)' : 'rgba(242,54,69,0.25)' })));
      st.sep.setData(st.tf === 'D' ? [] : st.raw.map((d) => ({ time: d.time, value: d.time % DAY === OPEN ? 1 : 0 })));
      st.inds.forEach((ind) => ind.series.forEach((ser, i) => ser.setData(INDICATORS[ind.name].data(st.raw)[i])));
      if (st.rsi) { const r = (st.rsiData = rsi(st.raw)); st.rsi.setData(r); st.rsiMa.setData(smaOf(r, 14)); st.band.setData(st.raw.map((d) => ({ time: d.time, value: 70 }))); }
      host.querySelector('.tvc-wm b').textContent = `${st.symbol}, ${tfLabel(st.tf)}`;
      host.querySelector('.tvc-wm span').textContent = s.name;
      const n = st.raw.length, show = st.compact ? 110 : 180;
      st.chart.timeScale().setVisibleLogicalRange({ from: n - show, to: n + 6 });
      renderLegend();
      opts.onLoad && opts.onLoad(st);
    }

    function addIndicator(name) {
      if (!INDICATORS[name] || st.inds.some((i) => i.name === name)) return false;
      const series = INDICATORS[name].make(st);
      series.forEach((ser, i) => ser.setData(INDICATORS[name].data(st.raw)[i]));
      st.inds.push({ name, series });
      renderLegend();
      return true;
    }
    function removeIndicator(name) {
      const i = st.inds.findIndex((x) => x.name === name); if (i < 0) return;
      st.inds[i].series.forEach((s) => st.chart.removeSeries(s)); st.inds.splice(i, 1); renderLegend();
    }

    function renderLegend(time) {
      if (!st.raw) return; // crosshair can fire before the first load
      const s = SYMBOLS[st.symbol];
      const i = time ? st.raw.findIndex((d) => d.time === time) : st.raw.length - 1;
      const d = st.raw[i] || st.raw[st.raw.length - 1], prev = st.raw[i - 1] || d;
      const ch = d.close - prev.close, col = ch >= 0 ? UP : DOWN;
      const leg = host.querySelector('.tvc-main .tvc-legend');
      const last = st.raw[st.raw.length - 1];
      leg.innerHTML = `
        <div class="l1"><span class="logo">${st.symbol.slice(0, 2)}</span><b>${s.name} · ${tfLabel(st.tf)} · ${s.ex}</b><span class="dot" title="Delayed data">D</span>
          <span class="ohlc" style="color:${col}">O<em>${fmt(d.open)}</em> H<em>${fmt(d.high)}</em> L<em>${fmt(d.low)}</em> C<em>${fmt(d.close)}</em> ${ch >= 0 ? '+' : ''}${fmt(ch)} (${ch >= 0 ? '+' : ''}${fmt((ch / prev.close) * 100)}%)</span></div>
        ${st.compact ? '' : `<div class="l2"><button class="sell" data-side="SELL">${fmt(last.close)}<small>SELL</small></button><span class="spr">0.05</span><button class="buy" data-side="BUY">${fmt(last.close + 0.05)}<small>BUY</small></button></div>`}
        ${st.inds.map((ind) => { const vals = INDICATORS[ind.name].data(st.raw).map((a) => (a[i] || {}).value); return `<div class="l3"><span>${ind.name}</span>${vals.map((v, k) => `<em style="color:${ind.series[k].options().color}">${fmt(v)}</em>`).join(' ')}<button class="x" data-rm="${ind.name}" title="Remove">×</button></div>`; }).join('')}`;
      leg.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => removeIndicator(b.dataset.rm)));
      leg.querySelectorAll('[data-side]').forEach((b) => (b.onclick = () => st.onTrade && st.onTrade(b.dataset.side, st.symbol, last.close)));
      if (st.rsi) {
        const r = rsi(st.raw), m = smaOf(r, 14);
        host.querySelector('.tvc-rsi .tvc-legend').innerHTML = `<span>RSI 14 close</span><em style="color:#7e57c2">${fmt((r[i] || {}).value)}</em><em style="color:#c9a800">${fmt((m[i] || {}).value)}</em>`;
      }
    }

    function onClick(p) {
      if (!p.point || st.tool === 'cross') return;
      const price = st.main.coordinateToPrice(p.point.y);
      if (st.tool === 'hline') {
        st.main.createPriceLine({ price, color: '#2962ff', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: '' });
        return done();
      }
      if (st.tool === 'trend' && p.time) {
        if (!st.pending) { st.pending = { time: p.time, value: price }; return; }
        const pts = [st.pending, { time: p.time, value: price }].sort((a, b) => a.time - b.time);
        if (pts[0].time !== pts[1].time) st.chart.addLineSeries({ ...line('#2962ff', 2), crosshairMarkerVisible: false }).setData(pts);
        st.pending = null; done();
      }
    }
    function done() { st.tool = 'cross'; host.dispatchEvent(new CustomEvent('tooldone', { bubbles: true })); }

    setTimeout(load);
    return {
      state: st,
      set(k, v) { st[k] = v; if (k !== 'tool') load(); else st.pending = null; },
      addIndicator, removeIndicator,
      setCrosshair(time) { if (st.main) synced(() => { crossMain(time); crossRsi(time); }); },
    };
  }
  const tfLabel = (tf) => (tf === 'D' ? '1D' : tf === '60' ? '1h' : `${tf}`);

  // ---------- chrome ----------
  function topbar(o = {}) {
    return `<div class="tb">
      <span class="brand" title="My Trading View">M</span>
      <button class="tb-sym" data-act="search">${icon('zoom', 16)}<b data-symlabel>NIFTY</b></button>
      <button class="tb-ico" title="Compare">${icon('plusc')}</button><i class="tb-sep"></i>
      ${['5', '15', '60', 'D'].map((t) => `<button class="tb-tf${t === '5' ? ' on' : ''}" data-tf="${t}">${tfLabel(t)}</button>`).join('')}
      <i class="tb-sep"></i>
      <div class="tb-dd"><button class="tb-ico" data-act="type" title="Chart type">${icon('candles')}${icon('chev', 12)}</button>
        <div class="menu" data-menu="type">${[['candles', 'Candles'], ['ha', 'Heikin Ashi'], ['bars', 'Bars'], ['line', 'Line'], ['area', 'Area']].map(([k, n]) => `<button data-type="${k}">${n}</button>`).join('')}</div></div>
      <i class="tb-sep"></i>
      <button class="tb-btn" data-act="indicators">${icon('ind')}Indicators</button>
      <button class="tb-ico" title="Layouts">${icon('grid')}</button><i class="tb-sep"></i>
      <button class="tb-btn" data-act="alert">${icon('alert')}Alert</button>
      <button class="tb-btn">${icon('replay')}Replay</button><i class="tb-sep"></i>
      <button class="tb-ico" title="Undo">${icon('undo')}</button><button class="tb-ico" title="Redo">${icon('redo')}</button>
      <span class="tb-flex"></span>
      ${o.right || ''}
      <span class="tb-layout">${icon('paper', 16)}${o.layoutName || 'NIFTY intraday'}${icon('chev', 12)}</span>
      <button class="tb-ico" title="Settings">${icon('gear')}</button><button class="tb-ico" title="Fullscreen">${icon('full')}</button><button class="tb-ico" title="Snapshot">${icon('camera')}</button>
      <button class="tb-cta">Paper trade</button>
    </div>`;
  }
  function toolrail() {
    const t = (n, title, tool) => `<button class="tr-b${tool === 'cross' ? ' on' : ''}" ${tool ? `data-tool="${tool}"` : ''} title="${title}">${icon(n, 20)}</button>`;
    return `<div class="tr">${t('cross', 'Cross', 'cross')}${t('trend', 'Trend line (click two points)', 'trend')}${t('hline', 'Horizontal line', 'hline')}${t('fib', 'Fib retracement')}${t('pattern', 'Patterns')}${t('brush', 'Brush')}${t('text', 'Text')}${t('emoji', 'Icons')}<i></i>${t('ruler', 'Measure')}${t('zoom', 'Zoom in')}<i></i>${t('magnet', 'Magnet')}${t('lock', 'Lock drawings')}${t('eye', 'Hide drawings')}<span class="tb-flex"></span>${t('trash', 'Remove drawings')}</div>`;
  }
  function rangebar() {
    return `<div class="rb">${['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'].map((r) => `<button data-range="${r}">${r}</button>`).join('')}<i class="tb-sep"></i><button title="Go to date">${icon('cal', 16)}</button><span class="tb-flex"></span><span class="rb-mkt" data-mkt></span><span class="rb-clock" data-clock></span><span class="rb-opt">%</span><span class="rb-opt">log</span><span class="rb-opt on">auto</span></div>`;
  }
  function siderail(items, active) {
    return `<div class="sr">${items.map(([n, title, key]) => `<button class="sr-b${key === active ? ' on' : ''}" data-panel="${key || ''}" title="${title}">${icon(n, 22)}</button>`).join('')}<span class="tb-flex"></span><button class="sr-b" title="Help">${icon('help', 22)}</button></div>`;
  }

  const WATCH = [
    ['NIFTY', 'NIFTY 50', 24872.35, 153.4], ['BANKNIFTY', 'Bank Nifty', 53418.9, -112.4], ['SENSEX', 'Sensex', 81544.1, 446.2], ['FINNIFTY', 'Fin Nifty', 23912.45, 81.3], ['INDIAVIX', 'India VIX', 12.84, -0.41],
    ['RELIANCE', 'Reliance', 2894.6, 38.3], ['HDFCBANK', 'HDFC Bank', 1712.25, -8.25], ['TCS', 'TCS', 4108.0, 37.0], ['INFY', 'Infosys', 1876.4, 20.8], ['ICICIBANK', 'ICICI Bank', 1288.55, -2.2], ['SBIN', 'SBI', 842.3, 17.0], ['TATAMOTORS', 'Tata Motors', 968.75, -13.95], ['ADANIENT', 'Adani Ent', 3012.1, 92.8], ['ITC', 'ITC', 498.65, 0.6], ['LT', 'L&T', 3655.2, 41.9],
  ];
  const HUES = ['#2962ff', '#f57c00', '#00897b', '#8e24aa', '#e53935', '#3949ab', '#6d4c41', '#00acc1'];
  function watchlist() {
    const rows = (from, to) => WATCH.slice(from, to).map(([s, , p, c], i) => `<div class="wl-r${s === 'NIFTY' ? ' on' : ''}" data-sym="${s}"><span class="wl-ic" style="background:${HUES[(from + i) % HUES.length]}">${s[0]}</span><b>${s}</b><span>${fmt(p)}</span><span class="${c >= 0 ? 'u' : 'd'}">${c >= 0 ? '+' : ''}${fmt(c)}</span><span class="${c >= 0 ? 'u' : 'd'}">${c >= 0 ? '+' : ''}${fmt((c / (p - c)) * 100)}%</span></div>`).join('');
    return `<div class="wl"><div class="wl-h"><b>Watchlist ${icon('chev', 12)}</b><span class="tb-flex"></span><button class="tb-ico">${icon('plus')}</button><button class="tb-ico">${icon('list')}</button></div>
      <div class="wl-cols"><span>Symbol</span><span>Last</span><span>Chg</span><span>Chg%</span></div>
      <div class="wl-sec">INDICES</div>${rows(0, 5)}<div class="wl-sec">STOCKS</div>${rows(5, WATCH.length)}</div>
      <div class="det"><div class="det-h"><span class="wl-ic" style="background:#2962ff">N</span><div><b>NIFTY</b><small>Nifty 50 Index · NSE</small></div></div>
        <div class="det-px"><b>24,872.35</b><span class="u">+153.40 +0.62%</span></div><small class="det-st"><span data-mkt></span> · Delayed 15 min</small>
        <div class="det-range"><small>Day's range</small><div class="bar"><i style="left:12%;right:8%"></i></div><div class="lh"><span>24,688.20</span><span>24,903.70</span></div></div>
        <div class="det-kv"><span>Open</span><b>24,731.05</b><span>Prev close</span><b>24,718.95</b><span>PCR (28 Oct)</span><b>0.93</b><span>Max pain</span><b>24,850</b></div></div>`;
  }

  // Option chain (illustrative Black-Scholes prices around spot).
  const N = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
  function chainRows(spot, n = 12) {
    const r = rng(5), atm = Math.round(spot / 50) * 50, T = 2 / 365, rows = [];
    for (let k = atm - n * 50; k <= atm + n * 50; k += 50) {
      const m = (k - spot) / spot, v = 0.118 + m * m * 18, d1 = (Math.log(spot / k) + (0.065 + v * v / 2) * T) / (v * Math.sqrt(T)), d2 = d1 - v * Math.sqrt(T);
      const ce = Math.max(spot * N(d1) - k * Math.exp(-0.065 * T) * N(d2), 0.05), pe = Math.max(k * Math.exp(-0.065 * T) * N(-d2) - spot * N(-d1), 0.05);
      const dist = Math.abs(k - atm) / 50;
      rows.push({ k, atm: k === atm, iv: v * 100, ce, pe, ceOI: Math.max(4e5, (k >= atm ? 90 - dist * 5 : 38 - dist * 2.5) * 1e5 * (0.7 + r() * 0.6) + (k % 500 ? 0 : 6e6)), peOI: Math.max(4e5, (k <= atm ? 88 - dist * 5 : 36 - dist * 2.5) * 1e5 * (0.7 + r() * 0.6) + (k % 500 ? 0 : 5e6)), ceCh: (r() - 0.35) * 30, peCh: (r() - 0.4) * 30 });
    }
    return rows;
  }

  // ---------- page wiring ----------
  function wire(root, charts) {
    const active = () => charts.active || charts[0];
    root.querySelectorAll('[data-tf]').forEach((b) => (b.onclick = () => { root.querySelectorAll('[data-tf]').forEach((x) => x.classList.toggle('on', x === b)); active().set('tf', b.dataset.tf); }));
    root.querySelectorAll('[data-type]').forEach((b) => (b.onclick = () => { active().set('type', b.dataset.type); closeMenus(); }));
    root.querySelectorAll('[data-act="type"]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); b.nextElementSibling.classList.toggle('open'); }));
    document.addEventListener('click', closeMenus);
    function closeMenus() { root.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')); }
    root.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => { root.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b)); active().set('tool', b.dataset.tool); toast(b.dataset.tool === 'trend' ? 'Click two points on the chart' : b.dataset.tool === 'hline' ? 'Click a price level on the chart' : ''); }));
    root.addEventListener('tooldone', () => root.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === 'cross')));
    root.querySelectorAll('[data-tool="cross"]').forEach(() => {});
    root.querySelectorAll('.tr-b:not([data-tool])').forEach((b) => (b.onclick = () => toast(`${b.title}: available in the full app`)));
    root.querySelectorAll('[data-act="indicators"]').forEach((b) => (b.onclick = () => indicatorDialog(active())));
    root.querySelectorAll('[data-act="alert"]').forEach((b) => (b.onclick = () => toast('Alert created: NIFTY crossing 24,900.00')));
    root.querySelectorAll('[data-act="search"]').forEach((b) => (b.onclick = () => symbolDialog((s) => { active().set('symbol', s); root.querySelectorAll('[data-symlabel]').forEach((l) => (l.textContent = s)); })));
    root.querySelectorAll('.wl-r').forEach((r) => (r.onclick = () => { if (!SYMBOLS[r.dataset.sym]) return toast(`${r.dataset.sym}: chart loads from the live feed in the app`); root.querySelectorAll('.wl-r').forEach((x) => x.classList.toggle('on', x === r)); active().set('symbol', r.dataset.sym); root.querySelectorAll('[data-symlabel]').forEach((l) => (l.textContent = r.dataset.sym)); }));
    root.querySelectorAll('[data-range]').forEach((b) => (b.onclick = () => { const c = active().state, n = c.raw.length; const bars = { '1D': 75, '5D': 375 }[b.dataset.range]; if (bars && c.tf !== 'D') c.chart.timeScale().setVisibleLogicalRange({ from: n - bars / (+c.tf / 5), to: n + 4 }); else c.chart.timeScale().fitContent(); }));
    clock(root);
  }

  function clock(root) {
    const tick = () => {
      const now = new Date(Date.now() + 5.5 * 3600e3), hh = now.getUTCHours(), mm = now.getUTCMinutes(), wd = now.getUTCDay();
      const mins = hh * 60 + mm, open = wd > 0 && wd < 6 && mins >= 555 && mins < 930, pre = wd > 0 && wd < 6 && mins >= 540 && mins < 555;
      root.querySelectorAll('[data-clock]').forEach((e) => (e.textContent = now.toISOString().slice(11, 19) + ' UTC+5:30'));
      root.querySelectorAll('[data-mkt]').forEach((e) => { e.textContent = open ? 'Market open' : pre ? 'Pre-open' : 'Market closed'; e.className = (e.className.replace(/ ?mkt-\w+/g, '') + (open ? ' mkt-open' : ' mkt-closed')).trim(); });
    };
    tick(); setInterval(tick, 1000);
  }

  function dialog(html, cls = '') {
    const d = document.createElement('div'); d.className = 'dlg-wrap';
    d.innerHTML = `<div class="dlg ${cls}">${html}</div>`;
    d.onclick = (e) => { if (e.target === d) d.remove(); };
    document.body.appendChild(d);
    d.querySelector('[data-close]')?.addEventListener('click', () => d.remove());
    return d;
  }
  function indicatorDialog(ch) {
    const d = dialog(`<div class="dlg-h"><b>Indicators, metrics &amp; strategies</b><button data-close>×</button></div>
      <input class="dlg-search" placeholder="Search" autofocus>
      <div class="dlg-body"><div class="dlg-cats">${['Favourites', 'Technicals', 'Indian specials', 'Options & OI', 'Strategies', 'Community scripts'].map((c, i) => `<span class="${i === 1 ? 'on' : ''}">${c}</span>`).join('')}</div>
      <div class="dlg-list">${ALL_INDICATORS.map((n) => `<button data-ind="${n}">${n}${INDICATORS[n] ? '' : '<small>full app</small>'}</button>`).join('')}</div></div>`, 'wide');
    const list = d.querySelectorAll('[data-ind]');
    d.querySelector('.dlg-search').oninput = (e) => list.forEach((b) => (b.hidden = !b.dataset.ind.toLowerCase().includes(e.target.value.toLowerCase())));
    list.forEach((b) => (b.onclick = () => { if (INDICATORS[b.dataset.ind]) { ch.addIndicator(b.dataset.ind); d.remove(); } else toast(`${b.dataset.ind}: part of the full indicator library`); }));
  }
  function symbolDialog(pick) {
    const d = dialog(`<div class="dlg-h"><b>Symbol search</b><button data-close>×</button></div><input class="dlg-search" placeholder="Search NSE, BSE, NFO — e.g. RELIANCE, NIFTY 25000 CE" autofocus>
      <div class="dlg-tabs">${['All', 'Stocks', 'Indices', 'Futures', 'Options'].map((t, i) => `<span class="${i ? '' : 'on'}">${t}</span>`).join('')}</div>
      <div class="dlg-syms">${Object.entries(SYMBOLS).map(([k, v]) => `<button data-s="${k}"><b>${k}</b><span>${v.name}</span><em>${v.ex}</em></button>`).join('')}</div>`);
    d.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { pick(b.dataset.s); d.remove(); }));
  }
  function toast(msg) {
    if (!msg) return; let t = document.querySelector('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
  }

  window.TVK = { icon, mountChart, topbar, toolrail, rangebar, siderail, watchlist, chainRows, wire, dialog, toast, fmt, SYMBOLS };
})();
