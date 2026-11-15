# Accuracy check, part 2: recompute every indicator from TradingView's published Pine reference formulas, in plain
# Python written separately from packages/indicators, and compare bar by bar with indicator-export.json.
# Recursive indicators (EMA, RMA-based) depend on their seed; after a warm-up of 300 bars any seed difference is gone,
# so mismatches are counted only after bar 300. Tolerance: 1e-6 relative (float rounding only).
# Run: python -I scripts/research/indicator-ref.py .data/research/indicator-export.json
import json, math, sys

NA = None
def nz(x): return x is not None

def sma(v, n):
    out = [NA] * len(v)
    for i in range(n - 1, len(v)):
        w = v[i - n + 1:i + 1]
        if all(nz(x) for x in w): out[i] = sum(w) / n
    return out

def seeded(v, n, alpha):  # Pine ta.ema / ta.rma: SMA seed on the first full window, then alpha smoothing
    out = [NA] * len(v); prev = NA; start = next((i for i, x in enumerate(v) if nz(x)), None)
    if start is None: return out
    for i in range(start, len(v)):
        x = v[i]
        if x is None: return out
        if prev is None:
            if i - start + 1 >= n: prev = sum(v[i - n + 1:i + 1]) / n; out[i] = prev
        else: prev = alpha * x + (1 - alpha) * prev; out[i] = prev
    return out
ema = lambda v, n: seeded(v, n, 2 / (n + 1))
rma = lambda v, n: seeded(v, n, 1 / n)

def wma(v, n):
    d = n * (n + 1) / 2
    return [NA if i < n - 1 else sum(v[i - j] * (n - j) for j in range(n)) / d for i in range(len(v))]

def stdev(v, n):  # population, like ta.stdev
    m = sma(v, n); out = [NA] * len(v)
    for i in range(len(v)):
        if m[i] is None: continue
        out[i] = math.sqrt(sum((v[j] - m[i]) ** 2 for j in range(i - n + 1, i + 1)) / n)
    return out

def highest(v, n): return [NA if i < n - 1 else max(v[i - n + 1:i + 1]) for i in range(len(v))]
def lowest(v, n): return [NA if i < n - 1 else min(v[i - n + 1:i + 1]) for i in range(len(v))]

def rsi(c, n=14):
    up = [NA] + [max(c[i] - c[i - 1], 0) for i in range(1, len(c))]
    dn = [NA] + [max(c[i - 1] - c[i], 0) for i in range(1, len(c))]
    u, d = rma(up, n), rma(dn, n)
    return [NA if u[i] is None else (100 if d[i] == 0 else (0 if u[i] == 0 else 100 - 100 / (1 + u[i] / d[i]))) for i in range(len(c))]

def tr(H, L, C, handle_na=True):
    return [(H[0] - L[0]) if handle_na else NA] + [max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])) for i in range(1, len(C))]

def supertrend(H, L, C, n=10, f=3):  # Pine's pine_supertrend; Pine direction -1 = up, returned as +1 = up
    a = rma(tr(H, L, C), n); val = [NA] * len(C); dirn = [NA] * len(C)
    pu = pl = 0.0; pst = NA
    for i in range(len(C)):
        hl2 = (H[i] + L[i]) / 2
        if a[i] is None: pu = pl = 0.0; pst = NA; continue
        ub, lb = hl2 + f * a[i], hl2 - f * a[i]
        lb = lb if (lb > pl or C[i - 1] < pl) else pl
        ub = ub if (ub < pu or C[i - 1] > pu) else pu
        if i == 0 or a[i - 1] is None: d = 1
        elif pst == pu: d = -1 if C[i] > ub else 1
        else: d = 1 if C[i] < lb else -1
        st = lb if d == -1 else ub
        val[i], dirn[i] = st, -d
        pu, pl, pst = ub, lb, st
    return val, dirn

