import { Scope } from "@/components/scope/Scope";

/**
 * Primary region. Hosts the scope: basemap, runway geometry, range rings, live
 * traffic, and weather dots.
 *
 * The stage stays a server component and owns only the frame; everything that
 * needs WebGL and a viewport lives inside {@link Scope}, which is a client
 * boundary because MapLibre reaches for `window` on import.
 */
export function ScopeStage() {
  return (
    <main className="relative min-w-0 flex-1 bg-scope-void">
      <Scope />
    </main>
  );
}
