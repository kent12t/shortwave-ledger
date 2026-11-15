/**
 * Optional receiver sound: band-passed static whose level follows signal
 * clarity, a soft click for each detent, and a short two-note chirp when a
 * station locks. Everything is synthesised — no audio files.
 */
export class ReceiverAudio {
  private ctx: AudioContext | null = null;
  private noiseGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private master: GainNode | null = null;
  private lastLevel = -1;

  get enabled() {
    return this.ctx !== null && this.ctx.state === "running";
  }

  async enable() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);

      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      // Slightly pink noise — less hiss, more "radio".
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = last * 0.82 + (Math.random() * 2 - 1) * 0.18;
        data[i] = last * 3.2;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1600;
      filter.Q.value = 0.6;

      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0;
      source.connect(filter).connect(noiseGain).connect(master);
      source.start();

      this.ctx = ctx;
      this.master = master;
      this.filter = filter;
      this.noiseGain = noiseGain;
    }
    await this.ctx.resume();
    this.master!.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.08);
  }

  async disable() {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await this.ctx.suspend();
  }

  /** Called every frame; cheap when nothing changed. */
  update(clarity: number, speed: number) {
    if (!this.enabled || !this.noiseGain || !this.filter) return;
    const level = Math.min(0.22, Math.pow(1 - clarity, 1.4) * 0.16 + Math.min(speed, 1) * 0.06);
    if (Math.abs(level - this.lastLevel) < 0.002) return;
    this.lastLevel = level;
    const now = this.ctx!.currentTime;
    this.noiseGain.gain.setTargetAtTime(level, now, 0.04);
    // The static gets brighter the further off-station you are.
    this.filter.frequency.setTargetAtTime(900 + (1 - clarity) * 1600, now, 0.06);
  }

  private tone(freq: number, start: number, duration: number, peak: number, type: OscillatorType = "sine") {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.master!);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  lock() {
    if (!this.enabled) return;
    const now = this.ctx!.currentTime;
    this.tone(880, now, 0.09, 0.05);
    this.tone(1320, now + 0.07, 0.14, 0.04);
  }

  detent() {
    if (!this.enabled) return;
    this.tone(2400, this.ctx!.currentTime, 0.025, 0.03, "triangle");
  }
}
