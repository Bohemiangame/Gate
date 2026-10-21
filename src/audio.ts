// All sounds are synthesised with Web Audio – no audio files.
type SfxName =
  | 'revolver'
  | 'rifle'
  | 'shotgun'
  | 'gatling'
  | 'throw'
  | 'enemyShot'
  | 'hit'
  | 'headshot'
  | 'reload'
  | 'empty'
  | 'explode'
  | 'gateGood'
  | 'gateBad'
  | 'crate'
  | 'weapon'
  | 'coin'
  | 'die'
  | 'hurt'
  | 'warn'
  | 'win'
  | 'lose'
  | 'click'
  | 'deadeye'
  | 'wood';

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  private last = new Map<string, number>();

  /** Must be called from a user gesture (first tap). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  private noiseBurst(t: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'lowpass'): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(t: number, dur: number, f0: number, f1: number, gain: number, type: OscillatorType = 'square'): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  play(name: SfxName, minGap = 0.03): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const prev = this.last.get(name) ?? -1;
    if (now - prev < minGap) return;
    this.last.set(name, now);
    const t = now + 0.005;
    switch (name) {
      case 'revolver':
        this.noiseBurst(t, 0.18, 2200, 0.7, 0.5);
        this.tone(t, 0.12, 180, 50, 0.35, 'triangle');
        break;
      case 'rifle':
        this.noiseBurst(t, 0.3, 3000, 0.6, 0.55);
        this.tone(t, 0.18, 140, 40, 0.4, 'triangle');
        break;
      case 'shotgun':
        this.noiseBurst(t, 0.35, 1400, 0.5, 0.7);
        this.tone(t, 0.22, 110, 35, 0.5, 'triangle');
        break;
      case 'gatling':
        this.noiseBurst(t, 0.07, 2600, 0.8, 0.3);
        break;
      case 'throw':
        this.noiseBurst(t, 0.2, 900, 2, 0.15, 'bandpass');
        break;
      case 'enemyShot':
        this.noiseBurst(t, 0.2, 1500, 0.7, 0.35);
        this.tone(t, 0.1, 260, 80, 0.2, 'triangle');
        break;
      case 'hit':
        this.tone(t, 0.06, 900, 400, 0.12, 'square');
        break;
      case 'headshot':
        this.tone(t, 0.08, 1400, 1400, 0.15, 'square');
        this.tone(t + 0.07, 0.12, 2100, 2100, 0.12, 'square');
        break;
      case 'reload':
        this.noiseBurst(t, 0.04, 4000, 3, 0.25, 'bandpass');
        break;
      case 'empty':
        this.tone(t, 0.04, 2400, 2000, 0.1, 'square');
        break;
      case 'explode':
        this.noiseBurst(t, 0.9, 500, 0.6, 0.9);
        this.tone(t, 0.6, 90, 25, 0.6, 'sine');
        break;
      case 'gateGood':
        [523, 659, 784].forEach((f, i) => this.tone(t + i * 0.06, 0.12, f, f, 0.12, 'square'));
        break;
      case 'gateBad':
        [392, 311, 233].forEach((f, i) => this.tone(t + i * 0.07, 0.14, f, f, 0.12, 'square'));
        break;
      case 'crate':
      case 'wood':
        this.noiseBurst(t, 0.15, 700, 1.5, 0.35, 'bandpass');
        break;
      case 'weapon':
        [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(t + i * 0.05, 0.15, f, f, 0.1, 'square'));
        break;
      case 'coin':
        this.tone(t, 0.06, 988, 988, 0.1, 'square');
        this.tone(t + 0.06, 0.15, 1319, 1319, 0.1, 'square');
        break;
      case 'die':
        this.noiseBurst(t, 0.25, 600, 1, 0.3, 'bandpass');
        break;
      case 'hurt':
        this.tone(t, 0.18, 300, 120, 0.2, 'sawtooth');
        break;
      case 'warn':
        this.tone(t, 0.07, 1800, 1800, 0.06, 'square');
        break;
      case 'win':
        [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(t + i * 0.11, 0.2, f, f, 0.13, 'square'));
        break;
      case 'lose':
        [392, 370, 349, 262].forEach((f, i) => this.tone(t + i * 0.2, 0.3, f, f * 0.98, 0.13, 'triangle'));
        break;
      case 'click':
        this.tone(t, 0.04, 1200, 900, 0.08, 'square');
        break;
      case 'deadeye':
        this.tone(t, 0.6, 200, 60, 0.3, 'sine');
        this.noiseBurst(t, 0.5, 300, 4, 0.2, 'bandpass');
        break;
    }
  }
}

export const audio = new Audio();

export function vibrate(ms: number | number[]): void {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch {
    /* not supported */
  }
}
