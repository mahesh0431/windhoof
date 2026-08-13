import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import type { WorldSpec } from "../../src/game/world/compiler/worldTypes";

const exampleJson = JSON.parse(
  readFileSync(new URL("../../docs/contracts/world-spec.example.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

test("compiles the deterministic island off the browser main thread", async ({ page }) => {
  const expected = compileWorld(exampleJson as unknown as WorldSpec);
  // The bare harness page, not the game: this check is about the worker, and
  // booting the island would compile the same manifest a second time for
  // nothing.
  await page.goto("/tests/browser/harness.html?mute=1");
  const result = await page.evaluate(async (spec) => {
    let heartbeats = 0;
    const interval = window.setInterval(() => {
      heartbeats += 1;
    }, 10);
    const modulePath = "/src/game/world/runtime/compileWorldAsync.ts";
    const module = await import(/* @vite-ignore */ modulePath) as {
      compileWorldAsync(input: typeof spec): Promise<{
        manifestHash: string;
        sourceSpecHash: string;
        chunks: unknown[];
      }>;
    };
    const manifest = await module.compileWorldAsync(spec);
    window.clearInterval(interval);
    return {
      heartbeats,
      hash: manifest.manifestHash,
      sourceHash: manifest.sourceSpecHash,
      chunks: manifest.chunks.length,
    };
  }, exampleJson);

  expect(result.heartbeats).toBeGreaterThan(3);
  expect(result.hash).toMatch(/^fnv1a64-[0-9a-f]{16}$/);
  expect(result.sourceHash).toMatch(/^fnv1a64-[0-9a-f]{16}$/);
  expect(result.hash).toBe(expected.manifestHash);
  expect(result.sourceHash).toBe(expected.sourceSpecHash);
  expect(result.chunks).toBe(16);
});
