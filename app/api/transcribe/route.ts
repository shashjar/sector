import { transcribe } from "ai";

/**
 * Transcribe one transmission.
 *
 * Deliberately unassisted. The model gets the audio and nothing else — no
 * vocabulary hints, no list of callsigns, no mention that this is aviation
 * radio. Whisper and its relatives accept a prompt that biases decoding, and
 * using it here would quietly do a weak version of the grounding layer and make
 * the before-and-after meaningless.
 *
 * This is the "before". What it gets wrong — and it gets callsigns wrong
 * constantly — is the argument for everything in the next commit.
 */

/**
 * Clips are 16 kHz mono 16-bit PCM and capped at 25 seconds by the segmenter,
 * so roughly 800 KB at the limit. Anything materially larger did not come from
 * this app.
 */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Chosen by testing four models on the same five KSFO Tower transmissions,
 * because general benchmarks say nothing useful about narrowband radio full of
 * proper nouns. An environment variable so the comparison can be repeated
 * without a deploy.
 *
 *   gpt-4o-transcribe   Best. Two of five effectively perfect, including
 *                       "Tower, United 1334, ILS 28R" and "line up and wait" —
 *                       exact phraseology, and the correct spoken form of a
 *                       callsign. Truncates rather than invents.
 *   whisper-1           Close. Captured the most complete exchange of any
 *                       model, but rambles, and on quiet audio hallucinates
 *                       whole sentences that were never said.
 *   gpt-4o-mini         Disqualified. Reported "runway 33R" where the aircraft
 *                       was cleared to 28R. A fabricated runway number is the
 *                       worst error this app can make.
 *   grok-stt            Unusable here. "Sorry, 9 13 34 L S 2 8 right."
 *
 * Truncation beats invention for our purposes: a missing word is a gap the
 * grounding layer can work around, while a confident wrong runway is not.
 */
const MODEL = process.env.TRANSCRIBE_MODEL ?? "openai/gpt-4o-transcribe";

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    return Response.json(
      { error: "transcription is not configured" },
      { status: 503 },
    );
  }

  const audio = await request.arrayBuffer();

  if (audio.byteLength === 0) {
    return Response.json({ error: "empty audio" }, { status: 400 });
  }
  if (audio.byteLength > MAX_BYTES) {
    return Response.json({ error: "audio too large" }, { status: 413 });
  }

  try {
    const result = await transcribe({
      model: MODEL,
      audio: new Uint8Array(audio),
      // One retry. A transmission is worth a second attempt and not a third:
      // by the time a third would land, several more have already arrived.
      maxRetries: 1,
      abortSignal: request.signal,
    });

    return Response.json({
      text: result.text.trim(),
      model: MODEL,
      durationSec: result.durationInSeconds ?? null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    // Surface the reason. A quota problem, an unsupported model, and a genuine
    // failure all look identical from the client otherwise, and the first two
    // are configuration mistakes worth seeing plainly during a demo.
    const message = error instanceof Error ? error.message : "transcription failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
