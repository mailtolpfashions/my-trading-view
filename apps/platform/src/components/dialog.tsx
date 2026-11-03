'use client';

// The app's own confirm and prompt boxes, in place of the browser's window.confirm / window.prompt. Call
// confirmDialog(...) or promptDialog(...) from anywhere and await the answer; <DialogHost /> (in the app shell) shows
// one box at a time. Esc or a click outside cancels, Enter confirms.

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, inputCls } from './ui';

type Confirm = { kind: 'confirm'; title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type Prompt = { kind: 'prompt'; title: string; message?: string; label?: string; initial?: string; placeholder?: string; confirmLabel?: string };
type Request = (Confirm & { resolve: (ok: boolean) => void }) | (Prompt & { resolve: (value: string | null) => void });

let show: ((r: Request) => void) | null = null;
const queue: Request[] = [];

function open(r: Request) {
  if (show) show(r);
  else queue.push(r); // the host mounts with the shell; anything asked before that waits for it
}

/** Asks a yes/no question; resolves true on confirm. */
export function confirmDialog(o: Omit<Confirm, 'kind'>): Promise<boolean> {
  return new Promise((resolve) => open({ ...o, kind: 'confirm', resolve }));
}

/** Asks for a line of text; resolves the trimmed text, or null when cancelled or left empty. */
export function promptDialog(o: Omit<Prompt, 'kind'>): Promise<string | null> {
  return new Promise((resolve) => open({ ...o, kind: 'prompt', resolve }));
}

export function DialogHost() {
  const [list, setList] = useState<Request[]>([]);
  useEffect(() => {
    show = (r) => setList((l) => [...l, r]);
    if (queue.length) setList((l) => [...l, ...queue.splice(0)]);
    return () => { show = null; };
  }, []);
  const cur = list[0];
  if (!cur) return null;
  const done = (answer: boolean | string | null) => {
    if (cur.kind === 'confirm') cur.resolve(answer === true);
    else cur.resolve(typeof answer === 'string' && answer.trim() ? answer.trim() : null);
    setList((l) => l.slice(1));
  };
  return <Box key={list.length + cur.title} r={cur} done={done} />;
}

function Box({ r, done }: { r: Request; done: (answer: boolean | string | null) => void }) {
  const [text, setText] = useState(r.kind === 'prompt' ? r.initial ?? '' : '');
  const first = useRef<HTMLInputElement & HTMLButtonElement>(null);
  const cancel = () => done(r.kind === 'confirm' ? false : null);
  useEffect(() => {
    first.current?.focus();
    if (r.kind === 'prompt') first.current?.select();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one box, set up once
  const danger = r.kind === 'confirm' && r.danger;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-scrim p-4" onClick={cancel}>
      <form role={r.kind === 'confirm' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="dlg-title" aria-describedby={r.message ? 'dlg-msg' : undefined}
        className="panel w-full max-w-[420px] p-5 shadow-[var(--shadow-pop)]" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); done(r.kind === 'confirm' ? true : text); }}>
        <div className="flex gap-3">
          {danger && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-down-soft text-down" aria-hidden="true"><AlertTriangle size={18} /></span>}
          <div className="min-w-0 flex-1">
            <h2 id="dlg-title" className="text-[16px] font-semibold tracking-[-0.01em]">{r.title}</h2>
            {r.message && <p id="dlg-msg" className="mt-1 text-[14px] text-ink-2">{r.message}</p>}
          </div>
        </div>
        {r.kind === 'prompt' && (
          <label className="mt-4 grid gap-1.5">
            {r.label && <span className="text-[12.5px] text-muted">{r.label}</span>}
            <input ref={first} value={text} onChange={(e) => setText(e.target.value)} placeholder={r.placeholder} className={inputCls} />
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" onClick={cancel}>{r.kind === 'confirm' ? r.cancelLabel ?? 'Cancel' : 'Cancel'}</Button>
          <Button type="submit" variant="primary" ref={r.kind === 'confirm' ? first : undefined}
            disabled={r.kind === 'prompt' && !text.trim()}
            className={danger ? '!bg-down !text-white hover:!opacity-90' : undefined}>
            {r.confirmLabel ?? (r.kind === 'prompt' ? 'Save' : 'OK')}
          </Button>
        </div>
      </form>
    </div>
  );
}
