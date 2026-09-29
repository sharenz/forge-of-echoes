// A small, strict fake of the Web Audio API for Node tests. It records the node graph and every
// AudioParam automation event, and throws where browsers throw (non-finite values, exponential
// ramps to ≤ 0, double start, stop before start), so recipes can be validated without audio.

export interface ParamEvent {
  type: 'set' | 'linear' | 'exp' | 'target';
  value: number;
  time: number;
}

function finite(name: string, ...vals: number[]): void {
  for (const v of vals) if (!Number.isFinite(v)) throw new TypeError(`${name}: non-finite value ${v}`);
}

export class FakeParam {
  events: ParamEvent[] = [];
  /** Nodes connected into this param (LFOs, FM). */
  modulators = 0;
  constructor(public value: number, readonly name: string) {}
  setValueAtTime(v: number, t: number): this {
    finite(`${this.name}.setValueAtTime`, v, t);
    if (t < 0) throw new RangeError('negative time');
    this.events.push({ type: 'set', value: v, time: t });
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    finite(`${this.name}.linearRamp`, v, t);
    this.events.push({ type: 'linear', value: v, time: t });
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    finite(`${this.name}.expRamp`, v, t);
    if (v <= 0) throw new RangeError(`${this.name}: exponential ramp to ${v}`);
    this.events.push({ type: 'exp', value: v, time: t });
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number): this {
    finite(`${this.name}.setTarget`, v, t, tc);
    this.events.push({ type: 'target', value: v, time: t });
    return this;
  }
  cancelScheduledValues(t: number): this {
    this.events = this.events.filter((e) => e.time < t);
    return this;
  }
  /**
   * The automated value at time t for set / linear / exponential events (what the browser would
   * compute); `setTarget` events are treated as reaching their value immediately.
   */
  valueAt(t: number): number {
    const ev = [...this.events].sort((a, b) => a.time - b.time);
    let v = this.value;
    let prevT = 0;
    let prevV = this.value;
    for (const e of ev) {
      if (e.type === 'set' || e.type === 'target') {
        if (e.time > t) break;
        v = prevV = e.value;
        prevT = e.time;
        continue;
      }
      if (e.time <= t) {
        v = prevV = e.value;
        prevT = e.time;
        continue;
      }
      const u = (t - prevT) / (e.time - prevT);
      if (e.type === 'linear') return prevV + (e.value - prevV) * u;
      return prevV > 0 && e.value > 0 ? prevV * Math.pow(e.value / prevV, u) : prevV;
    }
    return v;
  }
}

export class FakeNode {
  readonly outputs: (FakeNode | FakeParam)[] = [];
  disconnected = false;
  constructor(readonly ctx: FakeAudioContext, readonly kind: string) {
    ctx.nodes.push(this);
  }
  connect<T extends FakeNode | FakeParam>(dest: T): T {
    if (!dest) throw new TypeError('connect: no destination');
    if (dest instanceof FakeNode && dest.ctx !== this.ctx) throw new Error('connect: different context');
    if (dest instanceof FakeParam) dest.modulators++;
    this.outputs.push(dest);
    return dest;
  }
  disconnect(): void {
    this.outputs.length = 0;
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1, 'gain');
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'gain');
  }
}

export class FakeSource extends FakeNode {
  started: number | null = null;
  stopped: number | null = null;
  ended = false;
  onended: (() => void) | null = null;
  start(t = 0): void {
    finite('start', t);
    if (this.started !== null) throw new Error('InvalidStateError: start called twice');
    this.started = t;
    this.ctx.sources.push(this);
  }
  stop(t = 0): void {
    finite('stop', t);
    if (this.started === null) throw new Error('InvalidStateError: stop before start');
    this.stopped = t;
  }
}

export class FakeOscillator extends FakeSource {
  type: OscillatorType = 'sine';
  frequency = new FakeParam(440, 'frequency');
  detune = new FakeParam(0, 'detune');
  periodic = false;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'oscillator');
  }
  setPeriodicWave(): void {
    this.periodic = true;
  }
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  offset = 0;
  playbackRate = new FakeParam(1, 'playbackRate');
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'bufferSource');
  }
  override start(t = 0, offset = 0): void {
    finite('offset', offset);
    if (offset < 0) throw new RangeError('negative offset');
    super.start(t);
    this.offset = offset;
  }
}

export class FakeConstantSource extends FakeSource {
  offset = new FakeParam(1, 'offset');
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'constantSource');
  }
}

export class FakeBiquad extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  frequency = new FakeParam(350, 'frequency');
  Q = new FakeParam(1, 'Q');
  gain = new FakeParam(0, 'gain');
  detune = new FakeParam(0, 'detune');
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'biquad');
  }
}

export class FakeBuffer {
  readonly data: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number): Float32Array {
    return this.data[c];
  }
  copyToChannel(src: Float32Array, c: number, offset = 0): void {
    this.data[c].set(src, offset);
  }
}

