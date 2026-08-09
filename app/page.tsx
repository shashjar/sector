import { ScopeStage } from "@/components/shell/ScopeStage";
import { TranscriptPanel } from "@/components/shell/TranscriptPanel";
import { TunerBar } from "@/components/shell/TunerBar";
import { WeatherBar } from "@/components/shell/WeatherBar";

/**
 * Four regions, fixed to the viewport:
 *
 *   ┌──────────────────────────────────────┐
 *   │ WeatherBar                           │
 *   ├───────────────────────┬──────────────┤
 *   │ ScopeStage            │ Transcript   │
 *   ├───────────────────────┴──────────────┤
 *   │ TunerBar                             │
 *   └──────────────────────────────────────┘
 *
 * The scope is the primary surface and takes all remaining space; everything
 * else is a fixed-height or fixed-width frame around it. The page never
 * scrolls — regions scroll internally where they need to.
 */
export default function Home() {
  return (
    <div className="flex h-full flex-col">
      <WeatherBar />
      <div className="flex min-h-0 flex-1">
        <ScopeStage />
        <TranscriptPanel />
      </div>
      <TunerBar />
    </div>
  );
}
