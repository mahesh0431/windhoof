import type { BufferAttribute } from "three";
import { describe, expect, it } from "vitest";
import { createHoofContacts } from "../../src/render/horse/hoofContacts";

/**
 * The debris pool is fixed-size and runs for the whole session, so the things
 * worth pinning are that it stays bounded, that it actually clears, and that
 * the surface is readable from the debris alone.
 */

function attribute(
  contacts: ReturnType<typeof createHoofContacts>,
  name: string,
): BufferAttribute {
  return contacts.points.geometry.getAttribute(name) as BufferAttribute;
}

function liveCount(contacts: ReturnType<typeof createHoofContacts>): number {
  const lives = attribute(contacts, "aLife").array as Float32Array;
  let count = 0;
  for (const life of lives) if (life > 0) count += 1;
  return count;
}

describe("hoof contacts", () => {
  it("stays inside its pool however long the horse gallops", () => {
    const contacts = createHoofContacts();
    const capacity = attribute(contacts, "aLife").count;

    for (let stride = 0; stride < 400; stride += 1) {
      contacts.strike(stride * 0.1, 0, 0, "sand", false, 1, 16, 0, 1);
      contacts.update(1 / 60, 750);
    }

    expect(liveCount(contacts)).toBeLessThanOrEqual(capacity);
    expect(attribute(contacts, "position").count).toBe(capacity);
    contacts.dispose();
  });

  it("clears completely and stops drawing once the debris dies", () => {
    const contacts = createHoofContacts();
    contacts.strike(0, 0, 0, "grass", false, 1, 16, 0, 1);
    contacts.update(1 / 60, 750);
    expect(liveCount(contacts)).toBeGreaterThan(0);
    expect(contacts.points.visible).toBe(true);

    for (let frame = 0; frame < 300; frame += 1) contacts.update(1 / 60, 750);

    expect(liveCount(contacts)).toBe(0);
    // Nothing alive must mean nothing submitted, not an empty draw every frame.
    expect(contacts.points.visible).toBe(false);
    contacts.dispose();
  });

  it("throws water further and higher than it throws turf", () => {
    // Wet ground is chosen by the water line, not by surface classification:
    // the ford is streambed and the shore shelf is sand, and both splash.
    const water = createHoofContacts();
    const turf = createHoofContacts();
    water.strike(0, 0, 0, "streambed", true, 1, 16, 0, 1);
    turf.strike(0, 0, 0, "grass", false, 1, 16, 0, 1);
    for (let frame = 0; frame < 6; frame += 1) {
      water.update(1 / 60, 750);
      turf.update(1 / 60, 750);
    }

    const highest = (contacts: ReturnType<typeof createHoofContacts>) => {
      const positions = attribute(contacts, "position").array as Float32Array;
      const lives = attribute(contacts, "aLife").array as Float32Array;
      let peak = -Infinity;
      for (let index = 0; index < lives.length; index += 1) {
        if (lives[index]! > 0) peak = Math.max(peak, positions[index * 3 + 1]!);
      }
      return peak;
    };

    expect(highest(water)).toBeGreaterThan(highest(turf));
    water.dispose();
    turf.dispose();
  });

  it("kicks debris backwards along the direction of travel", () => {
    const contacts = createHoofContacts();
    // Travelling towards +Z, so debris must end up behind the horse at -Z.
    contacts.strike(0, 0, 0, "sand", false, 1, 16, 0, 1);
    for (let frame = 0; frame < 20; frame += 1) contacts.update(1 / 60, 750);

    const positions = attribute(contacts, "position").array as Float32Array;
    const lives = attribute(contacts, "aLife").array as Float32Array;
    let total = 0;
    let count = 0;
    for (let index = 0; index < lives.length; index += 1) {
      if (lives[index]! <= 0) continue;
      total += positions[index * 3 + 2]!;
      count += 1;
    }

    expect(count).toBeGreaterThan(0);
    expect(total / count).toBeLessThan(0);
    contacts.dispose();
  });

  it("scales the debris with effort rather than emitting a fixed puff", () => {
    const walking = createHoofContacts();
    const galloping = createHoofContacts();
    walking.strike(0, 0, 0, "sand", false, 0.35, 2, 0, 1);
    galloping.strike(0, 0, 0, "sand", false, 1, 16, 0, 1);
    walking.update(1 / 60, 750);
    galloping.update(1 / 60, 750);

    expect(liveCount(galloping)).toBeGreaterThan(liveCount(walking));
    walking.dispose();
    galloping.dispose();
  });
});
