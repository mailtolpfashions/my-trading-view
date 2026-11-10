'use client';

// Option strategy lab: build any of our option tests (strangles, straddles, spreads, call ratios, calendars, futures with
// options), run it on NSE's history and read the answer first, details after. Engine: packages/backtest/src/lab.ts.

import { Fragment, useEffect, useRef, useState } from 'react';
import { AreaSeries, createChart, type UTCTimestamp } from 'lightweight-charts';
import { ChevronDown, ChevronRight, Play, Plus, Save, Trash2, X } from 'lucide-react';
import { Button, Card, Segmented, inputCls } from '@/components/ui';
import { InfoTip } from '@/components/info-tip';
import { confirmDialog } from '@/components/dialog';
import { CHART_COLORS, useTheme } from '@/lib/theme';
import { fmtDate } from '@/lib/options';
import {
  BLANK_LAB, EXPIRY_WORD, KIND_WORD, LAB_TEMPLATES, NEW_LAB, inr, labApi, lakh, legWords,
  type LabAdjust, type LabLeg, type LabResponse, type LabStrategy, type LabTrade, type SavedLab,
} from '@/lib/option-lab';

const SEL = 'h-9 cursor-pointer rounded-[10px] border border-line-strong bg-panel pl-2.5 pr-7 text-[13.5px] focus:border-accent focus:outline-none';
const NUM = 'num h-9 rounded-[10px] border border-line-strong bg-panel px-2 text-[13.5px] focus:border-accent focus:outline-none';
const DRAFT = 'platform.optionLab.draft';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const REASON: Record<LabTrade['reason'], string> = { expiry: 'Expiry', 'days-left': 'Days left', booked: 'Booked', stop: 'Stop' };
const tone = (v: number | null | undefined) => (!v ? '' : v > 0 ? 'text-up' : 'text-down');
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
/** An optional number box: blank = off. */
const opt = (v: string) => (v.trim() === '' ? undefined : Number(v));

