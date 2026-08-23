import { AUTHORITATIVE_SIMULATION_STEP_SECONDS } from "../../multiplayer/simulation";

export interface NetworkEntityFrame {
  tick: number;
  x: number;
  y: number;
  facingX: number;
  facingY: number;
}

/**
 * Tick-clock interpolation for low-frequency authoritative entity state.
 * Packet arrival time is used only to align the two clocks; movement speed is
 * derived exclusively from server ticks, so network jitter cannot create the
 * visible fast/slow pulse that arrival-time lerps do.
 */
export class NetworkEntityInterpolator {
  private readonly frames: NetworkEntityFrame[] = [];
  private clockOffsetMilliseconds: number | null = null;
  private renderAheadPackets = 0;

  constructor(
    private readonly delayMilliseconds = 100,
    private readonly maximumExtrapolationMilliseconds = 100,
    private readonly maximumFrames = 8,
  ) {}

  push(frame: NetworkEntityFrame, receivedAt: number): void {
    const previous = this.frames[this.frames.length - 1];
    if (previous && frame.tick <= previous.tick) return;
    const serverTime = frame.tick * AUTHORITATIVE_SIMULATION_STEP_SECONDS * 1_000;
    const measuredOffset = receivedAt - serverTime;
    const renderedBeforeObservation = this.clockOffsetMilliseconds === null
      ? Number.NEGATIVE_INFINITY
      : receivedAt - this.clockOffsetMilliseconds - this.delayMilliseconds;
    if (renderedBeforeObservation > serverTime + this.maximumExtrapolationMilliseconds / 2) {
      this.renderAheadPackets += 1;
    } else {
      this.renderAheadPackets = 0;
    }
    if (this.renderAheadPackets >= 3) {
      this.clockOffsetMilliseconds = measuredOffset;
      this.renderAheadPackets = 0;
    } else if (this.clockOffsetMilliseconds === null || measuredOffset < this.clockOffsetMilliseconds) {
      this.clockOffsetMilliseconds = measuredOffset;
    } else {
      this.clockOffsetMilliseconds += Math.min(0.02, measuredOffset - this.clockOffsetMilliseconds);
    }
    this.frames.push(frame);
    if (this.frames.length > this.maximumFrames) this.frames.splice(0, this.frames.length - this.maximumFrames);
  }

  sample(now: number): Omit<NetworkEntityFrame, "tick"> | null {
    if (this.frames.length === 0 || this.clockOffsetMilliseconds === null) return null;
    const renderTick = (now - this.clockOffsetMilliseconds - this.delayMilliseconds)
      / (AUTHORITATIVE_SIMULATION_STEP_SECONDS * 1_000);
    const first = this.frames[0];
    if (this.frames.length === 1 || renderTick <= first.tick) return this.value(first);
    for (let index = 1; index < this.frames.length; index += 1) {
      const to = this.frames[index];
      if (to.tick < renderTick) continue;
      const from = this.frames[index - 1];
      return this.interpolate(from, to, (renderTick - from.tick) / Math.max(1, to.tick - from.tick));
    }
    const to = this.frames[this.frames.length - 1];
    const from = this.frames[Math.max(0, this.frames.length - 2)];
    const maximumTicks = this.maximumExtrapolationMilliseconds / (AUTHORITATIVE_SIMULATION_STEP_SECONDS * 1_000);
    const extraTicks = Math.min(maximumTicks, Math.max(0, renderTick - to.tick));
    const progress = Math.min(2, 1 + extraTicks / Math.max(1, to.tick - from.tick));
    return this.interpolate(from, to, progress);
  }

  private interpolate(from: NetworkEntityFrame, to: NetworkEntityFrame, progress: number): Omit<NetworkEntityFrame, "tick"> {
    const amount = Math.max(0, progress);
    return {
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount,
      facingX: to.facingX,
      facingY: to.facingY,
    };
  }

  private value(frame: NetworkEntityFrame): Omit<NetworkEntityFrame, "tick"> {
    return { x: frame.x, y: frame.y, facingX: frame.facingX, facingY: frame.facingY };
  }
}
