/**
 * Serialises load-transform-save transactions per character while allowing
 * different characters to persist concurrently.
 */
export class CharacterWriteQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(characterId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(characterId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    this.tails.set(characterId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(characterId) === tail) this.tails.delete(characterId);
    }
  }

  async settled(characterId?: string): Promise<void> {
    if (characterId) {
      await this.tails.get(characterId)?.catch(() => undefined);
      return;
    }
    await Promise.all([...this.tails.values()].map((tail) => tail.catch(() => undefined)));
  }

  get pendingCharacters(): number {
    return this.tails.size;
  }
}
