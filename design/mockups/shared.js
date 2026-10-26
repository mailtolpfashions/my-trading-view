// Shared mockup content. Numbers are illustrative only; the real app uses live market data.
// Each mockup page supplies its own layout + CSS and calls MTV.mount(theme).
(function () {
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  // 5m bars inside NSE hours (09:15–15:30). Times are IST wall-clock encoded as UTC,
  // because lightweight-charts renders timestamps as UTC.
  function candles(endClose) {
    const sessions = [[22, 75], [23, 75], [26, 30]];
    const out = [];
    let c = 0, i = 0;
    for (const [day, bars] of sessions) {
      let t = Date.UTC(2026, 9, day, 9, 15) / 1000;
      for (let b = 0; b < bars; b++, i++, t += 300) {
        const o = c;
        const drift = Math.sin(i / 23) * 6 + (rnd() - 0.48) * 28;
        c = o + drift;
        out.push({ time: t, open: o, high: Math.max(o, c) + rnd() * 14, low: Math.min(o, c) - rnd() * 14, close: c, volume: Math.round(80000 + rnd() * 220000 + Math.abs(drift) * 6000) });
      }
    }
    const shift = endClose - c;
    return out.map((d) => ({ ...d, open: +(d.open + shift).toFixed(2), high: +(d.high + shift).toFixed(2), low: +(d.low + shift).toFixed(2), close: +(d.close + shift).toFixed(2) }));
  }

  const ema = (data, p) => {
    const k = 2 / (p + 1);
    let e = data[0].close;
    return data.map((d) => ({ time: d.time, value: +(e = d.close * k + e * (1 - k)).toFixed(2) }));
  };

  const rsi = (data, p = 14) => {
    let g = 0, l = 0;
    return data.map((d, i) => {
      if (i === 0) return { time: d.time, value: 50 };
      const ch = d.close - data[i - 1].close;
      g = (g * (p - 1) + Math.max(ch, 0)) / p;
      l = (l * (p - 1) + Math.max(-ch, 0)) / p;
      return { time: d.time, value: +(100 - 100 / (1 + g / (l || 1e-9))).toFixed(2) };
    });
  };

  const watch = [
    ['NIFTY 50', 'INDEX', 24872.35, 0.62], ['BANKNIFTY', 'INDEX', 53418.9, -0.21], ['SENSEX', 'INDEX', 81544.1, 0.55],
    ['RELIANCE', 'NSE', 2894.6, 1.34], ['HDFCBANK', 'NSE', 1712.25, -0.48], ['TCS', 'NSE', 4108.0, 0.91],
    ['INFY', 'NSE', 1876.4, 1.12], ['ICICIBANK', 'NSE', 1288.55, -0.17], ['SBIN', 'NSE', 842.3, 2.06],
    ['TATAMOTORS', 'NSE', 968.75, -1.42], ['ADANIENT', 'NSE', 3012.1, 3.18], ['ITC', 'NSE', 498.65, 0.12],
  ];

  function spark(up) {
    let y = 12, pts = [];
    for (let i = 0; i < 24; i++) { y += (rnd() - (up ? 0.58 : 0.42)) * 4; y = Math.max(2, Math.min(22, y)); pts.push(`${i * 3},${y.toFixed(1)}`); }
    return `<svg class="spark" viewBox="0 0 69 24" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }

  // Black-Scholes greeks for the illustrative chain.
  const N = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
  function bs(S, K, T, v, call) {
    const r = 0.065, d1 = (Math.log(S / K) + (r + v * v / 2) * T) / (v * Math.sqrt(T)), d2 = d1 - v * Math.sqrt(T);
    const price = call ? S * N(d1) - K * Math.exp(-r * T) * N(d2) : K * Math.exp(-r * T) * N(-d2) - S * N(-d1);
    return { price: Math.max(price, 0.05), delta: call ? N(d1) : N(d1) - 1 };
  }

  function chain(spot) {
    const atm = Math.round(spot / 50) * 50, T = 3 / 365, rows = [];
    for (let k = atm - 450; k <= atm + 450; k += 50) {
      const m = (k - spot) / spot, iv = 0.118 + m * m * 18 + (m < 0 ? -m * 0.25 : 0);
      const c = bs(spot, k, T, iv, true), p = bs(spot, k, T, iv + 0.006, false);
      const dist = Math.abs(k - atm) / 50;
      const ceOI = Math.round((k >= atm ? 95 - dist * 6 : 40 - dist * 3) * 1e5 * (0.7 + rnd() * 0.6) + (k % 500 === 0 ? 6e6 : 0));
      const peOI = Math.round((k <= atm ? 92 - dist * 6 : 38 - dist * 3) * 1e5 * (0.7 + rnd() * 0.6) + (k % 500 === 0 ? 5e6 : 0));
      rows.push({ k, atm: k === atm, iv: iv * 100, ce: { ltp: c.price, delta: c.delta, oi: Math.max(ceOI, 4e5), chg: (rnd() - 0.35) * 30 }, pe: { ltp: p.price, delta: p.delta, oi: Math.max(peOI, 4e5), chg: (rnd() - 0.4) * 30 } });
    }
    return rows;
  }

  const fmt = (n, d = 2) => n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const lakh = (n) => (n / 1e5).toFixed(1) + 'L';
  const sign = (n) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

  function mount(theme) {
    const data = candles(24872.35);
    const last = data[data.length - 1];
    document.querySelectorAll('[data-ltp]').forEach((el) => (el.textContent = fmt(last.close)));

    const el = document.getElementById('chart');
    if (el && window.LightweightCharts) {
      const base = {
        layout: { background: { type: 'solid', color: theme.bg }, textColor: theme.text, fontFamily: theme.font, fontSize: 11, attributionLogo: false },
        grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
        rightPriceScale: { borderColor: theme.grid }, timeScale: { borderColor: theme.grid, timeVisible: true },
        crosshair: { mode: 0, vertLine: { color: theme.cross, labelBackgroundColor: theme.ink }, horzLine: { color: theme.cross, labelBackgroundColor: theme.ink } },
        autoSize: true,
      };
      const chart = LightweightCharts.createChart(el, base);
      const s = chart.addCandlestickSeries({ upColor: theme.up, downColor: theme.down, borderVisible: false, wickUpColor: theme.up, wickDownColor: theme.down });
      s.setData(data);
      chart.addLineSeries({ color: theme.accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }).setData(ema(data, 20));
      chart.addLineSeries({ color: theme.muted, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }).setData(ema(data, 50));
      const v = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      v.setData(data.map((d) => ({ time: d.time, value: d.volume, color: d.close >= d.open ? theme.upSoft : theme.downSoft })));
      chart.timeScale().fitContent();

      const rEl = document.getElementById('rsi');
      if (rEl) {
        const rc = LightweightCharts.createChart(rEl, { ...base, timeScale: { visible: false }, rightPriceScale: { borderColor: theme.grid, scaleMargins: { top: 0.08, bottom: 0.08 } } });
        const rs = rc.addLineSeries({ color: theme.accent2 || theme.accent, lineWidth: 1.5, priceLineVisible: false,
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
        rs.setData(rsi(data).map((p, i) => (i < 14 ? { time: p.time } : p)));
        rs.createPriceLine({ price: 70, color: theme.muted, lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
        rs.createPriceLine({ price: 30, color: theme.muted, lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
        chart.timeScale().subscribeVisibleLogicalRangeChange((r) => r && rc.timeScale().setVisibleLogicalRange(r));
      }
    }

    const wl = document.getElementById('watchlist');
    if (wl) wl.innerHTML = watch.map(([s, ex, p, c]) => `
      <li class="wl-row ${c >= 0 ? 'up' : 'down'}${s === 'NIFTY 50' ? ' active' : ''}">
        <span class="wl-sym"><b>${s}</b><small>${ex}</small></span>
        ${spark(c >= 0)}
        <span class="wl-px"><b>${fmt(p)}</b><small>${sign(c)}</small></span>
      </li>`).join('');

    const ch = document.getElementById('chain');
    if (ch) {
      const rows = chain(last.close);
      const maxOI = Math.max(...rows.flatMap((r) => [r.ce.oi, r.pe.oi]));
      const totCE = rows.reduce((a, r) => a + r.ce.oi, 0), totPE = rows.reduce((a, r) => a + r.pe.oi, 0);
      document.querySelectorAll('[data-pcr]').forEach((e) => (e.textContent = (totPE / totCE).toFixed(2)));
      ch.innerHTML = `<thead><tr>
          <th>OI</th><th>Chg OI</th><th>Δ</th><th>LTP</th><th class="strike">Strike</th><th>IV</th><th>LTP</th><th>Δ</th><th>Chg OI</th><th>OI</th>
        </tr></thead><tbody>` + rows.map((r) => {
          const itmC = r.k < last.close, itmP = r.k > last.close;
          return `<tr class="${r.atm ? 'atm' : ''}">
            <td class="oi ce ${itmC ? 'itm' : ''}"><i style="width:calc((100% - 16px) * ${(r.ce.oi / maxOI).toFixed(3)})"></i><span>${lakh(r.ce.oi)}</span></td>
            <td class="${itmC ? 'itm' : ''} ${r.ce.chg >= 0 ? 'up' : 'down'}">${sign(r.ce.chg)}</td>
            <td class="${itmC ? 'itm' : ''} dim">${r.ce.delta.toFixed(2)}</td>
            <td class="${itmC ? 'itm' : ''} ltp">${fmt(r.ce.ltp)}</td>
            <td class="strike">${r.k}</td>
            <td class="dim">${r.iv.toFixed(1)}</td>
            <td class="${itmP ? 'itm' : ''} ltp">${fmt(r.pe.ltp)}</td>
            <td class="${itmP ? 'itm' : ''} dim">${r.pe.delta.toFixed(2)}</td>
            <td class="${itmP ? 'itm' : ''} ${r.pe.chg >= 0 ? 'up' : 'down'}">${sign(r.pe.chg)}</td>
            <td class="oi pe ${itmP ? 'itm' : ''}"><i style="width:calc((100% - 16px) * ${(r.pe.oi / maxOI).toFixed(3)})"></i><span>${lakh(r.pe.oi)}</span></td>
          </tr>`;
        }).join('') + '</tbody>';
    }

    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      document.querySelectorAll('[data-view]').forEach((v) => (v.hidden = v.dataset.view !== b.dataset.tab));
      window.dispatchEvent(new Event('resize'));
    }));
  }

  window.MTV = { mount };
})();
