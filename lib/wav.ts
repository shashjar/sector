/**
 * Encode captured samples as a WAV file.
 *
 * WAV rather than re-encoding through MediaRecorder, for two reasons. It keeps
 * exact clip boundaries — MediaRecorder emits container-aligned chunks and
 * would blur the segment edges the worklet worked to find. And every speech API
 * accepts 16-bit PCM WAV without negotiation, which is one less thing to be
 * wrong about when transcription lands.
 *
 * The size cost is real but small: a 6-second transmission at 16 kHz mono is
 * about 190 KB, and it exists only long enough to be played back or uploaded.
 */

/**
 * Target rate for stored clips.
 *
 * The source is a 22.05 kHz stream that the browser resamples to 48 kHz on the
 * way in. Storing 48 kHz would triple the size to preserve detail the original
 * never had. 16 kHz is the standard rate for speech recognition and comfortably
 * above what a 16 kbps AM radio feed carries.
 */
export const CLIP_SAMPLE_RATE = 16000;

/**
 * Nearest-neighbour resampling.
 *
 * Adequate here specifically because the content is band-limited voice from a
 * narrow AM channel — there is no high-frequency content to alias. It would be
 * the wrong choice for music.
 */
function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = samples[Math.floor(i * ratio)];
  return out;
}

export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
  targetRate = CLIP_SAMPLE_RATE,
): Blob {
  const audio = resample(samples, sampleRate, targetRate);
  const buffer = new ArrayBuffer(44 + audio.length * 2);
  const view = new DataView(buffer);

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + audio.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // format: uncompressed PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeText(36, "data");
  view.setUint32(40, audio.length * 2, true);

  for (let i = 0; i < audio.length; i++) {
    // Clamp before scaling: a sample above 1.0 would wrap to a loud click.
    const clamped = Math.max(-1, Math.min(1, audio[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}
