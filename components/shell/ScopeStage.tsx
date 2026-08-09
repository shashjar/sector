/**
 * Primary region. Hosts the chart-style scope: basemap, runway geometry, range
 * rings, live traffic, and weather dots. Currently the bare ground plane — the
 * canvas renderer lands with the scope commit.
 */
export function ScopeStage() {
  return (
    <main className="relative min-w-0 flex-1 bg-scope-void">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-[0.95rem] text-text-dim">No aircraft in view</p>
        <p className="max-w-xs text-[0.82rem] leading-relaxed text-text-faint">
          Pan or zoom the scope to an area with traffic. Coverage comes from
          community ADS-B receivers, so remote areas may be thin.
        </p>
      </div>
    </main>
  );
}
