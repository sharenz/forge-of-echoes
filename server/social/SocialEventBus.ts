import { Client, Pool } from "pg";

export interface SocialInvalidation {
  scope: "party" | "trade";
  partyIds?: string[];
  characterIds?: string[];
  publicPartiesChanged?: boolean;
}

export type SocialInvalidationListener = (event: SocialInvalidation) => void;

export interface SocialEventBus {
  initialize(): Promise<void>;
  publish(event: SocialInvalidation): Promise<void>;
  subscribe(listener: SocialInvalidationListener): () => void;
  close(): Promise<void>;
}

function isSocialInvalidation(value: unknown): value is SocialInvalidation {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SocialInvalidation>;
  return (candidate.scope === "party" || candidate.scope === "trade")
    && (candidate.partyIds === undefined || candidate.partyIds.every((id) => typeof id === "string"))
    && (candidate.characterIds === undefined || candidate.characterIds.every((id) => typeof id === "string"))
    && (candidate.publicPartiesChanged === undefined || typeof candidate.publicPartiesChanged === "boolean");
}

/** Synchronous test/dev adapter with the same change-driven semantics. */
export class InMemorySocialEventBus implements SocialEventBus {
  private readonly listeners = new Set<SocialInvalidationListener>();

  async initialize(): Promise<void> {}

  async publish(event: SocialInvalidation): Promise<void> {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: SocialInvalidationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.listeners.clear();
  }
}

const SOCIAL_CHANNEL = "crafty_social_changes";

/**
 * Cross-process invalidation adapter. PostgreSQL remains the source of truth;
 * NOTIFY only tells connected workers which snapshots must be re-read.
 */
export class PostgresSocialEventBus implements SocialEventBus {
  private readonly publisher: Pool;
  private readonly listeners = new Set<SocialInvalidationListener>();
  private listener: Client | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly connectionString: string) {
    this.publisher = new Pool({ connectionString, max: 2 });
  }

  async initialize(): Promise<void> {
    await this.connectListener();
  }

  async publish(event: SocialInvalidation): Promise<void> {
    if (this.closed) return;
    await this.publisher.query("SELECT pg_notify($1, $2)", [SOCIAL_CHANNEL, JSON.stringify(event)]);
  }

  subscribe(listener: SocialInvalidationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const listener = this.listener;
    this.listener = null;
    await Promise.all([listener?.end(), this.publisher.end()]);
    this.listeners.clear();
  }

  private async connectListener(): Promise<void> {
    if (this.closed || this.listener) return;
    const listener = new Client({ connectionString: this.connectionString });
    listener.on("notification", (notification) => {
      if (notification.channel !== SOCIAL_CHANNEL || !notification.payload) return;
      try {
        const event: unknown = JSON.parse(notification.payload);
        if (!isSocialInvalidation(event)) return;
        for (const subscriber of this.listeners) {
          try {
            subscriber(event);
          } catch (error) {
            console.error("[social-events] subscriber failed", error);
          }
        }
      } catch (error) {
        console.error("[social-events] invalid notification", error);
      }
    });
    const reconnect = (error?: Error) => {
      if (error) console.error("[social-events] listener connection failed", error);
      if (this.listener === listener) this.listener = null;
      this.scheduleReconnect();
    };
    listener.once("error", reconnect);
    listener.once("end", () => reconnect());
    try {
      await listener.connect();
      await listener.query(`LISTEN ${SOCIAL_CHANNEL}`);
      if (this.closed) {
        await listener.end();
        return;
      }
      this.listener = listener;
    } catch (error) {
      await listener.end().catch(() => undefined);
      this.scheduleReconnect();
      throw error;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectListener().catch((error) => {
        console.error("[social-events] reconnect failed", error);
      });
    }, 1_000);
    this.reconnectTimer.unref();
  }
}
