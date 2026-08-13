import type { PersistenceSnapshot, PersistenceStatus } from "../contracts/save";
import type { SaveAdapter } from "./saveAdapter";
import type { GameSaveV1 } from "./saveSchema";

export type PersistenceListener = (snapshot: PersistenceSnapshot) => void;

/** Serializes writes and coalesces bursts so an older save can never win last. */
export class AutosaveCoordinator {
  private pending: GameSaveV1 | null = null;
  private drainPromise: Promise<void> | null = null;
  private status: PersistenceStatus = "ready";
  private lastSavedTick: number | null = null;
  private newestRequestedTick = -1;

  public constructor(
    private readonly adapter: SaveAdapter,
    private readonly listener: PersistenceListener = () => undefined,
  ) {}

  public snapshot(): PersistenceSnapshot {
    return { status: this.status, lastSavedTick: this.lastSavedTick };
  }

  public request(save: GameSaveV1): void {
    if (save.playTimeTicks < this.newestRequestedTick) return;
    this.newestRequestedTick = save.playTimeTicks;
    this.pending = save;
    this.setStatus("saving");
    this.startDrain();
  }

  /** Retries the newest retained snapshot after a storage failure. */
  public retry(): void {
    if (!this.pending) return;
    this.setStatus("saving");
    this.startDrain();
  }

  public async flush(): Promise<void> {
    while (this.drainPromise) await this.drainPromise;
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const save = this.pending;
      this.pending = null;
      try {
        await this.adapter.write(save);
        this.lastSavedTick = save.playTimeTicks;
        this.setStatus(this.pending ? "saving" : "saved");
      } catch {
        // Never discard a newer coalesced snapshot because an older write
        // failed. If no newer request exists, retain the failed snapshot.
        this.pending ??= save;
        this.setStatus("error");
        return;
      }
    }
  }

  private startDrain(): void {
    if (this.drainPromise || !this.pending) return;
    const active = this.drain();
    this.drainPromise = active;
    void active.finally(() => {
      if (this.drainPromise !== active) return;
      this.drainPromise = null;
      // A request may have arrived between a failed write and this cleanup.
      // Only that explicit request changes error back to saving and authorizes
      // another attempt; failures never create an unbounded retry loop.
      if (this.pending && this.status === "saving") this.startDrain();
    });
  }

  private setStatus(status: PersistenceStatus): void {
    this.status = status;
    this.listener(this.snapshot());
  }
}