export function OptionLab() {
  const [s, setS] = useState<LabStrategy>(() => clone(NEW_LAB));
  const [savedId, setSavedId] = useState<string | undefined>();
  const [saved, setSaved] = useState<SavedLab[]>([]);
  const [res, setRes] = useState<{ r: LabResponse; ran: LabStrategy } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT) ?? 'null') as { s: LabStrategy; id?: string } | null;
      if (d?.s?.legs) { setS(d.s); setSavedId(d.id); }
    } catch { /* no draft */ }
    labApi.list().then(setSaved, () => {});
  }, []);
  useEffect(() => { try { localStorage.setItem(DRAFT, JSON.stringify({ s, id: savedId })); } catch { /* storage blocked */ } }, [s, savedId]);

  const set = (p: Partial<LabStrategy>) => setS((x) => ({ ...x, ...p }));
  const open = (x: LabStrategy, id?: string) => { setS(clone(x)); setSavedId(id); setRes(null); setError(null); };
  const template = LAB_TEMPLATES.find((t) => t.s.name === s.name);

  async function run() {
    setBusy(true); setError(null);
    try {
      const ran = clone(s);
      setRes({ r: await labApi.run(ran), ran });
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    setError(null);
    try {
      const r = await labApi.save(savedId, s);
      setSavedId(r.id); setSaved(await labApi.list());
      setNotice('Saved'); setTimeout(() => setNotice(null), 2000);
    } catch (e) { setError((e as Error).message); }
  }
  async function remove() {
    const x = saved.find((y) => y.id === savedId);
    if (!x || !(await confirmDialog({ title: `Delete "${x.name}"?`, message: 'This removes it from your saved option strategies.', confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true }))) return;
    await labApi.remove(x.id);
    setSaved(await labApi.list()); setSavedId(undefined);
  }

  const legs = s.legs;
  const setLeg = (i: number, l: LabLeg) => set({ legs: legs.map((x, k) => (k === i ? l : x)) });

  return (
    <div className="grid gap-4">
      <Card title="Start from" actions={saved.length ? (
        <select value={savedId ?? ''} onChange={(e) => { const x = saved.find((y) => y.id === e.target.value); if (x) open(x.strategy, x.id); }} aria-label="My option strategies" className={SEL}>
          <option value="">My strategies ({saved.length})…</option>
          {saved.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      ) : undefined}>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => open(BLANK_LAB)} title="Start from one leg and build your own strategy"
            className={`inline-flex h-9 items-center gap-1.5 rounded-full bg-inverse px-3.5 text-[13px] font-bold text-on-inverse hover:bg-inverse-hover ${!template && !savedId && s.name === BLANK_LAB.name ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel' : ''}`}>
            <Plus size={15} /> Build my own
          </button>
          {LAB_TEMPLATES.map((t) => (
            <button key={t.id} type="button" onClick={() => open(t.s)} title={t.about}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold ${template?.id === t.id && !savedId ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line-strong bg-panel text-ink-2 hover:border-muted hover:text-ink'}`}>
              {t.s.name}{t.tested && <span className="h-1.5 w-1.5 rounded-full bg-up" title="One of our tested rules" />}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-ink-2">{template && !savedId ? template.about : 'Your own strategy: add legs, choose when it starts and how it ends, then run it. Save it to keep it under My strategies.'}
          <InfoTip label="Templates" className="ml-1">A green dot marks a rule from our option studies: the lab gives the same trades and money as the study did (checked to the rupee). The others are starting points.</InfoTip></p>
      </Card>

      <Card>
        <div className="grid gap-4">
          <Row label="Index">
            <Segmented label="Index" value={s.underlying} onChange={(underlying) => set({ underlying })} options={[{ value: 'NIFTY', label: 'NIFTY' }, { value: 'BANKNIFTY', label: 'Bank Nifty' }]} />
          </Row>

          <Row label="Start" tip="The trade opens at that day's closing prices. One trade at a time: a start that falls inside an open trade is skipped.">
            <Schedule s={s} set={set} />
          </Row>

          <Row label="Only when" tip="IV is NIFTY's ATM implied volatility 25 to 60 days out, compared with the past year (250 trading days). High = above its middle value; top third = in the highest third.">
            <Segmented label="IV filter" value={s.iv} onChange={(iv) => set({ iv })}
              options={[{ value: 'any', label: 'Any IV' }, { value: 'high', label: 'High IV' }, { value: 'top-third', label: 'Top third' }, { value: 'low', label: 'Low IV' }]} />
          </Row>

          <Row label="Legs" tip="Delta picks the traded strike whose delta is nearest. % and points count from the index at entry. A strike must have traded that day, or the trade is skipped (see More settings).">
            <div className="grid w-full gap-2">
              {legs.map((l, i) => <LegRow key={i} i={i} leg={l} onChange={(x) => setLeg(i, x)} onRemove={legs.length > 1 ? () => set({ legs: legs.filter((_, k) => k !== i), adjust: undefined }) : undefined} />)}
              {legs.length < 6 && (
                <button type="button" onClick={() => set({ legs: [...legs, { side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'delta', delta: 0.16 }, expiry: 0 }] })}
                  className="inline-flex h-9 items-center gap-1.5 justify-self-start rounded-[10px] px-2 text-[13px] font-semibold text-ink-2 hover:bg-raised hover:text-ink"><Plus size={15} /> Add leg</button>
              )}
            </div>
          </Row>

          <Row label="Exit" tip="Checked at each day's close and done at that close. A day's close can be far past a stop: daily data cannot show what happened during the day.">
            <ExitFields s={s} set={set} />
          </Row>

          <Row label="Adjust" tip="Each adjustment happens once a trade, at the first close that reaches its level, at that close's prices.">
            <div className="grid w-full gap-2">
              {(s.adjust ?? []).map((a, k) => (
                <AdjustRow key={k} k={k} a={a} s={s} onChange={(x) => set({ adjust: s.adjust!.map((y, j) => (j === k ? x : y)) })}
                  onRemove={() => set({ adjust: s.adjust!.filter((_, j) => j !== k).map((y) => (y.after != null && y.after >= k ? { ...y, after: y.after === k ? undefined : y.after - 1 } : y)) })} />
              ))}
              <button type="button" onClick={() => set({ adjust: [...(s.adjust ?? []), { when: { leg: 0 }, dir: legs[0]?.kind === 'PE' ? 'down' : 'up', actions: [{ close: 0, lots: 1 }] }] })}
                className="inline-flex h-9 items-center gap-1.5 justify-self-start rounded-[10px] px-2 text-[13px] font-semibold text-ink-2 hover:bg-raised hover:text-ink"><Plus size={15} /> Add adjustment</button>
            </div>
          </Row>

          <div>
            <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-2 hover:text-ink">
              {more ? <ChevronDown size={15} /> : <ChevronRight size={15} />} More settings
            </button>
            {more && <MoreSettings s={s} set={set} />}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <input value={s.name} onChange={(e) => set({ name: e.target.value })} aria-label="Strategy name" className={`${inputCls} min-w-[14rem] flex-1 font-semibold sm:flex-none`} />
            <Button variant="primary" onClick={run} disabled={busy}><Play size={15} /> {busy ? 'Testing…' : 'Run test'}</Button>
            <Button onClick={save}><Save size={15} /> {savedId ? 'Save' : 'Save as mine'}</Button>
            {savedId && <Button variant="ghost" onClick={remove} title="Delete this saved strategy"><Trash2 size={15} /></Button>}
            {notice && <span className="text-[13px] font-semibold text-up">{notice}</span>}
          </div>
          {error && <p role="alert" className="rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down">{error}</p>}
        </div>
      </Card>

      <div ref={resultsRef} className="scroll-mt-4">{res && <Results res={res.r} ran={res.ran} />}</div>
    </div>
  );
}

function Row({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
      <span className="flex h-9 w-[92px] shrink-0 items-center gap-1 text-[13.5px] font-semibold text-ink">{label}{tip && <InfoTip label={label}>{tip}</InfoTip>}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[13.5px] text-ink-2">{children}</div>
    </div>
  );
}

function Schedule({ s, set }: { s: LabStrategy; set: (p: Partial<LabStrategy>) => void }) {
  const sc = s.schedule;
  const pick = (v: string) => set({ schedule:
    v === 'after-expiry' ? { every: 'after-expiry', months: 2 }
      : v === 'week' ? { every: 'week', weekday: 1, expiry: 'weekly' }
        : v === 'year' ? { every: 'year', month: 1, day: 'last-monday', expiryMonth: 12 }
          : { every: 'expiry', cycle: 'monthly', daysBefore: 45 } });
  return (
    <>
      <select value={sc.every} onChange={(e) => pick(e.target.value)} aria-label="When trades start" className={`${SEL} font-semibold`}>
        <option value="expiry">Before each expiry</option>
        <option value="after-expiry">After each monthly expiry</option>
        <option value="week">Every week</option>
        <option value="year">Once a year</option>
      </select>
      {sc.every === 'expiry' && <>
        <input type="number" min={1} max={400} value={sc.daysBefore} onChange={(e) => set({ schedule: { ...sc, daysBefore: Math.max(1, Math.floor(Number(e.target.value) || 1)) } })} aria-label="Days before expiry" className={`${NUM} w-[70px]`} />
        <span>days before each</span>
        <select value={sc.cycle} onChange={(e) => set({ schedule: { ...sc, cycle: e.target.value as 'monthly' | 'weekly' } })} aria-label="Expiry cycle" className={SEL}><option value="monthly">monthly</option><option value="weekly">weekly</option></select>
        <span>expiry</span>
      </>}
      {sc.every === 'after-expiry' && <>
        <span>on the expiry</span>
        <input type="number" min={1} max={12} value={sc.months} onChange={(e) => set({ schedule: { ...sc, months: Math.min(12, Math.max(1, Math.floor(Number(e.target.value) || 1))) } })} aria-label="Months ahead" className={`${NUM} w-[60px]`} />
        <span>month{sc.months > 1 ? 's' : ''} later</span>
      </>}
      {sc.every === 'week' && <>
        <span>on</span>
        <select value={sc.weekday} onChange={(e) => set({ schedule: { ...sc, weekday: Number(e.target.value) as 1 } })} aria-label="Weekday" className={SEL}>{WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}</select>
        <span>using the next</span>
        <select value={sc.expiry} onChange={(e) => set({ schedule: { ...sc, expiry: e.target.value as 'weekly' | 'monthly' } })} aria-label="Expiry" className={SEL}><option value="weekly">weekly</option><option value="monthly">monthly</option></select>
        <span>expiry</span>
      </>}
      {sc.every === 'year' && <>
        <span>on the</span>
        <select value={sc.day} onChange={(e) => set({ schedule: { ...sc, day: e.target.value as 'last-monday' | 'first-day' } })} aria-label="Day" className={SEL}><option value="last-monday">last Monday</option><option value="first-day">first trading day</option></select>
        <span>of</span>
        <select value={sc.month} onChange={(e) => set({ schedule: { ...sc, month: Number(e.target.value) } })} aria-label="Entry month" className={SEL}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        <span>, using the</span>
        <select value={sc.expiryMonth} onChange={(e) => set({ schedule: { ...sc, expiryMonth: Number(e.target.value) } })} aria-label="Expiry month" className={SEL}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        <span>expiry</span>
      </>}
    </>
  );
}

const STRIKE_DEFAULT = (by: string, kind: LabLeg['kind']): LabLeg['strike'] => {
  const down = kind === 'PE' ? -1 : 1;
  switch (by) {
    case 'forward': return { by: 'forward' };
    case 'delta': return { by: 'delta', delta: 0.16 };
    case 'pct': return { by: 'pct', pct: 5 * down };
    case 'points': return { by: 'points', points: 500 * down };
    case 'premium': return { by: 'premium', rupees: 50 };
    default: return { by: 'atm' };
  }
};

function LegRow({ i, leg, onChange, onRemove }: { i: number; leg: LabLeg; onChange: (l: LabLeg) => void; onRemove?: () => void }) {
  const st = leg.strike;
  const value = st.by === 'delta' ? st.delta : st.by === 'pct' ? st.pct : st.by === 'points' ? st.points : st.by === 'premium' ? st.rupees : null;
  const setValue = (n: number) => onChange({ ...leg, strike: st.by === 'delta' ? { by: 'delta', delta: n } : st.by === 'pct' ? { by: 'pct', pct: n } : st.by === 'points' ? { by: 'points', points: n } : { by: 'premium', rupees: n } });
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-panel p-2">
      <span className="num w-5 shrink-0 text-center text-[12.5px] font-bold text-muted">{i + 1}</span>
      <Segmented label="Buy or sell" value={leg.side} onChange={(side) => onChange({ ...leg, side })} options={[{ value: 'SELL', label: 'Sell' }, { value: 'BUY', label: 'Buy' }]} />
      <input type="number" min={1} max={50} value={leg.lots} onChange={(e) => onChange({ ...leg, lots: Math.min(50, Math.max(1, Math.floor(Number(e.target.value) || 1))) })} aria-label="Lots" className={`${NUM} w-[58px]`} />
      <span>lot{leg.lots > 1 ? 's' : ''} of</span>
      <select value={leg.kind} onChange={(e) => { const kind = e.target.value as LabLeg['kind']; onChange({ ...leg, kind, strike: kind === 'FUT' ? { by: 'atm' } : leg.kind === 'FUT' ? STRIKE_DEFAULT('delta', kind) : leg.strike }); }} aria-label="Call, put or future" className={`${SEL} font-semibold`}>
        <option value="CE">Call</option><option value="PE">Put</option><option value="FUT">Future</option>
      </select>
      {leg.kind !== 'FUT' && <>
        <span>at</span>
        <select value={st.by} onChange={(e) => onChange({ ...leg, strike: STRIKE_DEFAULT(e.target.value, leg.kind) })} aria-label="How the strike is chosen" className={SEL}>
          <option value="atm">ATM</option><option value="forward">ATM at the forward</option><option value="delta">delta</option>
          <option value="pct">% from the index</option><option value="points">points from the index</option><option value="premium">premium ₹</option>
        </select>
        {value != null && (
          <input type="number" value={value} aria-label="Strike value" onChange={(e) => setValue(Number(e.target.value))}
            step={st.by === 'delta' ? 0.01 : st.by === 'pct' ? 0.5 : st.by === 'points' ? 50 : 5} className={`${NUM} w-[80px]`} />
        )}
      </>}
      <select value={leg.expiry} onChange={(e) => onChange({ ...leg, expiry: Number(e.target.value) as LabLeg['expiry'] })} aria-label="Expiry" className={SEL}
        title={leg.kind === 'FUT' ? 'Futures use the monthly contract: this expiry means the monthly on or after the trade\'s expiry' : undefined}>
        {EXPIRY_WORD.map((w, k) => <option key={w} value={k}>{w}</option>)}
      </select>
      {onRemove && <button type="button" onClick={onRemove} aria-label="Remove this leg" className="ml-auto grid h-9 w-9 place-items-center rounded-[8px] text-ink-2 hover:bg-down-soft hover:text-down"><X size={16} /></button>}
    </div>
  );
}

function ExitFields({ s, set }: { s: LabStrategy; set: (p: Partial<LabStrategy>) => void }) {
  const e = s.exit;
  const setExit = (p: Partial<LabStrategy['exit']>) => set({ exit: { ...e, ...p } });
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select value={e.daysLeft != null ? 'days' : 'expiry'} onChange={(x) => setExit({ daysLeft: x.target.value === 'days' ? 21 : undefined })} aria-label="When to close" className={`${SEL} font-semibold`}>
          <option value="expiry">Hold to expiry</option><option value="days">Close with days left</option>
        </select>
        {e.daysLeft != null && <><input type="number" min={1} value={e.daysLeft} onChange={(x) => setExit({ daysLeft: Math.max(1, Math.floor(Number(x.target.value) || 1)) })} aria-label="Days left" className={`${NUM} w-[64px]`} /><span>calendar days left</span></>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>Book profit at</span>
        <input type="number" min={1} placeholder="off" value={e.bookPct ?? ''} onChange={(x) => setExit({ bookPct: opt(x.target.value) })} aria-label="Book profit at % of the credit" className={`${NUM} w-[64px]`} />
        <span>% of the credit · stop at a loss of ₹</span>
        <input type="number" min={1} placeholder="off" value={e.stopRupees ?? ''} onChange={(x) => setExit({ stopRupees: opt(x.target.value) })} aria-label="Stop at a loss of rupees" className={`${NUM} w-[90px]`} />
        <span>or</span>
        <input type="number" min={0.1} step={0.5} placeholder="off" value={e.stopCredit ?? ''} onChange={(x) => setExit({ stopCredit: opt(x.target.value) })} aria-label="Stop at a loss of this many times the credit" className={`${NUM} w-[64px]`} />
        <span>× the credit</span>
      </div>
    </div>
  );
}

/** Every leg an adjustment can point at: the starting legs, then legs added by earlier adjustments, in order. */
function legChoices(s: LabStrategy, upTo: number): { i: number; name: string; kind: LabLeg['kind'] }[] {
  const out = s.legs.map((l, i) => ({ i, name: `Leg ${i + 1}: ${legWords(l)}`, kind: l.kind }));
  (s.adjust ?? []).slice(0, upTo).forEach((a, k) => a.actions.forEach((act) => { if ('add' in act) out.push({ i: out.length, name: `Added in #${k + 1}: ${legWords(act.add)}`, kind: act.add.kind }); }));
  return out;
}

function AdjustRow({ k, a, s, onChange, onRemove }: { k: number; a: LabAdjust; s: LabStrategy; onChange: (a: LabAdjust) => void; onRemove: () => void }) {
  const choices = legChoices(s, k);
  const whenValue = 'leg' in a.when ? `leg:${a.when.leg}` : 'pct';
  const setAct = (j: number, act: LabAdjust['actions'][number]) => onChange({ ...a, actions: a.actions.map((x, i) => (i === j ? act : x)) });
  const idx = s.underlying === 'NIFTY' ? 'NIFTY' : 'Bank Nifty';
  return (
    <div className="grid gap-2 rounded-[12px] border border-line bg-panel p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="num w-6 shrink-0 text-[12.5px] font-bold text-muted">#{k + 1}</span>
        <span>When {idx} closes</span>
        <select value={a.dir} onChange={(e) => onChange({ ...a, dir: e.target.value as 'up' | 'down' })} aria-label="Direction" className={SEL}><option value="up">at or above</option><option value="down">at or below</option></select>
        <select value={whenValue} onChange={(e) => onChange({ ...a, when: e.target.value === 'pct' ? { pct: a.dir === 'down' ? -5 : 5 } : { leg: Number(e.target.value.slice(4)) } })} aria-label="Level" className={`${SEL} max-w-[16rem]`}>
          {choices.filter((c) => c.kind !== 'FUT').map((c) => <option key={c.i} value={`leg:${c.i}`}>{c.name.split(':')[0]}&apos;s strike</option>)}
          <option value="pct">a % from entry</option>
        </select>
        {'pct' in a.when && <><input type="number" step={0.5} value={a.when.pct} onChange={(e) => onChange({ ...a, when: { pct: Number(e.target.value) } })} aria-label="% from entry" className={`${NUM} w-[70px]`} /><span>%</span></>}
        {k > 0 && (
          <select value={a.after ?? ''} onChange={(e) => onChange({ ...a, after: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label="Only after another adjustment" className={SEL}>
            <option value="">any time</option>
            {Array.from({ length: k }, (_, j) => <option key={j} value={j}>only after #{j + 1}</option>)}
          </select>
        )}
        <button type="button" onClick={onRemove} aria-label="Remove this adjustment" className="ml-auto grid h-9 w-9 place-items-center rounded-[8px] text-ink-2 hover:bg-down-soft hover:text-down"><X size={16} /></button>
      </div>
      {a.actions.map((act, j) => (
        <div key={j} className="flex flex-wrap items-center gap-2 pl-8">
          <span className="w-9 text-muted">{j ? 'and' : 'then'}</span>
          <select value={'close' in act ? 'close' : 'add'} aria-label="Action" className={`${SEL} font-semibold`}
            onChange={(e) => setAct(j, e.target.value === 'close' ? { close: 0, lots: 1 } : { add: { side: 'BUY', kind: 'CE', lots: 1, strike: { by: 'pct', pct: 4 }, expiry: 0 } })}>
            <option value="close">close</option><option value="add">open a new leg</option>
          </select>
          {'close' in act ? <>
            <input type="number" min={1} value={act.lots} onChange={(e) => setAct(j, { ...act, lots: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} aria-label="Lots to close" className={`${NUM} w-[58px]`} />
            <span>lot{act.lots > 1 ? 's' : ''} of</span>
            <select value={act.close} onChange={(e) => setAct(j, { ...act, close: Number(e.target.value) })} aria-label="Which leg" className={`${SEL} max-w-[20rem]`}>
              {choices.map((c) => <option key={c.i} value={c.i}>{c.name}</option>)}
            </select>
          </> : <>
            <Segmented label="Buy or sell" value={act.add.side} onChange={(side) => setAct(j, { add: { ...act.add, side } })} options={[{ value: 'BUY', label: 'Buy' }, { value: 'SELL', label: 'Sell' }]} />
            <input type="number" min={1} value={act.add.lots} onChange={(e) => setAct(j, { add: { ...act.add, lots: Math.max(1, Math.floor(Number(e.target.value) || 1)) } })} aria-label="Lots" className={`${NUM} w-[58px]`} />
            <select value={act.add.kind} onChange={(e) => setAct(j, { add: { ...act.add, kind: e.target.value as 'CE' | 'PE' } })} aria-label="Call or put" className={SEL}><option value="CE">Call</option><option value="PE">Put</option></select>
            <span>at</span>
            <input type="number" step={0.5} value={act.add.strike.by === 'pct' ? act.add.strike.pct : 0} onChange={(e) => setAct(j, { add: { ...act.add, strike: { by: 'pct', pct: Number(e.target.value) } } })} aria-label="% from the entry index" className={`${NUM} w-[70px]`} />
            <span>% from entry</span>
          </>}
          {a.actions.length > 1 && <button type="button" onClick={() => onChange({ ...a, actions: a.actions.filter((_, i) => i !== j) })} aria-label="Remove this action" className="grid h-8 w-8 place-items-center rounded-[8px] text-muted hover:text-down"><X size={14} /></button>}
        </div>
      ))}
      {a.actions.length < 4 && (
        <button type="button" onClick={() => onChange({ ...a, actions: [...a.actions, { close: 0, lots: 1 }] })} className="ml-8 inline-flex h-8 items-center gap-1 justify-self-start rounded-[8px] px-2 text-[12.5px] font-semibold text-ink-2 hover:bg-raised hover:text-ink"><Plus size={14} /> and also</button>
      )}
    </div>
  );
}

function MoreSettings({ s, set }: { s: LabStrategy; set: (p: Partial<LabStrategy>) => void }) {
  return (
    <div className="mt-3 grid gap-3 rounded-[12px] bg-raised p-3 text-[13.5px] text-ink-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-[160px] font-semibold text-ink">Test from</span>
        <input type="date" value={s.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} aria-label="From" className={`${NUM} w-[150px]`} />
        <span>to</span>
        <input type="date" value={s.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} aria-label="To" className={`${NUM} w-[150px]`} />
        <span className="text-muted">blank = all history (NIFTY options from 2011)</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-[160px] font-semibold text-ink">Slippage per option</span>
        <span>₹</span><input type="number" min={0} max={50} step={0.5} value={s.slippage} onChange={(e) => set({ slippage: Math.max(0, Number(e.target.value) || 0) })} aria-label="Slippage in rupees" className={`${NUM} w-[64px]`} />
        <span className="text-muted">against you on every buy and sell</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-[160px] font-semibold text-ink">Money shown</span>
        <Segmented label="Money shown" value={s.money} onChange={(money) => set({ money })} options={[{ value: 'today', label: 'At today\'s size' }, { value: 'actual', label: 'As it was' }]} />
        <InfoTip label="Money shown">At today&apos;s size: every trade is scaled to today&apos;s index level and lot size, so a 2012 trade weighs the same as a 2026 one (the studies&apos; way). As it was: the rupees of the day, with that day&apos;s lot size.</InfoTip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-[160px] font-semibold text-ink">Strike did not trade</span>
        <Segmented label="Strike did not trade" value={s.missing} onChange={(missing) => set({ missing })} options={[{ value: 'skip', label: 'Skip the trade' }, { value: 'settlement', label: 'Use NSE settlement price' }]} />
        <InfoTip label="Settlement price">Far strikes and far months often have no trades. NSE&apos;s settlement price for them is a model value, kept between intrinsic value and the cheapest traded richer option. Trades that use one are counted in the results.</InfoTip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-[160px] font-semibold text-ink">% and points count from</span>
        <Segmented label="Distances count from" value={s.distanceFrom ?? 'index'} onChange={(distanceFrom) => set({ distanceFrom })} options={[{ value: 'index', label: 'The index' }, { value: 'atm', label: 'The ATM strike' }]} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- results

function Results({ res, ran }: { res: LabResponse; ran: LabStrategy }) {
  const { result: r, preview, margin } = res;
  const m = r.summary;
  const [showTrades, setShowTrades] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  if (!m.trades) {
    return <Card><p className="text-[14px] text-ink-2">No trades: the rule never found a day it could enter. {r.skipped.length ? `${r.skipped.length} entries were skipped, mostly: ${topReasons(r.skipped)[0]?.[0]}.` : ''}</p></Card>;
  }
  const onMargin = margin ? (m.perYear / margin.rupees) * 100 : null;
  const reasons = topReasons(r.skipped);
  return (
    <div className="grid gap-4">
      <Card>
        <p className={`text-[22px] font-semibold tracking-[-0.02em] ${tone(m.perYear)}`}>{inr(m.perYear)} a year</p>
        <p className="mt-1 text-[15px] text-ink">
          Won {m.won} of {m.trades} ({Math.round(m.winRatePct ?? 0)}%) · worst trade <span className="text-down">{inr(m.worst)}</span> · {m.losingYears} losing year{m.losingYears === 1 ? '' : 's'} of {m.byYear.length}
        </p>
        <p className="mt-1 text-[13px] text-ink-2">
          {fmtDate(r.from)} → {fmtDate(r.to)} ({m.years} years) · after every charge and ₹{ran.slippage} slippage per option · {ran.money === 'today' ? `money at today's size (index ${r.today.spot.toLocaleString('en-IN')}, lot ${r.today.lot})` : 'money as it was'}
          <InfoTip label="How it was tested" className="ml-1">
            <p>NSE&apos;s official end-of-day option prices. Each trade opens and closes at a day&apos;s closing prices; impossible (stale) closes are set aside. Expiry settles at intrinsic value against the index close.</p>
            <p>Profit a year = the total divided by the years tested. Past results do not promise future ones.</p>
          </InfoTip>
        </p>
        {margin && (
          <p className="mt-3 rounded-[12px] bg-raised px-3 py-2 text-[13.5px] text-ink-2">
            Margin for this position today: about <b className="text-ink">{lakh(margin.rupees)}</b> (NSE SPAN, {fmtDate(margin.tradeDate)}). That is <b className={tone(onMargin)}>{onMargin!.toFixed(1)}% a year</b> on the margin.
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Total" value={inr(m.total)} cls={tone(m.total)} />
          <Stat label="Average win" value={inr(m.avgWin)} cls="text-up" />
          <Stat label="Average loss" value={inr(m.avgLoss)} cls="text-down" />
          <Stat label="Worst point while open" value={inr(m.worstMtm)} cls="text-down" tip="The lowest a trade stood at any close before it ended: what you would have had to sit through." />
        </div>
      </Card>

      <Card title="Year by year">
        <table className="num w-full text-[13.5px]">
          <thead><tr className="text-left text-[12px] text-muted"><th className="py-1 font-semibold">Year</th><th className="text-right font-semibold">Trades</th><th className="text-right font-semibold">Won</th><th className="text-right font-semibold">Money</th><th className="text-right font-semibold">Worst trade</th></tr></thead>
          <tbody>
            {m.byYear.map((y) => (
              <tr key={y.year} className="border-t border-line">
                <td className="py-1.5 font-semibold">{y.year}</td>
                <td className="text-right">{y.trades}</td>
                <td className="text-right">{y.won}</td>
                <td className={`text-right font-semibold ${tone(y.net)}`}>{inr(y.net)}</td>
                <td className={`text-right ${tone(y.worst)}`}>{y.worst < 0 ? inr(y.worst) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <EquityChart trades={r.trades} />
      </Card>

      <Card title="Today it would be">
        {typeof preview === 'string'
          ? <p className="text-[13.5px] text-ink-2">Could not build today&apos;s position: {preview}.</p>
          : (
            <div className="grid gap-1 text-[13.5px]">
              <p className="text-ink-2">At the {fmtDate(preview.date)} close (index {preview.spot.toLocaleString('en-IN')}), on the {fmtDate(preview.expiry)} expiry:</p>
              {preview.legs.map((l, i) => (
                <p key={i} className="num"><span className={`font-semibold ${l.side === 'BUY' ? 'text-up' : 'text-down'}`}>{l.side === 'BUY' ? 'Buy' : 'Sell'}</span> {l.lots} lot{l.lots > 1 ? 's' : ''} {l.kind === 'FUT' ? `future (${fmtDate(l.expiry)})` : `${l.strike.toLocaleString('en-IN')} ${KIND_WORD[l.kind].toLowerCase()} (${fmtDate(l.expiry)})`} at ₹{l.price.toFixed(2)}{l.model ? ' (settlement price)' : ''}</p>
              ))}
              <p className="mt-1 text-[12.5px] text-muted">For reading only: nothing is placed.</p>
            </div>
          )}
      </Card>

      <Card title={`Trades (${r.trades.length})`} actions={<Button variant="ghost" onClick={() => setShowTrades((x) => !x)}>{showTrades ? 'Hide' : 'Show all'}</Button>}>
        {(m.modelPriced > 0 || reasons.length > 0) && (
          <div className="grid gap-1 text-[13px] text-ink-2">
            {m.modelPriced > 0 && <p>{m.modelPriced} trade{m.modelPriced > 1 ? 's' : ''} used an NSE settlement price for a strike that did not trade.</p>}
            {reasons.length > 0 && <p>Skipped starts: {reasons.map(([why, n]) => `${why} (${n})`).join(' · ')}.</p>}
          </div>
        )}
        {showTrades && (
          <div className="mt-3 max-h-[70dvh] overflow-auto">
            <table className="num w-full text-[13px]">
              <thead className="sticky top-0 bg-panel"><tr className="text-left text-[12px] text-muted">
                <th className="py-1 font-semibold" /><th className="font-semibold">Entry</th><th className="font-semibold">Exit</th><th className="hidden font-semibold sm:table-cell">Why</th>
                <th className="hidden text-right font-semibold md:table-cell">Index</th><th className="text-right font-semibold">Money</th><th className="hidden text-right font-semibold sm:table-cell">Worst while open</th>
              </tr></thead>
              <tbody>
                {[...r.trades].reverse().map((t, i) => (
                  <Fragment key={t.entry}>
                    <tr className="cursor-pointer border-t border-line hover:bg-raised" onClick={() => setOpen(open === i ? null : i)}>
                      <td className="py-1.5 text-muted">{open === i ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td className="whitespace-nowrap">{fmtDate(t.entry)}</td>
                      <td className="whitespace-nowrap">{fmtDate(t.exit)}</td>
                      <td className="hidden font-sans sm:table-cell">{REASON[t.reason]}{t.events.length ? ` · ${t.events.length} adj.` : ''}</td>
                      <td className="hidden text-right md:table-cell">{Math.round(t.spotIn).toLocaleString('en-IN')} → {Math.round(t.spotOut).toLocaleString('en-IN')}</td>
                      <td className={`text-right font-semibold ${tone(t.net)}`}>{inr(t.net)}</td>
                      <td className="hidden text-right text-down sm:table-cell">{t.worstMtm < 0 ? inr(t.worstMtm) : '–'}</td>
                    </tr>
                    {open === i && (
                      <tr className="bg-raised"><td />
                        <td colSpan={6} className="py-2 text-[12.5px] text-ink-2">
                          {t.legs.map((l, j) => (
                            <p key={j}><span className={l.side === 'BUY' ? 'text-up' : 'text-down'}>{l.side === 'BUY' ? 'Buy' : 'Sell'}</span> {l.lots} {l.kind === 'FUT' ? 'future' : `${l.strike} ${l.kind}`} ({fmtDate(l.expiry)}): ₹{l.entry.toFixed(2)} → ₹{l.exit.toFixed(2)}{l.added ? ` · added ${fmtDate(l.added)}` : ''}{l.closed ? ` · closed ${fmtDate(l.closed)}` : ''}{l.model ? ' · settlement price' : ''}</p>
                          ))}
                          {t.events.map((ev, j) => <p key={`e${j}`} className="text-ink">{fmtDate(ev.date)}: {ev.text}</p>)}
                          <p className="mt-1 text-muted">Credit {inr(t.credit)} · charges {inr(t.charges)}{t.ivRank != null ? ` · IV rank ${Math.round(t.ivRank * 100)}%` : ''}</p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, cls = '', tip }: { label: string; value: string; cls?: string; tip?: string }) {
  return (
    <div className="min-w-0 rounded-[12px] bg-raised px-3 py-2">
      <p className="flex items-center gap-1 truncate text-[12px] font-semibold text-muted">{label}{tip && <InfoTip label={label}>{tip}</InfoTip>}</p>
      <p className={`num truncate text-[16px] font-semibold ${cls}`}>{value}</p>
    </div>
  );
}

const topReasons = (skipped: { reason: string }[]) => {
  const c = new Map<string, number>();
  for (const x of skipped) c.set(x.reason, (c.get(x.reason) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
};

function EquityChart({ trades }: { trades: LabTrade[] }) {
  const el = useRef<HTMLDivElement>(null);
  const C = CHART_COLORS[useTheme()];
  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: C.bg }, textColor: C.text, fontSize: 11 },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.line }, timeScale: { borderColor: C.line },
      localization: { priceFormatter: (v: number) => inr(v) },
    });
    const area = chart.addSeries(AreaSeries, { lineColor: C.ink, topColor: 'rgba(245,154,11,0.30)', bottomColor: 'rgba(245,154,11,0.02)', lineWidth: 2, priceLineVisible: false });
    const byDay = new Map<string, number>();
    let sum = 0;
    for (const t of [...trades].sort((a, b) => a.exit.localeCompare(b.exit))) { sum += t.net; byDay.set(t.exit, sum); }
    area.setData([...byDay].map(([d, v]) => ({ time: (Date.parse(`${d}T00:00:00Z`) / 1000) as UTCTimestamp, value: v })));
    area.createPriceLine({ price: 0, color: C.zero, lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: '' });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [trades, C]);
  return (
    <div className="mt-4">
      <p className="mb-1 text-[12px] font-semibold text-muted">Money added up, trade by trade</p>
      <div ref={el} className="h-[200px] overflow-hidden rounded-[12px] border border-line" />
    </div>
  );
}
