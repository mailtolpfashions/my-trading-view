/** Brand mark: a bull's head on a saffron tile; the right horn rises higher, like a price line. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="12" fill="#f59a0b" />
      <path d="M13.5 15.5C9 15.5 6.5 13 6.8 9.5M26.5 15.5C31.5 15 34 11.5 33.2 6.5" fill="none" stroke="#2b1a00" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M12.5 14.5h15l-2.2 12.2a3.5 3.5 0 0 1-3.4 2.8h-3.8a3.5 3.5 0 0 1-3.4-2.8z" fill="#2b1a00" />
      <circle cx="16.8" cy="20" r="1.3" fill="#f59a0b" />
      <circle cx="23.2" cy="20" r="1.3" fill="#f59a0b" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[18px] font-bold tracking-[-0.03em]">Nandibull</span>
    </span>
  );
}