def dmi(H, L, C, n=14, m=14):
    up = [NA] + [H[i] - H[i - 1] for i in range(1, len(C))]
    dn = [NA] + [L[i - 1] - L[i] for i in range(1, len(C))]
    pdm = [NA] + [up[i] if (up[i] > dn[i] and up[i] > 0) else 0 for i in range(1, len(C))]
    mdm = [NA] + [dn[i] if (dn[i] > up[i] and dn[i] > 0) else 0 for i in range(1, len(C))]
    trur = rma(tr(H, L, C, False), n)
    def di(dm):
        s = rma(dm, n); out = []; last = NA
        for i in range(len(C)):
            if s[i] is not None and trur[i]: last = 100 * s[i] / trur[i]
            out.append(NA if s[i] is None else last)
        return out
    p, q = di(pdm), di(mdm)
    dx = [NA if p[i] is None or q[i] is None else abs(p[i] - q[i]) / ((p[i] + q[i]) or 1) for i in range(len(C))]
    return p, q, [NA if x is None else 100 * x for x in rma(dx, m)]

def aroon(H, L, n=14):
    up, dn = [NA] * len(H), [NA] * len(H)
    for i in range(n, len(H)):
        wh, wl = H[i - n:i + 1], L[i - n:i + 1]
        hb = max(k for k in range(n + 1) if wh[k] == max(wh)); lb = max(k for k in range(n + 1) if wl[k] == min(wl))
        up[i], dn[i] = 100 * hb / n, 100 * lb / n
    return up, dn

def psar(H, L, C, start=0.02, inc=0.02, mx=0.2):  # Pine's pine_sar
    out = [NA] * len(C); res = mm = acc = None; below = False
    for i in range(len(C)):
        first = False
        if i == 1:
            if C[1] > C[0]: below, mm, res = True, H[1], L[0]
            else: below, mm, res = False, L[1], H[0]
            first, acc = True, start
        if res is None: continue
        res = res + acc * (mm - res)
        if below:
            if res > L[i]: first, below, res, mm, acc = True, False, max(H[i], mm), L[i], start
        else:
            if res < H[i]: first, below, res, mm, acc = True, True, min(L[i], mm), H[i], start
        if not first:
            if below:
                if H[i] > mm: mm, acc = H[i], min(acc + inc, mx)
            else:
                if L[i] < mm: mm, acc = L[i], min(acc + inc, mx)
        if below:
            res = min(res, L[i - 1])
            if i > 1: res = min(res, L[i - 2])
        else:
            res = max(res, H[i - 1])
            if i > 1: res = max(res, H[i - 2])
        out[i] = res
    return out

