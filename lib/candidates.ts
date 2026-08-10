import type { Aircraft } from "./adsb";
import { runwaySpokenForms, spokenForms } from "./phonetics";

/**
 * What could plausibly be said on this frequency, right now.
 *
 * This is the whole idea of the grounding step. A transcription model asked
 * "what callsign was that?" is searching an unbounded space of letter
 * sequences, and it fails hardest on exactly that token. Handed the twenty or
 * thirty aircraft actually in the air, the same question becomes multiple
 * choice.
 *
 * The set is built fresh for every transmission because it is only true for a
 * moment — aircraft enter and leave, and a callsign that was valid two minutes
 * ago is not evidence about what was just said.
 */

export interface CallsignCandidate {
  /** Canonical identifier, as ADS-B reports it. */
  callsign: string;
  /** ICAO type code, used for the "Cessna three two lima" spoken form. */
  type: string | null;
  /** Every way a controller might say it. */
  spoken: string[];
  altitudeFt: number | null;
  onGround: boolean;
}

export interface RunwayCandidate {
  designator: string;
  spoken: string[];
  headingTrue: number;
}

export interface CandidateSet {
  /** The field being listened to, if known. */
  airport: string | null;
  /** What the controller calls themselves — "San Carlos Tower". */
  facility: string | null;
  callsigns: CallsignCandidate[];
  runways: RunwayCandidate[];
  frequencies: { role: string; mhz: number }[];
}

/**
 * Aircraft beyond this range are dropped from the set.
 *
 * A tower controller talks to aircraft in the pattern and on the field, not to
 * an airliner passing overhead at thirty thousand feet. Including the whole
 * viewport would add dozens of callsigns that cannot be the answer, and every
 * wrong candidate is a chance to match the wrong one.
 */
const CALLSIGN_RADIUS_NM = 15;

/** Above this, an aircraft is overflying rather than talking to the tower. */
const CALLSIGN_CEILING_FT = 12000;

export interface BuildCandidatesInput {
  aircraft: Aircraft[];
  /** Distance from the tuned field, keyed by aircraft id. */
  distanceNm?: Map<string, number>;
  runways?: RunwayCandidate[];
  airport?: string | null;
  facility?: string | null;
  frequencies?: { role: string; mhz: number }[];
}

export function buildCandidateSet({
  aircraft,
  distanceNm,
  runways = [],
  airport = null,
  facility = null,
  frequencies = [],
}: BuildCandidatesInput): CandidateSet {
  const callsigns = aircraft
    .filter((target) => {
      if (distanceNm) {
        const distance = distanceNm.get(target.id);
        if (distance !== undefined && distance > CALLSIGN_RADIUS_NM) return false;
      }
      // Aircraft on the ground are exactly who ground and tower are talking to.
      if (target.onGround) return true;
      return target.altitudeFt === null || target.altitudeFt <= CALLSIGN_CEILING_FT;
    })
    .map((target) => ({
      callsign: target.callsign,
      type: target.type,
      spoken: spokenForms(target.callsign, target.type),
      altitudeFt: target.altitudeFt,
      onGround: target.onGround,
    }))
    .filter((candidate) => candidate.spoken.length > 0);

  return { airport, facility, callsigns, runways, frequencies };
}

export function runwayCandidates(
  ends: { ident: string; headingTrue: number }[],
): RunwayCandidate[] {
  return ends.map((end) => ({
    designator: end.ident,
    spoken: runwaySpokenForms(end.ident),
    headingTrue: end.headingTrue,
  }));
}

/**
 * Render the set for the model.
 *
 * Both forms are given for every callsign — the written identifier it must
 * return, and the spoken forms it should match the transcript against. Asking
 * for one and showing the other is what lets the model answer with `UAL1334`
 * after hearing "united thirteen thirty four".
 */
export function describeCandidates(set: CandidateSet): string {
  const lines: string[] = [];

  if (set.facility) lines.push(`Facility: ${set.facility}`);
  if (set.airport) lines.push(`Airport: ${set.airport}`);

  if (set.runways.length > 0) {
    lines.push("", "Runways at this field:");
    for (const runway of set.runways) {
      lines.push(`  ${runway.designator} — spoken: ${runway.spoken.join(" / ")}`);
    }
  }

  if (set.frequencies.length > 0) {
    lines.push("", "Frequencies at this field:");
    for (const frequency of set.frequencies) {
      lines.push(`  ${frequency.mhz.toFixed(3)} ${frequency.role}`);
    }
  }

  lines.push("", `Aircraft currently in range (${set.callsigns.length}):`);
  if (set.callsigns.length === 0) {
    lines.push("  (none — no aircraft are being tracked near this field)");
  }
  for (const candidate of set.callsigns) {
    const position = candidate.onGround
      ? "on the ground"
      : candidate.altitudeFt !== null
        ? `${candidate.altitudeFt} ft`
        : "altitude unknown";
    const type = candidate.type ? ` ${candidate.type}` : "";
    lines.push(
      `  ${candidate.callsign}${type} (${position}) — spoken: ${candidate.spoken.join(" / ")}`,
    );
  }

  return lines.join("\n");
}

/**
 * The guard.
 *
 * A callsign the model returns is accepted only if it is one we offered.
 * Anything else — a plausible-looking invention, a misread that happens to
 * resemble a real registration, a hallucinated sentence from a clip that was
 * mostly silence — is rejected and the transmission renders as unmatched.
 *
 * Linking a controller's instruction to the wrong aircraft is worse than not
 * linking it at all: the whole point of the display is that the highlighted
 * target is the one being addressed. Matching is exact after normalisation,
 * deliberately — a fuzzy match here would reintroduce precisely the guessing
 * this layer exists to remove.
 */
export function validateCallsign(
  value: string | null | undefined,
  set: CandidateSet,
): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  const match = set.callsigns.find(
    (candidate) => candidate.callsign.trim().toUpperCase() === normalized,
  );
  return match ? match.callsign : null;
}
