// Small shared controls, styled from the design tokens only.

import clsx from 'clsx';

export function Card({ title, actions, children, className }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx('panel p-5', className)}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = 'quiet', className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'ghost' }) {
  return (
    <button type="button" {...p}
      className={clsx('inline-flex h-10 items-center justify-center gap-2 rounded-[12px] px-4 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-inverse text-on-inverse hover:bg-inverse-hover',
        variant === 'quiet' && 'border border-line-strong bg-panel text-ink hover:border-muted',
        variant === 'ghost' && 'text-ink-2 hover:bg-raised hover:text-ink',
        className)} />
  );
}

/** A row of mutually exclusive choices (timeframe, candle mode, view). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[12px] border border-line-strong bg-raised p-1">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} title={o.title} onClick={() => onChange(o.value)}
          className={clsx('h-8 min-w-9 rounded-[9px] px-3 text-[13px] font-semibold', o.value === value ? 'bg-panel text-ink shadow-[var(--shadow-panel)]' : 'text-ink-2 hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const inputCls = 'h-10 rounded-[12px] border border-line-strong bg-panel px-3 text-[14px] text-ink placeholder:text-muted focus:border-accent focus:outline-none';