def ref(cd):
    O = [b['open'] for b in cd]; H = [b['high'] for b in cd]; L = [b['low'] for b in cd]; C = [b['close'] for b in cd]; V = [b['volume'] for b in cd]
    n = len(C); R = {}
    R['sma20'], R['ema20'], R['wma20'], R['rsi14'] = sma(C, 20), ema(C, 20), wma(C, 20), rsi(C)
    f, s = ema(C, 12), ema(C, 26); ml = [NA if f[i] is None or s[i] is None else f[i] - s[i] for i in range(n)]
    R['macd'], R['macdSignal'] = ml, ema(ml, 9)
    b, sd = sma(C, 20), stdev(C, 20)
    R['bbUpper'] = [NA if b[i] is None else b[i] + 2 * sd[i] for i in range(n)]
    R['bbLower'] = [NA if b[i] is None else b[i] - 2 * sd[i] for i in range(n)]
    R['bbWidth'] = [NA if b[i] is None else 100 * (4 * sd[i]) / b[i] for i in range(n)]  # TradingView ta.bbw, in % of the basis
    R['percentB'] = [NA if b[i] is None or sd[i] == 0 else (C[i] - (b[i] - 2 * sd[i])) / (4 * sd[i]) for i in range(n)]
    R['atr14'] = rma(tr(H, L, C), 14)
    R['stValue'], R['stDir'] = supertrend(H, L, C)
    hh, ll = highest(H, 14), lowest(L, 14)
    k = [NA if hh[i] is None or hh[i] == ll[i] else 100 * (C[i] - ll[i]) / (hh[i] - ll[i]) for i in range(n)]
    R['stochK'], R['stochD'] = k, sma(k, 3)
    r = rsi(C); rk = [NA] * n
    for i in range(n):
        w = r[max(0, i - 13):i + 1]
        if i >= 13 and all(nz(x) for x in w) and max(w) != min(w): rk[i] = 100 * (r[i] - min(w)) / (max(w) - min(w))
    R['stochRsiK'] = sma(rk, 3); R['stochRsiD'] = sma(R['stochRsiK'], 3)
    R['willR'] = [NA if hh[i] is None or hh[i] == ll[i] else 100 * (C[i] - hh[i]) / (hh[i] - ll[i]) for i in range(n)]
    tp = [(H[i] + L[i] + C[i]) / 3 for i in range(n)]; tm = sma(tp, 20)
    R['cci20'] = [NA if tm[i] is None else (tp[i] - tm[i]) / (0.015 * (sum(abs(tp[j] - tm[i]) for j in range(i - 19, i + 1)) / 20)) for i in range(n)]
    R['roc9'] = [NA if i < 9 else 100 * (C[i] - C[i - 9]) / C[i - 9] for i in range(n)]
    pc = [NA] + [C[i] - C[i - 1] for i in range(1, n)]
    num = ema(ema(pc, 25), 13); den = ema(ema([NA if x is None else abs(x) for x in pc], 25), 13)
    R['tsi'] = [NA if num[i] is None or not den[i] else 100 * num[i] / den[i] for i in range(n)]
    R['diPlus'], R['diMinus'], R['adx'] = dmi(H, L, C)
    R['aroonUp'], R['aroonDown'] = aroon(H, L)
    R['psar'] = psar(H, L, C)
    R['ichConv'] = [NA if i < 8 else (max(H[i - 8:i + 1]) + min(L[i - 8:i + 1])) / 2 for i in range(n)]
    R['ichBase'] = [NA if i < 25 else (max(H[i - 25:i + 1]) + min(L[i - 25:i + 1])) / 2 for i in range(n)]
    a1 = tr(H, L, C); h14, l14 = highest(H, 14), lowest(L, 14)
    R['chop'] = [NA if i < 13 or h14[i] == l14[i] else 100 * math.log10(sum(a1[i - 13:i + 1]) / (h14[i] - l14[i])) / math.log10(14) for i in range(n)]
    lr = [NA] + [math.log(C[i] / C[i - 1]) for i in range(1, n)]
    R['hv10'] = [NA] * n
    for i in range(10, n):
        w = lr[i - 9:i + 1]; m = sum(w) / 10
        R['hv10'][i] = 100 * math.sqrt(sum((x - m) ** 2 for x in w) / 10) * math.sqrt(365)
    if V[0]:
        up = [NA] + [V[i] * tp[i] if tp[i] - tp[i - 1] > 0 else 0 for i in range(1, n)]
        dn = [NA] + [V[i] * tp[i] if tp[i] - tp[i - 1] < 0 else 0 for i in range(1, n)]
        R['mfi14'] = [NA] * n
        for i in range(14, n):
            u, d = sum(up[i - 13:i + 1]), sum(dn[i - 13:i + 1])
            R['mfi14'][i] = 100 if d == 0 else 100 - 100 / (1 + u / d)
        o = 0; R['obv'] = [0]
        for i in range(1, n): o += V[i] * (1 if C[i] > C[i - 1] else -1 if C[i] < C[i - 1] else 0); R['obv'].append(o)
    return R

WARM = 300
data = json.load(open(sys.argv[1]))
for name in ('nifty', 'reliance'):
    cd, mine = data[name]['candles'], data[name]['ind']
    R = ref(cd)
    print(f'\n== {name.upper()}  {len(cd)} daily bars')
    for key, theirs in R.items():
        ours = mine.get(key)
        if ours is None: print(f'  {key:11} not exported'); continue
        bad, worst, checked, nullDiff = 0, 0.0, 0, 0
        for i in range(WARM, len(cd)):
            a, b = ours[i], theirs[i]
            if (a is None) != (b is None): nullDiff += 1; continue
            if a is None: continue
            checked += 1
            rel = abs(a - b) / max(1.0, abs(b))
            worst = max(worst, rel)
            if rel > 1e-6: bad += 1
        flag = 'OK ' if bad == 0 and nullDiff == 0 else 'DIFF'
        print(f'  {flag} {key:11} bars={checked:5} mismatched={bad:4} one-side-empty={nullDiff:3} worst rel diff={worst:.2e}')
