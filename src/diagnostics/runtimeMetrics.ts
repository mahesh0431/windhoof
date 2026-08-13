export interface RuntimeMetricsSnapshot {
  readonly frameP95Milliseconds: number;
  readonly physicsP95Milliseconds: number;
  readonly frameSamples: number;
  readonly physicsSamples: number;
  readonly browserHeapBytes?: number;
}

/** Fixed-capacity diagnostics: sampling the profiler must not become a leak. */
export class RuntimeMetrics {
  private readonly frameMilliseconds: number[] = [];
  private readonly physicsMilliseconds: number[] = [];
  private frameCursor = 0;
  private physicsCursor = 0;

  public constructor(private readonly capacity = 600) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Runtime metrics capacity must be a positive integer");
    }
  }

  public sampleFrame(milliseconds: number): void {
    this.frameCursor = pushRing(
      this.frameMilliseconds,
      this.frameCursor,
      this.capacity,
      milliseconds,
    );
  }

  public samplePhysics(milliseconds: number): void {
    this.physicsCursor = pushRing(
      this.physicsMilliseconds,
      this.physicsCursor,
      this.capacity,
      milliseconds,
    );
  }

  public snapshot(browserHeapBytes?: number): RuntimeMetricsSnapshot {
    return {
      frameP95Milliseconds: percentile95(this.frameMilliseconds),
      physicsP95Milliseconds: percentile95(this.physicsMilliseconds),
      frameSamples: this.frameMilliseconds.length,
      physicsSamples: this.physicsMilliseconds.length,
      ...(browserHeapBytes === undefined ? {} : { browserHeapBytes }),
    };
  }
}

function pushRing(
  values: number[],
  cursor: number,
  capacity: number,
  value: number,
): number {
  if (!Number.isFinite(value) || value < 0) return cursor;
  if (values.length < capacity) values.push(value);
  else values[cursor] = value;
  return (cursor + 1) % capacity;
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}
