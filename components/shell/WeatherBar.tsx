"use client";

import { useNow } from "@/components/useNow";
import type { FlightCategory, Observation, RunwayWind } from "@/lib/metar";
import {
  OBSERVATION_STALE_AFTER_MS,
  type WeatherState,
} from "@/components/scope/useWeather";

/** Matches the semantic tokens in globals.css. */
const CATEGORY_CLASS: Record<FlightCategory, string> = {
  VFR: "text-vfr",
  MVFR: "text-mvfr",
  IFR: "text-ifr",
  LIFR: "text-lifr",
  UNKNOWN: "text-text-faint",
};

const CATEGORY_DOT: Record<FlightCategory, string> = {
  VFR: "bg-vfr",
  MVFR: "bg-mvfr",
  IFR: "bg-ifr",
  LIFR: "bg-lifr",
  UNKNOWN: "bg-unknown",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="label">{label}</span>
      <span className="tnum text-[0.82rem] text-text">{children}</span>
    </span>
  );
}

function wind(observation: Observation): string {
  if (observation.windSpeedKt === null) return "—";
  if (observation.windSpeedKt < 1) return "calm";
  const direction =
    observation.windDirDeg === null
      ? "variable"
      : String(Math.round(observation.windDirDeg)).padStart(3, "0");
  const gust =
    observation.windGustKt !== null ? `G${Math.round(observation.windGustKt)}` : "";
  return `${direction} @ ${Math.round(observation.windSpeedKt)}${gust}`;
}

function ceiling(observation: Observation): string {
  if (observation.ceilingFt !== null) {
    return `${observation.ceilingFt.toLocaleString()} ft`;
  }
  return observation.clouds.length === 0 ? "clear" : "no ceiling";
}

function runwayAdvice(favored: RunwayWind): string {
  const crosswind = Math.round(favored.crosswindKt);
  if (crosswind < 3) return "straight down the runway";
  if (crosswind >= 15) return `${crosswind} kt crosswind — strong`;
  return `${crosswind} kt crosswind`;
}

export function WeatherBar({ weather }: { weather: WeatherState }) {
  const { focused, focusedName, focusedRunway, status } = weather;

  return (
    <header className="flex h-11 shrink-0 items-center gap-4 overflow-x-auto border-b border-border bg-surface px-4">
      <span className="shrink-0 font-mono text-[0.78rem] font-medium tracking-[0.22em] text-text">
        SECTOR
      </span>
      <div className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />

      {focused ? (
        <Conditions
          observation={focused}
          name={focusedName}
          favored={focusedRunway}
        />
      ) : (
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[0.82rem] text-text-dim">
            {status === "unreachable"
              ? "Weather unavailable"
              : status === "loading"
                ? "Reading conditions"
                : "No reporting station in view"}
          </span>
          <span className="truncate text-[0.82rem] text-text-faint">
            {status === "unreachable"
              ? "The observation service is not responding. Retrying."
              : status === "loading"
                ? "Fetching the latest observations for this area."
                : "Not every field has a weather station. Pan toward a larger airport."}
          </span>
        </div>
      )}
    </header>
  );
}

function Conditions({
  observation,
  name,
  favored,
}: {
  observation: Observation;
  name: string | null;
  favored: RunwayWind | null;
}) {
  const now = useNow(30_000);
  const ageMs = now === 0 ? 0 : now - observation.observedAt;
  const ageMin = Math.max(0, Math.round(ageMs / 60_000));
  // METARs are hourly, so 55 minutes old is normal and not worth flagging.
  // Past 75 the station has missed a cycle, which is.
  const stale = ageMs > OBSERVATION_STALE_AFTER_MS;

  return (
    <div className="flex min-w-0 items-center gap-4">
      <span className="flex shrink-0 items-baseline gap-2">
        <span className="font-mono text-[0.82rem] text-text">{observation.icao}</span>
        <span
          className={`flex items-center gap-1.5 font-mono text-[0.72rem] tracking-[0.1em] ${CATEGORY_CLASS[observation.category]}`}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${CATEGORY_DOT[observation.category]}`}
            aria-hidden="true"
          />
          {observation.category}
        </span>
      </span>

      <Field label="Wind">{wind(observation)}</Field>
      <Field label="Vis">
        {observation.visibilitySm !== null ? `${observation.visibilitySm} SM` : "—"}
      </Field>
      <Field label="Ceil">{ceiling(observation)}</Field>

      {favored ? (
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="label">Favors</span>
          <span className="tnum text-[0.82rem] text-text">RWY {favored.ident}</span>
          <span className="text-[0.78rem] text-text-dim">{runwayAdvice(favored)}</span>
        </span>
      ) : null}

      {observation.wxString ? (
        <Field label="Wx">{observation.wxString}</Field>
      ) : null}

      {now === 0 ? null : (
        <span
          className={`shrink-0 whitespace-nowrap text-[0.75rem] ${stale ? "text-ifr" : "text-text-faint"}`}
          title={observation.raw}
        >
          {stale ? `${ageMin} min old — missed a cycle` : `${ageMin} min ago`}
        </span>
      )}

      {name ? (
        <span className="truncate text-[0.78rem] text-text-faint">{name}</span>
      ) : null}
    </div>
  );
}
