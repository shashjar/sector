/**
 * Right region. Streams transmission cards for the tuned frequency — corrected
 * text, the linked aircraft, extracted instructions, and a replay control.
 * Subordinate to the scope by design: every card points back at a target.
 */
export function TranscriptPanel() {
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-4">
        <span className="label">Transmissions</span>
      </div>

      {/* Empty state: no feed tuned, so there is nothing to transcribe. */}
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-[0.9rem] text-text-dim">Nothing tuned</p>
        <p className="text-[0.82rem] leading-relaxed text-text-faint">
          Pick a frequency from an airport on the scope. Transmissions appear
          here as they happen, matched to the aircraft being addressed.
        </p>
      </div>
    </aside>
  );
}
