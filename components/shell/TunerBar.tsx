/**
 * Bottom region. Holds the transport for the tuned feed and persists across
 * panning, so moving the scope never drops audio.
 *
 * It also carries attribution and the operational-use disclaimer. Those live
 * here rather than in a footer on purpose: they belong next to the audio they
 * describe, and this app has no footer to bury them in.
 */
export function TunerBar() {
  return (
    <footer className="flex h-12 shrink-0 items-center justify-between gap-4 border-t border-border bg-surface px-4">
      {/* Empty state: no feed selected. */}
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-[0.82rem] text-text-dim">No frequency tuned</span>
        <span className="truncate text-[0.82rem] text-text-faint">
          Airports with a feed show a headphone badge on the scope
        </span>
      </div>

      <p className="shrink-0 text-[0.7rem] leading-tight text-text-faint">
        Training and entertainment only — not for operational use. Audio via{" "}
        <a
          href="https://www.liveatc.net"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-dim underline decoration-border underline-offset-2 hover:text-text"
        >
          LiveATC.net
        </a>
      </p>
    </footer>
  );
}
