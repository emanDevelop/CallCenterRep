// Measures the loudness of a MediaStreamTrack with an AnalyserNode.
// Returns a 0..1 level; anything non-finite reads as silence.

let sharedContext = null;

export function audioContext() {
  if (!sharedContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    sharedContext = Ctx ? new Ctx() : null;
  }
  if (sharedContext?.state === "suspended") sharedContext.resume().catch(() => {});
  return sharedContext;
}

export class LevelMeter {
  constructor() {
    this.source = null;
    this.analyser = null;
    this.buffer = null;
    this.trackId = null;
  }

  attach(track) {
    if (!track || track.kind !== "audio" || track.id === this.trackId) return;
    this.detach();
    const ctx = audioContext();
    if (!ctx) return;
    try {
      this.source = ctx.createMediaStreamSource(new MediaStream([track]));
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.buffer = new Float32Array(this.analyser.fftSize);
      this.source.connect(this.analyser);
      this.trackId = track.id;
    } catch {
      this.detach();
    }
  }

  detach() {
    try {
      this.source?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.source = null;
    this.analyser = null;
    this.buffer = null;
    this.trackId = null;
  }

  level() {
    if (!this.analyser || !this.buffer) return 0;
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (let i = 0; i < this.buffer.length; i++) sum += this.buffer[i] * this.buffer[i];
    const rms = Math.sqrt(sum / this.buffer.length);
    // Speech RMS is usually 0.01–0.2; map that onto most of the 0..1 range.
    const v = Math.min(1, rms * 5);
    return Number.isFinite(v) ? v : 0;
  }
}
