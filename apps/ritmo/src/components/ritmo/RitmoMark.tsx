export function RitmoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ritmo-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.75" />
        </linearGradient>
        <linearGradient id="ritmo-b" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--coral)" />
          <stop offset="100%" stopColor="var(--coral)" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <path
        d="M32 8c-13.3 0-24 10.7-24 24s10.7 24 24 24c5.5 0 10-4.5 10-10s-4.5-10-10-10a4 4 0 0 1 0-8c5.5 0 10-4.5 10-10S37.5 8 32 8Z"
        fill="url(#ritmo-a)"
      />
      <path
        d="M32 56c13.3 0 24-10.7 24-24S45.3 8 32 8c-5.5 0-10 4.5-10 10s4.5 10 10 10a4 4 0 0 1 0 8c-5.5 0-10 4.5-10 10s4.5 10 10 10Z"
        fill="url(#ritmo-b)"
        opacity="0.92"
      />
    </svg>
  );
}

export function RitmoWordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <RitmoMark className="h-7 w-7" />
      <span className="font-display text-xl font-extrabold tracking-tight">Ritmo</span>
    </div>
  );
}
