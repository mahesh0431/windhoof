import type { WorldManifest, WorldSpec } from "../compiler/worldTypes";

type WorkerFactory = () => Worker;

const defaultWorkerFactory: WorkerFactory = () =>
  new Worker(new URL("../../../workers/worldCompiler.worker.ts", import.meta.url), {
    type: "module",
    name: "windhoof-world-compiler",
  });

/** Compiles off the main thread and disposes the one-shot worker afterward. */
export function compileWorldAsync(
  spec: WorldSpec,
  workerFactory: WorkerFactory = defaultWorkerFactory,
): Promise<WorldManifest> {
  const worker = workerFactory();
  const requestId = `${spec.worldId}:${spec.seed}:${spec.generatorVersion}`;
  return new Promise((resolve, reject) => {
    const finish = () => worker.terminate();
    worker.addEventListener("message", (event: MessageEvent) => {
      const message = event.data as {
        readonly type?: string;
        readonly requestId?: string;
        readonly manifest?: WorldManifest;
        readonly message?: string;
      };
      if (message.requestId !== requestId) return;
      finish();
      if (message.type === "compiled" && message.manifest) {
        resolve(message.manifest);
      } else {
        reject(new Error(message.message ?? "World compilation failed"));
      }
    });
    worker.addEventListener("error", (event) => {
      finish();
      reject(new Error(event.message || "World compiler worker crashed"));
    });
    worker.postMessage({ type: "compile", requestId, spec });
  });
}

