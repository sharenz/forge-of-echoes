// Optimistic character state. The server owns the CharacterSave; the client runs the same pure rules, so
// deterministic operations (moving items, points, loadout) can show their result at once instead of snapping back
// for a round trip plus the server's ≤ 5 Hz push debounce. Random operations (crafting, gambling, opening maps)
// are never predicted.
//
// Rules: a prediction stays on screen while its commands are in flight. A rejected command drops the prediction
// (back to the server's truth). Once every predicted command is acknowledged, the next 'character' push — which
// includes them — replaces the prediction; if that push already arrived before the acknowledgement, the
// prediction retires after a short grace instead.
import type { CharacterSave } from '../contracts/items';

/** After the last acknowledgement, keep the prediction at most this long waiting for the push (ms). */
export const SETTLE_MS = 450;

export class CharacterSync {
  private server: CharacterSave | null = null;
  private predicted: CharacterSave | null = null;
  private inFlight = 0;
  private settleAt = 0;

  /** What the UI should show. */
  get display(): CharacterSave | null {
    return this.predicted ?? this.server;
  }

  /** The newest authoritative character. */
  get authoritative(): CharacterSave | null {
    return this.server;
  }

  get pending(): number {
    return this.inFlight;
  }

  /** A 'character' message. Returns true when the displayed character changed. */
  fromServer(ch: CharacterSave): boolean {
    const before = this.display;
    this.server = ch;
    if (this.inFlight === 0) {
      this.predicted = null;
      this.settleAt = 0;
    }
    return this.display !== before;
  }

  /** Show `next` (the local rules' result of a command just sent). */
  predict(next: CharacterSave): void {
    this.predicted = next;
    this.inFlight++;
    this.settleAt = 0;
  }

  /** The base for the next prediction: the current display. */
  get base(): CharacterSave | null {
    return this.display;
  }

  /** A predicted command was answered. Returns true when the displayed character changed. */
  resolved(ok: boolean, now: number): boolean {
    const before = this.display;
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (!ok) {
      this.predicted = null;
      this.settleAt = 0;
    } else if (this.inFlight === 0 && this.predicted) {
      this.settleAt = now + SETTLE_MS;
    }
    return this.display !== before;
  }

  /** Per-frame: retire a settled prediction. Returns true when the displayed character changed. */
  tick(now: number): boolean {
    if (!this.predicted || this.inFlight > 0 || this.settleAt === 0 || now < this.settleAt) return false;
    this.predicted = null;
    this.settleAt = 0;
    return true;
  }

  /** Forget everything (left the game / connection reset). */
  reset(): void {
    this.server = null;
    this.predicted = null;
    this.inFlight = 0;
    this.settleAt = 0;
  }

  /** The connection dropped: in-flight commands are lost, show the server's last word. */
  dropPredictions(): boolean {
    const before = this.display;
    this.predicted = null;
    this.inFlight = 0;
    this.settleAt = 0;
    return this.display !== before;
  }
}
