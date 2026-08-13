/**
 * Named durations for the bounded jobs that realize the world at startup.
 *
 * Milestone 3 states a hard 50 ms ceiling on any single main-thread preparation
 * job, and a ceiling nobody can see is a ceiling nobody keeps. Timing each job
 * by name is what turns that from an intention into something a browser check
 * can fail on, and what makes a regression point at the job that caused it
 * rather than at the whole of startup.
 *
 * The store is fixed-size on purpose. It exists during a boot that runs a known
 * number of jobs and is then read for the rest of the session, so it must never
 * become a list that grows with runtime. When more jobs run than the window
 * holds, the oldest records are dropped - but the running maximum is kept
 * separately, so truncation can never hide the one measurement the gate is
 * about.
 */
export interface PreparationJobRecord {
  readonly name: string;
  readonly milliseconds: number;
}

export interface PreparationSnapshot {
  /** Jobs run in total, which may exceed the retained window. */
  readonly jobCount: number;
  readonly longestMilliseconds: number;
  readonly longestName: string | null;
  readonly totalMilliseconds: number;
}

export interface PreparationLog {
  readonly capacity: number;
  /** Times one job and returns its result unchanged. */
  run<T>(name: string, work: () => T): T;
  /** The retained window, oldest first. */
  jobs(): readonly PreparationJobRecord[];
  snapshot(): PreparationSnapshot;
}

const DEFAULT_CAPACITY = 128;

export function createPreparationLog(capacity: number = DEFAULT_CAPACITY): PreparationLog {
  const size = Math.max(1, Math.floor(capacity));
  const names: string[] = new Array<string>(size).fill("");
  const durations = new Float64Array(size);
  let written = 0;
  let longestMilliseconds = 0;
  let longestName: string | null = null;
  let totalMilliseconds = 0;

  return {
    capacity: size,

    run(name, work) {
      const start = performance.now();
      try {
        return work();
      } finally {
        const milliseconds = performance.now() - start;
        const slot = written % size;
        names[slot] = name;
        durations[slot] = milliseconds;
        written += 1;
        totalMilliseconds += milliseconds;
        if (milliseconds > longestMilliseconds) {
          longestMilliseconds = milliseconds;
          longestName = name;
        }
      }
    },

    jobs() {
      const held = Math.min(written, size);
      const first = written - held;
      const records: PreparationJobRecord[] = [];
      for (let index = 0; index < held; index += 1) {
        const slot = (first + index) % size;
        records.push({ name: names[slot] ?? "", milliseconds: durations[slot] ?? 0 });
      }
      return records;
    },

    snapshot() {
      return { jobCount: written, longestMilliseconds, longestName, totalMilliseconds };
    },
  };
}
