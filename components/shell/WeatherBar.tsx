/**
 * Top region. Carries the wordmark and, once weather is wired up, the decoded
 * conditions for the field currently in focus — flight category, wind against
 * the active runway, and the current ATIS letter.
 */
export function WeatherBar() {
  return (
    <header className="flex h-11 shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
      <span className="font-mono text-[0.78rem] font-medium tracking-[0.22em] text-text">
        SECTOR
      </span>

      <div className="h-4 w-px bg-border" aria-hidden="true" />

      {/* Empty state: nothing is in focus until the scope reports a field. */}
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-[0.82rem] text-text-dim">No airport in view</span>
        <span className="truncate text-[0.82rem] text-text-faint">
          Pan the scope to a field to see its conditions
        </span>
      </div>
    </header>
  );
}
