/** Brand mark: an ink tile with an amber price line rising through it. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="8" fill="#121212" />
      <path d="M6 19.5l5-5.5 3.5 3 7.5-8.5" fill="none" stroke="#ffc21a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22" cy="8.5" r="1.9" fill="#ffc21a" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[16px] font-extrabold tracking-[-0.03em]">My Trading View</span>
    </span>
  );
}
