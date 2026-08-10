import { generateObject } from "ai";
import { z } from "zod";

import { describeCandidates, validateCallsign, type CandidateSet } from "@/lib/candidates";

/**
 * Turn a raw transcript into typed transmissions, grounded in what is actually
 * on frequency.
 *
 * The model is not asked to transcribe — that already happened. It is asked to
 * *choose*: given this text and the aircraft actually in range, which one was
 * addressed and what were they told. That converts an open-vocabulary problem
 * into a closed-set one, which is the only reason callsigns come out right.
 *
 * Whatever it returns is then checked against the candidate set before it
 * reaches the client. See `validateCallsign`.
 */

/**
 * Instruction-following matters more than raw capability here: the job is to
 * pick from a supplied list and fill a schema, not to reason. Swappable by
 * environment variable through AI Gateway — the same one key reaches every
 * provider, so trying a different model costs a redeploy, not an integration.
 */
const MODEL = process.env.GROUND_MODEL ?? "anthropic/claude-haiku-4.5";

export const maxDuration = 60;

const Instruction = z.object({
  type: z
    .enum([
      "landing_clearance",
      "takeoff_clearance",
      "line_up_and_wait",
      "taxi",
      "hold_short",
      "heading",
      "altitude",
      "speed",
      "squawk",
      "frequency_change",
      "traffic_advisory",
      "readback",
      "other",
    ])
    .describe("What kind of instruction or report this is."),
  runway: z.string().nullable().describe("Runway designator, e.g. 28R. Null if none."),
  headingDeg: z.number().nullable().describe("Assigned heading in degrees magnetic."),
  altitudeFt: z.number().nullable().describe("Assigned altitude in feet."),
  speedKt: z.number().nullable().describe("Assigned speed in knots."),
  squawk: z.string().nullable().describe("Assigned transponder code, four digits 0-7."),
  frequencyMhz: z.number().nullable().describe("Frequency to contact, e.g. 121.6."),
});

const Transmission = z.object({
  speaker: z
    .enum(["controller", "aircraft", "unknown"])
    .describe("Who is talking. Controllers issue instructions; aircraft read them back."),
  callsign: z
    .string()
    .nullable()
    .describe(
      "The aircraft this transmission is to or from, written exactly as it appears in the candidate list. Null if no candidate matches.",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How confident you are in the callsign match, 0 to 1."),
  corrected: z
    .string()
    .describe("The transmission with callsigns and runways corrected to the candidates."),
  instructions: z.array(Instruction),
});

const Grounded = z.object({
  transmissions: z
    .array(Transmission)
    .describe(
      "One entry per distinct radio transmission in this clip. Usually one; a busy frequency can put several in a single clip.",
    ),
});

const SYSTEM = `You interpret air traffic control radio transmissions.

You are given a transcript produced by a speech model from a short clip of ATC
audio, plus a list of the aircraft actually in range right now. The transcript is
unreliable: the speech model routinely mangles callsigns, runway numbers, and
fix names, because they are rare proper nouns spoken quickly over a noisy AM
channel. It also sometimes invents plausible sentences from clips that contain
no speech at all.

Your job is to decide which of the listed aircraft was addressed, and what was
said, using the candidate list as ground truth.

Rules:

- The callsign you return MUST be copied exactly from the candidate list. If
  nothing in the list plausibly matches what the transcript sounds like, return
  null. A null is a correct answer. Guessing is not — a wrong callsign points
  the display at the wrong aircraft, which is worse than pointing at nothing.
- Match on how the callsign SOUNDS against the spoken forms given, not on how
  it is spelled. "united thirteen thirty four" is UAL1334. "thirty two lima" is
  N5432L. The speech model will have written it wrong; that is expected.
- If the transcript is nonsense, unrelated to aviation, or clearly hallucinated
  from silence, return an empty transmissions array.
- One clip can contain several transmissions — a clearance, its readback, and a
  call to a different aircraft. Return one entry each, in the order spoken.
- Correct runway numbers to runways that exist at this field.
- Set confidence honestly. Below 0.5 means you are guessing.`;

export async function POST(request: Request) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    return Response.json({ error: "grounding is not configured" }, { status: 503 });
  }

  let payload: { transcript?: string; candidates?: CandidateSet };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const transcript = payload.transcript?.trim();
  const candidates = payload.candidates;

  if (!transcript) {
    return Response.json({ error: "transcript is required" }, { status: 400 });
  }
  if (!candidates || !Array.isArray(candidates.callsigns)) {
    return Response.json({ error: "candidates are required" }, { status: 400 });
  }

  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: Grounded,
      system: SYSTEM,
      prompt: `${describeCandidates(candidates)}

Transcript of the clip:
"""
${transcript}
"""`,
      maxRetries: 1,
      abortSignal: request.signal,
    });

    const transmissions = object.transmissions.map((transmission) => {
      const callsign = validateCallsign(transmission.callsign, candidates);
      const rejected = transmission.callsign !== null && callsign === null;
      return {
        ...transmission,
        callsign,
        confidence: callsign === null ? 0 : transmission.confidence,
        rejectedCallsign: rejected ? transmission.callsign : null,
      };
    });

    return Response.json({ transmissions, model: MODEL });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    const message = error instanceof Error ? error.message : "grounding failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
