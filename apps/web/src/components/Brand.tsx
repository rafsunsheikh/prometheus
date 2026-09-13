export function Flame({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="flame-grad" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fcd9a4" />
          <stop offset="0.45" stopColor="#f7b955" />
          <stop offset="1" stopColor="#d96b18" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.2c.9 3.1-.6 4.9-2.2 6.6-1.7 1.8-3.5 3.6-3.5 6.4A5.7 5.7 0 0 0 12 21.5a5.7 5.7 0 0 0 5.7-6.3c-.2-2.1-1.3-3.4-2.2-4.6-.4.9-1 1.5-1.8 1.9.5-2.3.1-4.8-1.7-6.6-.4-.4-1.3-1.3-2-3.7Z"
        fill="url(#flame-grad)"
      />
      <path
        d="M12 21.5a2.9 2.9 0 0 0 2.9-3.1c-.1-1.3-1-2.1-1.6-3-.5 1-1.2 1.4-1.9 1.8.3-1.4-.2-2.6-1-3.4-.5.9-1.4 1.7-1.9 2.7-.3.6-.4 1.2-.4 1.9A2.9 2.9 0 0 0 12 21.5Z"
        fill="#fff6e6"
        fillOpacity="0.75"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <Flame className="h-7 w-7 drop-shadow-[0_0_12px_rgba(237,143,46,0.45)]" />
      <span className="font-serif text-[1.35rem] leading-none font-semibold tracking-tight text-white">
        Prometheus
      </span>
    </span>
  );
}
