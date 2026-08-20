export interface Clock {
  nowMilliseconds(): number;
}

export class SystemClock implements Clock {
  nowMilliseconds(): number {
    return performance.now();
  }
}
