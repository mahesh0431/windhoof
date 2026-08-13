import type { TerrainChunk, WorldManifest } from "../compiler/worldTypes";
import {
  buildTerrainChunkTopology,
  type TerrainChunkTopology,
} from "./terrainChunkTopology";

export type ChunkLifecycle =
  | "requested"
  | "prepared"
  | "active"
  | "cooldown"
  | "disposed";
export type ChunkConsumer = "physics" | "render";

interface ChunkRecord {
  readonly chunk: TerrainChunk;
  lifecycle: ChunkLifecycle;
  topology: TerrainChunkTopology | null;
  physicsRetains: number;
  renderRetains: number;
  preparationMilliseconds: number;
}

export interface ChunkRepositorySnapshot {
  readonly mode: "full-world";
  readonly totalChunks: number;
  readonly requestedChunks: number;
  readonly preparedChunks: number;
  readonly activeChunks: number;
  readonly cooldownChunks: number;
  readonly disposedChunks: number;
  readonly physicsReadyChunks: number;
  readonly renderReadyChunks: number;
  readonly physicsRetains: number;
  readonly renderRetains: number;
  readonly longestPreparationMilliseconds: number;
  readonly totalPreparationMilliseconds: number;
}

export interface PrepareOptions {
  readonly now?: () => number;
  /** Called between chunks so startup never turns the whole island into one job. */
  readonly yieldBetweenChunks?: () => Promise<void>;
}

/**
 * Full-resident vertical-slice repository.
 *
 * The lifecycle is deliberately modelled now, but all sixteen chunks remain
 * resident for Milestone 3. Streaming rings are a future policy on top of this
 * repository, not a second representation of the world.
 */
export class IslandChunkRepository {
  private readonly records: ChunkRecord[];
  private readonly recordById = new Map<string, ChunkRecord>();
  private disposed = false;

  public constructor(public readonly manifest: WorldManifest) {
    this.records = [...manifest.chunks]
      .sort((a, b) => a.chunkZ - b.chunkZ || a.chunkX - b.chunkX || a.id.localeCompare(b.id))
      .map((chunk) => ({
        chunk,
        lifecycle: "requested" as const,
        topology: null,
        physicsRetains: 0,
        renderRetains: 0,
        preparationMilliseconds: 0,
      }));
    for (const record of this.records) {
      if (this.recordById.has(record.chunk.id)) {
        throw new Error(`Duplicate terrain chunk id ${record.chunk.id}`);
      }
      this.recordById.set(record.chunk.id, record);
    }
  }

  public chunkIds(): readonly string[] {
    return this.records.map((record) => record.chunk.id);
  }

  public chunkAt(chunkX: number, chunkZ: number): TerrainChunk | null {
    return this.records.find(
      (record) => record.chunk.chunkX === chunkX && record.chunk.chunkZ === chunkZ,
    )?.chunk ?? null;
  }

  public async prepareAll(options: PrepareOptions = {}): Promise<void> {
    this.assertAlive();
    const now = options.now ?? monotonicNow;
    for (let index = 0; index < this.records.length; index += 1) {
      const record = this.records[index];
      if (!record || record.lifecycle !== "requested") continue;
      this.prepareRecord(record, now);
      if (index < this.records.length - 1) await options.yieldBetweenChunks?.();
    }
  }

  /** Used by deterministic Node tests and compatibility callers without a frame loop. */
  public prepareAllSync(now: () => number = monotonicNow): void {
    this.assertAlive();
    for (const record of this.records) {
      if (record.lifecycle === "requested") this.prepareRecord(record, now);
    }
  }

  public topology(chunkId: string): TerrainChunkTopology {
    const record = this.requireRecord(chunkId);
    if (!record.topology) throw new Error(`Chunk ${chunkId} is not prepared`);
    return record.topology;
  }

  public retain(chunkId: string, consumer: ChunkConsumer): () => void {
    this.assertAlive();
    const record = this.requireRecord(chunkId);
    if (!record.topology || record.lifecycle === "requested") {
      throw new Error(`Cannot retain unprepared chunk ${chunkId}`);
    }
    if (record.lifecycle === "disposed") {
      throw new Error(`Cannot retain disposed chunk ${chunkId}`);
    }
    if (consumer === "physics") record.physicsRetains += 1;
    else record.renderRetains += 1;
    this.refreshLifecycle(record);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (consumer === "physics") record.physicsRetains -= 1;
      else record.renderRetains -= 1;
      if (record.physicsRetains < 0 || record.renderRetains < 0) {
        throw new Error(`Negative retain count for ${chunkId}`);
      }
      this.refreshLifecycle(record);
    };
  }

  public isPhysicsReady(chunkId: string): boolean {
    const record = this.recordById.get(chunkId);
    return Boolean(record && record.physicsRetains > 0 && record.lifecycle !== "disposed");
  }

  public activateAll(): void {
    this.assertAlive();
    for (const record of this.records) {
      if (!record.topology || record.physicsRetains < 1 || record.renderRetains < 1) {
        throw new Error(`Chunk ${record.chunk.id} cannot activate without render and physics`);
      }
      record.lifecycle = "active";
    }
  }

  public snapshot(): ChunkRepositorySnapshot {
    const count = (lifecycle: ChunkLifecycle) =>
      this.records.filter((record) => record.lifecycle === lifecycle).length;
    return {
      mode: "full-world",
      totalChunks: this.records.length,
      requestedChunks: count("requested"),
      preparedChunks: count("prepared"),
      activeChunks: count("active"),
      cooldownChunks: count("cooldown"),
      disposedChunks: count("disposed"),
      physicsReadyChunks: this.records.filter((record) => record.physicsRetains > 0).length,
      renderReadyChunks: this.records.filter((record) => record.renderRetains > 0).length,
      physicsRetains: this.records.reduce((sum, record) => sum + record.physicsRetains, 0),
      renderRetains: this.records.reduce((sum, record) => sum + record.renderRetains, 0),
      longestPreparationMilliseconds: Math.max(
        0,
        ...this.records.map((record) => record.preparationMilliseconds),
      ),
      totalPreparationMilliseconds: this.records.reduce(
        (sum, record) => sum + record.preparationMilliseconds,
        0,
      ),
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    for (const record of this.records) {
      if (record.physicsRetains !== 0 || record.renderRetains !== 0) {
        throw new Error(`Chunk ${record.chunk.id} disposed while retained`);
      }
      record.topology = null;
      record.lifecycle = "disposed";
    }
    this.disposed = true;
  }

  private refreshLifecycle(record: ChunkRecord): void {
    if (record.lifecycle === "disposed") return;
    if (record.physicsRetains > 0 && record.renderRetains > 0) record.lifecycle = "active";
    else if (record.physicsRetains > 0 || record.renderRetains > 0) record.lifecycle = "prepared";
    else if (record.topology) record.lifecycle = "cooldown";
  }

  private prepareRecord(record: ChunkRecord, now: () => number): void {
    const startedAt = now();
    record.topology = buildTerrainChunkTopology(record.chunk);
    record.preparationMilliseconds = Math.max(0, now() - startedAt);
    record.lifecycle = "prepared";
  }

  private requireRecord(chunkId: string): ChunkRecord {
    const record = this.recordById.get(chunkId);
    if (!record) throw new Error(`Unknown terrain chunk ${chunkId}`);
    return record;
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error("Island chunk repository is disposed");
  }
}

function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
