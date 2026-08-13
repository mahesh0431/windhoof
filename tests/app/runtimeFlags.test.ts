import { describe, expect, it } from "vitest";
import { resolveRuntimeFlags } from "../../src/app/runtimeFlags";

/**
 * The mute flag is a promise made to whoever opens the URL, so what matters is
 * that it survives the shapes URLs actually arrive in.
 */

const flags = (search: string, hash = "") => resolveRuntimeFlags({ search, hash });

describe("runtime flags", () => {
  it("is off by default, so ordinary play sounds exactly as it did", () => {
    expect(flags("").muted).toBe(false);
    expect(flags("?stage=lab").muted).toBe(false);
    expect(flags("", "#overlook").muted).toBe(false);
  });

  it("reads the canonical form", () => {
    expect(flags("?mute=1").muted).toBe(true);
  });

  it("coexists with other parameters, in either order", () => {
    expect(flags("?stage=lab&mute=1").muted).toBe(true);
    expect(flags("?mute=1&stage=lab&lab=1").muted).toBe(true);
  });

  it("survives a fragment, and is still found when it is inside one", () => {
    expect(flags("?mute=1", "#anywhere").muted).toBe(true);
    // `#/somewhere?mute=1` is a shape people produce by accident. A mute flag
    // that silently does nothing would be worse than having no flag at all.
    expect(flags("", "#/spot?mute=1").muted).toBe(true);
  });

  it("accepts the spellings people actually type, and an explicit off", () => {
    expect(flags("?mute").muted).toBe(true);
    expect(flags("?mute=true").muted).toBe(true);
    expect(flags("?mute=YES").muted).toBe(true);
    expect(flags("?mute=0").muted).toBe(false);
    expect(flags("?mute=false").muted).toBe(false);
  });

  it("does not fire on a parameter that merely starts the same way", () => {
    expect(flags("?muted=1").muted).toBe(false);
    expect(flags("?unmute=1").muted).toBe(false);
  });
});
