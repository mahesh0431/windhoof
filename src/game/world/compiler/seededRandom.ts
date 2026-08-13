/** Small deterministic stream with independent named forks. */
export class SeededRandom {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0;
  }

  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  public range(minimum: number, maximum: number): number {
    return minimum + (maximum - minimum) * this.next();
  }
}

export function stableSeed(seed: number, namespace: string): number {
  let value = (seed ^ 0x811c9dc5) >>> 0;
  for (let index = 0; index < namespace.length; index += 1) {
    value ^= namespace.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

export function randomStream(seed: number, namespace: string): SeededRandom {
  return new SeededRandom(stableSeed(seed, namespace));
}

