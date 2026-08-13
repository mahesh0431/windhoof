import type { GameSaveV1 } from "./saveSchema";

export interface SaveAdapter {
  read(): Promise<unknown | null>;
  write(save: GameSaveV1): Promise<void>;
  remove(): Promise<void>;
  close?(): void;
}
