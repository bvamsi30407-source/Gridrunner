/**
 * Gridrunner: Neon Eclipse - Web Audio API procedural synthesizer
 */

export class CyberAudio {
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private isMutedState: boolean = false;

  constructor() {
    // Lazy constructor, actual context created on user gesture
  }

  public init() {
    if (this.ctx) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioContextClass();
      if (!this.isMutedState) {
        this.startEngine();
      }
    } catch (e) {
      console.warn('Web Audio API not supported in this browser.', e);
    }
  }

  public setMute(muted: boolean) {
    this.isMutedState = muted;
    if (muted) {
      this.stopEngine();
    } else {
      if (this.ctx && !this.engineOsc) {
        this.startEngine();
      }
    }
  }

  public isMuted(): boolean {
    return this.isMutedState;
  }

  private startEngine() {
    if (!this.ctx || this.isMutedState) return;
    try {
      this.engineOsc = this.ctx.createOscillator();
      this.engineGain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.setValueAtTime(50, this.ctx.currentTime); // Low engine hum

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, this.ctx.currentTime);
      filter.Q.setValueAtTime(4, this.ctx.currentTime);

      this.engineGain.gain.setValueAtTime(0.04, this.ctx.currentTime);

      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);
      this.engineOsc.start(0);
    } catch (e) {
      console.error('Failed to start engine audio:', e);
    }
  }

  public setEngineSpeed(speedRatio: number) {
    if (!this.ctx || !this.engineOsc || !this.engineGain || this.isMutedState) return;
    try {
      const targetFreq = 42 + speedRatio * 48; // Pitch maps up with speed
      const targetGain = 0.015 + speedRatio * 0.035;

      this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.1);
      this.engineGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.1);
    } catch (e) {}
  }

  public stopEngine() {
    if (this.engineOsc) {
      try {
        this.engineOsc.stop();
      } catch (e) {}
      this.engineOsc = null;
    }
    this.engineGain = null;
  }

  public playCollect() {
    if (!this.ctx || this.isMutedState) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, now); // C5
      osc1.frequency.setValueAtTime(783.99, now + 0.08); // G5

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1046.50, now); // C6
      osc2.frequency.setValueAtTime(1567.98, now + 0.08); // G6

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.25);
      osc2.stop(now + 0.25);
    } catch (e) {}
  }

  public playShieldUp() {
    if (!this.ctx || this.isMutedState) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(720, now + 0.45);

      filter.type = 'peaking';
      filter.frequency.setValueAtTime(200, now);
      filter.frequency.exponentialRampToValueAtTime(1200, now + 0.45);
      filter.Q.setValueAtTime(8, now);

      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.55);
    } catch (e) {}
  }

  public playJump() {
    if (!this.ctx || this.isMutedState) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.12);
      osc.frequency.linearRampToValueAtTime(80, now + 0.25);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.26);
    } catch (e) {}
  }

  public playCrash() {
    if (!this.ctx || this.isMutedState) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const noise = this.ctx.createOscillator(); // Simplistic noise approximation
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.linearRampToValueAtTime(10, now + 0.7);

      noise.type = 'square';
      noise.frequency.setValueAtTime(80, now);
      noise.frequency.setValueAtTime(35, now + 0.2);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(450, now);
      filter.frequency.linearRampToValueAtTime(30, now + 0.75);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);

      osc.connect(filter);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      noise.start(now);
      osc.stop(now + 0.8);
      noise.stop(now + 0.8);
    } catch (e) {}
  }

  public playShieldSmash() {
    if (!this.ctx || this.isMutedState) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(60, now + 0.25);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.26);
    } catch (e) {}
  }
}

export const gameAudio = new CyberAudio();
