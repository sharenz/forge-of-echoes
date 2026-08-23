export interface ServerDrainSnapshot {
  draining: boolean;
  startedAt: string | null;
}

export class ServerDrain {
  private startedAtMilliseconds: number | null = null;
  private readonly listeners = new Set<() => void>();

  get isDraining(): boolean {
    return this.startedAtMilliseconds !== null;
  }

  begin(nowMilliseconds = Date.now()): ServerDrainSnapshot {
    if (this.startedAtMilliseconds === null) {
      this.startedAtMilliseconds = nowMilliseconds;
      for (const listener of this.listeners) listener();
    }
    return this.snapshot();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ServerDrainSnapshot {
    return {
      draining: this.isDraining,
      startedAt: this.startedAtMilliseconds === null ? null : new Date(this.startedAtMilliseconds).toISOString(),
    };
  }
}

export const serverDrain = new ServerDrain();
