export type GraphicsStatus =
  | "ready"
  | "context-lost"
  | "restoring"
  | "restored-paused"
  | "failed";

export interface GraphicsLifecycleSnapshot {
  readonly status: GraphicsStatus;
  readonly generation: number;
  readonly failureCode?: "restore-render-failed";
}

export type GraphicsLifecycleEvent =
  | { readonly type: "GraphicsContextLost"; readonly generation: number }
  | { readonly type: "GraphicsContextRestored"; readonly generation: number }
  | {
      readonly type: "GraphicsContextRecoveryFailed";
      readonly generation: number;
      readonly failureCode: "restore-render-failed";
    };
