import { describe, expect, it } from "vitest";
import spec from "../../docs/contracts/world-spec.example.json";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import type { WorldSpec } from "../../src/game/world/compiler/worldTypes";
import { DISCOVERY_STATE_ORDER } from "../../src/game/contracts/discovery";
import {
  discoveryText,
  interactionPrompt,
  stateVerb,
} from "../../src/ui/journeyText";

/**
 * Wording is the part of this milestone a player actually receives, so it gets
 * the same treatment as any other contract: it must cover the authored content,
 * and it must not fall over on content it has never seen.
 */

const manifest = compileWorld(spec as unknown as WorldSpec);

describe("journey wording", () => {
  it("names every discovery the compiler actually emits", () => {
    for (const discovery of manifest.discoveries) {
      const text = discoveryText(discovery.id, discovery.type);
      expect(text.name.length, discovery.id).toBeGreaterThan(3);
      expect(text.found.length, discovery.id).toBeGreaterThan(12);
      expect(text.objective.length, discovery.id).toBeGreaterThan(8);
      // An identifier leaking into player-facing text is the failure this
      // catches: it reads as a bug even when everything else works.
      expect(text.name).not.toContain("-");
      expect(text.found).not.toContain(discovery.id);
    }
  });

  it("says something true about a discovery it has never heard of", () => {
    const text = discoveryText("some-future-thing", "human-structure");
    expect(text.name).toBe("Something built");
    expect(text.objective.length).toBeGreaterThan(8);
  });

  it("phrases the offer as what the horse does, not as a key", () => {
    expect(interactionPrompt("rest", "The spring")).toBe("Rest at the spring");
    expect(interactionPrompt("inspect", "Trodden ground")).toBe(
      "Look closer at trodden ground",
    );
  });

  it("describes every known state and stays silent about hidden ones", () => {
    for (const state of DISCOVERY_STATE_ORDER) {
      const verb = stateVerb(state);
      if (state === "hidden") expect(verb).toBeNull();
      else expect(verb).toBeTruthy();
    }
  });
});
