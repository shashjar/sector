/**
 * Splits a squelched ATC feed into individual transmissions.
 *
 * Runs on the audio thread so no sample is ever missed — the alternative, an
 * AnalyserNode polled from the main thread, only sees whatever happens to be in
 * the buffer when it asks, which is fine for a meter and useless for capturing
 * a clip you intend to replay.
 *
 * Amplitude thresholding rather than a speech model, and that is an
 * evidence-backed choice rather than a shortcut. Measured over a minute of KSQL
 * Tower, silence sits between -86 and -81 dB and speech between -31 and -24 dB:
 * a fifty-decibel gap with nothing in it, because LiveATC's receivers are
 * squelched and pass no carrier between transmissions. A neural VAD would be
 * ten megabytes of runtime resolving an ambiguity this audio does not contain.
 *
 * If a feed ever arrives unsquelched — an open receiver with a live noise floor
 * — this assumption breaks, and the fix is a real VAD rather than a lower
 * threshold.
 */

/** Speech starts here. Well inside the measured gap. */
const OPEN_THRESHOLD = 10 ** (-55 / 20);

/**
 * And ends here. Lower than it opens, so a brief dip mid-word does not end the
 * transmission — the same hysteresis a squelch circuit uses.
 */
const CLOSE_THRESHOLD = 10 ** (-62 / 20);

/**
 * Keep recording after the level drops.
 *
 * Speech ends quietly. Cutting the instant the threshold is crossed clips the
 * final consonant, and the last word of a transmission is frequently the
 * callsign — the one token everything downstream depends on.
 */
const HANG_MS = 350;

/**
 * Keep this much audio from *before* speech was detected.
 *
 * Detection necessarily lags onset: the level has to rise before it can be
 * measured. Without a look-behind buffer the first syllable is lost, and on a
 * radio call the first syllable is usually the start of the callsign.
 */
const PREROLL_MS = 300;

/**
 * Minimum *speech*, not minimum clip.
 *
 * Measured against time actually above threshold, deliberately. A clip always
 * carries 300 ms of pre-roll and 350 ms of hang, so checking total length would
 * pass any 20 ms squelch click as a 650 ms transmission — which is exactly what
 * happened on the first run: five of nine detections were clicks sitting at the
 * floor. Each one would have cost a transcription call and put an empty card in
 * the transcript.
 */
const MIN_SPEECH_MS = 250;

/** Longer than this is a stuck mic or a hot frequency; cut and keep going. */
const MAX_DURATION_MS = 25000;

class SegmenterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rate = sampleRate;
    this.prerollSamples = Math.round((PREROLL_MS / 1000) * this.rate);
    this.hangSamples = Math.round((HANG_MS / 1000) * this.rate);
    this.minSpeechSamples = Math.round((MIN_SPEECH_MS / 1000) * this.rate);
    this.maxSamples = Math.round((MAX_DURATION_MS / 1000) * this.rate);

    /** Circular look-behind buffer, always filling. */
    this.preroll = new Float32Array(this.prerollSamples);
    this.prerollWrite = 0;
    this.prerollFilled = 0;

    this.open = false;
    this.captured = [];
    this.capturedLength = 0;
    this.quietSamples = 0;
    /** Samples above threshold in the current capture; the real length test. */
    this.speechSamples = 0;
    /** Level meter for the UI, smoothed so it is readable rather than twitchy. */
    this.envelope = 0;
  }

  /** Oldest-first copy of the look-behind buffer. */
  drainPreroll() {
    const out = new Float32Array(this.prerollFilled);
    const start = (this.prerollWrite - this.prerollFilled + this.prerollSamples) % this.prerollSamples;
    for (let i = 0; i < this.prerollFilled; i++) {
      out[i] = this.preroll[(start + i) % this.prerollSamples];
    }
    return out;
  }

  emit(reason) {
    if (this.speechSamples >= this.minSpeechSamples) {
      const clip = new Float32Array(this.capturedLength);
      let offset = 0;
      for (const block of this.captured) {
        clip.set(block, offset);
        offset += block.length;
      }
      this.port.postMessage(
        {
          type: "transmission",
          samples: clip,
          sampleRate: this.rate,
          durationSec: clip.length / this.rate,
          speechSec: this.speechSamples / this.rate,
          reason,
        },
        [clip.buffer],
      );
    }
    this.open = false;
    this.captured = [];
    this.capturedLength = 0;
    this.quietSamples = 0;
    this.speechSamples = 0;
  }

  process(inputs, outputs) {
    const channel = inputs[0]?.[0];
    const output = outputs[0];

    /*
     * Pass the audio straight through, untouched.
     *
     * This is not optional and it is not a courtesy. Routing a media element
     * into Web Audio takes it off the speakers — the graph becomes the only
     * path to the destination. This node is an insert in that path, so a
     * process() that analyses without writing its output leaves the listener in
     * silence while everything else appears to work perfectly.
     */
    if (output) {
      for (let c = 0; c < output.length; c++) {
        const source = channel ?? null;
        if (source) output[c].set(source);
        else output[c].fill(0);
      }
    }

    if (!channel) {
      // The graph is running but the element is not producing audio yet.
      // Not an end-of-transmission; just nothing to do.
      return true;
    }

    let sum = 0;
    for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
    const rms = Math.sqrt(sum / channel.length);
    // Fast attack, slow release — the meter should jump on speech and settle
    // gently, not flicker at the frame rate.
    this.envelope = Math.max(rms, this.envelope * 0.92);

    if (this.open) {
      this.captured.push(new Float32Array(channel));
      this.capturedLength += channel.length;

      if (rms < CLOSE_THRESHOLD) {
        this.quietSamples += channel.length;
        if (this.quietSamples >= this.hangSamples) this.emit("silence");
      } else {
        this.quietSamples = 0;
        this.speechSamples += channel.length;
      }

      if (this.capturedLength >= this.maxSamples) this.emit("max-length");
    } else if (rms >= OPEN_THRESHOLD) {
      this.open = true;
      const preroll = this.drainPreroll();
      this.captured = [preroll, new Float32Array(channel)];
      this.capturedLength = preroll.length + channel.length;
      this.quietSamples = 0;
      this.speechSamples = channel.length;
      this.port.postMessage({ type: "open" });
    }

    // The look-behind buffer fills unconditionally, including during capture,
    // so it is already warm when the next transmission begins.
    for (let i = 0; i < channel.length; i++) {
      this.preroll[this.prerollWrite] = channel[i];
      this.prerollWrite = (this.prerollWrite + 1) % this.prerollSamples;
    }
    this.prerollFilled = Math.min(this.prerollFilled + channel.length, this.prerollSamples);

    this.port.postMessage({ type: "level", value: this.envelope, open: this.open });
    return true;
  }
}

registerProcessor("segmenter", SegmenterProcessor);
