import type { SaveAdapter } from "./saveAdapter";
import type { GameSaveV1 } from "./saveSchema";

export class MemorySaveAdapter implements SaveAdapter {
  private value: unknown | null;

  public constructor(initialValue: unknown | null = null) {
    this.value = initialValue;
  }

  public async read(): Promise<unknown | null> {
    return this.value;
  }

  public async write(save: GameSaveV1): Promise<void> {
    this.value = structuredClone(save);
  }

  public async remove(): Promise<void> {
    this.value = null;
  }
}
