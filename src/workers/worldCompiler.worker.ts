/// <reference lib="webworker" />

import { compileWorld } from "../game/world/compiler/compileWorld";
import type { WorldSpec } from "../game/world/compiler/worldTypes";

interface CompileRequest {
  readonly type: "compile";
  readonly requestId: string;
  readonly spec: WorldSpec;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener("message", (event: MessageEvent<CompileRequest>) => {
  if (event.data.type !== "compile") return;
  try {
    scope.postMessage({
      type: "compiled",
      requestId: event.data.requestId,
      manifest: compileWorld(event.data.spec),
    });
  } catch (error) {
    scope.postMessage({
      type: "failed",
      requestId: event.data.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

