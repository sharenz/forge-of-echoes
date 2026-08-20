export interface RandomSource {
  next(): number;
  nextUint32(): number;
}

export class SeededRng implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x6d2b79f5;
  }

  nextUint32(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  next(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }
}