type Listener = () => void;

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  /** New contexts refuse to resume (browser autoplay policy without a gesture). */
  static autoplayBlocked = false;
  currentTime = 0;
  sampleRate = 48000;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  readonly nodes: FakeNode[] = [];
  readonly sources: FakeSource[] = [];
  readonly destination: FakeNode;
  private listeners: Listener[] = [];
  /** When false, resume() leaves the context suspended (autoplay blocked). */
  allowResume = true;

  constructor(_opts?: unknown) {
    this.allowResume = !FakeAudioContext.autoplayBlocked;
    this.destination = new FakeNode(this, 'destination');
    FakeAudioContext.instances.push(this);
  }

  createGain(): FakeGain {
    return new FakeGain(this);
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }
  createConstantSource(): FakeConstantSource {
    return new FakeConstantSource(this);
  }
  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this);
  }
  createWaveShaper(): FakeNode & { curve: Float32Array | null; oversample: string } {
    return Object.assign(new FakeNode(this, 'waveShaper'), { curve: null as Float32Array | null, oversample: 'none' });
  }
  createStereoPanner(): FakeNode & { pan: FakeParam } {
    return Object.assign(new FakeNode(this, 'panner'), { pan: new FakeParam(0, 'pan') });
  }
  createDynamicsCompressor(): FakeNode & Record<'threshold' | 'knee' | 'ratio' | 'attack' | 'release', FakeParam> {
    return Object.assign(new FakeNode(this, 'compressor'), {
      threshold: new FakeParam(-24, 'threshold'), knee: new FakeParam(30, 'knee'), ratio: new FakeParam(12, 'ratio'),
      attack: new FakeParam(0.003, 'attack'), release: new FakeParam(0.25, 'release'),
    });
  }
  createConvolver(): FakeNode & { buffer: FakeBuffer | null; normalize: boolean } {
    return Object.assign(new FakeNode(this, 'convolver'), { buffer: null as FakeBuffer | null, normalize: true });
  }
  createDelay(): FakeNode & { delayTime: FakeParam } {
    return Object.assign(new FakeNode(this, 'delay'), { delayTime: new FakeParam(0, 'delayTime') });
  }
  createChannelMerger(): FakeNode {
    return new FakeNode(this, 'merger');
  }
  createChannelSplitter(): FakeNode {
    return new FakeNode(this, 'splitter');
  }
  createAnalyser(): FakeNode {
    return new FakeNode(this, 'analyser');
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }
  createPeriodicWave(): object {
    return {};
  }

  addEventListener(type: string, fn: Listener): void {
    if (type === 'statechange') this.listeners.push(fn);
  }
  private setState(s: FakeAudioContext['state']): void {
    this.state = s;
    for (const l of this.listeners) l();
  }
  resume(): Promise<void> {
    if (this.state === 'closed') return Promise.reject(new Error('closed'));
    if (this.allowResume) this.setState('running');
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.setState('closed');
    return Promise.resolve();
  }

  /** Advance the audio clock and fire `ended` for sources whose stop time has passed. */
  advance(seconds: number): void {
    this.currentTime += seconds;
    for (const s of this.sources) {
      if (!s.ended && s.stopped !== null && s.stopped <= this.currentTime) {
        s.ended = true;
        s.onended?.();
      }
    }
  }

  /** Sources started at or after `since` (inclusive). */
  sourcesSince(since: number): FakeSource[] {
    return this.sources.filter((s) => (s.started ?? -1) >= since);
  }
}

/**
 * Offline context: renders silence of the requested shape (enough to exercise graph building,
 * render lengths and buffer slicing without a DSP implementation).
 */
export class FakeOfflineAudioContext extends FakeAudioContext {
  static renders = 0;
  readonly length: number;
  readonly numberOfChannels: number;
  constructor(opts: { numberOfChannels: number; length: number; sampleRate: number }) {
    super();
    this.length = opts.length;
    this.numberOfChannels = opts.numberOfChannels;
    this.sampleRate = opts.sampleRate;
  }
  startRendering(): Promise<FakeBuffer> {
    FakeOfflineAudioContext.renders++;
    return Promise.resolve(new FakeBuffer(this.numberOfChannels, this.length, this.sampleRate));
  }
}

/** Install / remove the fake as the global AudioContext (and OfflineAudioContext). */
export function installFakeAudio(offline = false): void {
  const g = globalThis as unknown as { AudioContext?: unknown; OfflineAudioContext?: unknown };
  g.AudioContext = FakeAudioContext;
  if (offline) g.OfflineAudioContext = FakeOfflineAudioContext;
}

export function uninstallFakeAudio(): void {
  const g = globalThis as unknown as { AudioContext?: unknown; OfflineAudioContext?: unknown };
  delete g.AudioContext;
  delete g.OfflineAudioContext;
  FakeAudioContext.instances.length = 0;
  FakeAudioContext.autoplayBlocked = false;
}

export const asCtx = (c: FakeAudioContext): BaseAudioContext => c as unknown as BaseAudioContext;
