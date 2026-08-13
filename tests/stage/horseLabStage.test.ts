import { describe, expect, it } from "vitest";
import {
  STAGE_BOUNDARY_RADIUS,
  STAGE_HALF_EXTENT,
  STAGE_PROPS,
  STAGE_SPAWN,
  STAGE_WATER_LEVEL,
  stageHeightAt,
  stageSlopeDegrees,
  stageStreamDepthAt,
  stageSurfaceAt,
} from "../../src/stage/horseLabStage";
import { buildStageTerrainMesh } from "../../src/stage/stageTerrainMesh";
import { DEFAULT_HORSE_TUNING } from "../../src/game/simulation/horse/horseTuning";
import { DEFAULT_RAPIER_HORSE_OPTIONS } from "../../src/physics/rapierHorseMotionResolver";

const CLIMB_LIMIT_DEGREES = DEFAULT_RAPIER_HORSE_OPTIONS.maximumClimbDegrees;

/** Horizontal distance a jump covers at a given speed, from the shared tuning. */
function jumpRange(speed: number): number {
  const { jumpVelocity, gravity } = DEFAULT_HORSE_TUNING;
  return speed * ((2 * jumpVelocity) / gravity);
}

describe("Horse Lab stage terrain", () => {
  it("produces finite heights everywhere in the mesh", () => {
    for (let x = -STAGE_HALF_EXTENT; x <= STAGE_HALF_EXTENT; x += 4) {
      for (let z = -STAGE_HALF_EXTENT; z <= STAGE_HALF_EXTENT; z += 4) {
        expect(Number.isFinite(stageHeightAt(x, z))).toBe(true);
      }
    }
  });

  it("is deterministic", () => {
    expect(stageHeightAt(12.5, -33.25)).toBe(stageHeightAt(12.5, -33.25));
    expect(buildStageTerrainMesh().positions[5000]).toBe(
      buildStageTerrainMesh().positions[5000],
    );
  });

  it("spawns the horse on gentle, dry, grounded ground", () => {
    const slope = stageSlopeDegrees(STAGE_SPAWN.x, STAGE_SPAWN.z);
    expect(slope).toBeLessThan(10);
    expect(stageHeightAt(STAGE_SPAWN.x, STAGE_SPAWN.z)).toBeGreaterThan(
      STAGE_WATER_LEVEL + 0.5,
    );
    expect(stageSurfaceAt(STAGE_SPAWN.x, STAGE_SPAWN.z)).toBe("grass");
  });

  it("keeps the gallop corridor rideable from spawn to the stream", () => {
    for (let z = STAGE_SPAWN.z; z <= -8; z += 2) {
      expect(stageSlopeDegrees(0, z)).toBeLessThan(CLIMB_LIMIT_DEGREES);
    }
  });

  it("gives the corridor enough length for a full gallop to develop", () => {
    // Reaching gallop from a standstill needs roughly speed^2 / (2 * accel).
    const { gallopSpeed, gallopAcceleration } = DEFAULT_HORSE_TUNING;
    const runUp = (gallopSpeed * gallopSpeed) / (2 * gallopAcceleration);
    const corridorLength = -8 - STAGE_SPAWN.z;
    expect(corridorLength).toBeGreaterThan(runUp);
  });
});

/** Span, in metres, where the trench is deep enough to stop a horse. */
function trenchWidthAt(x: number): number {
  let width = 0;
  for (let z = -10; z <= 24; z += 0.05) {
    if (stageStreamDepthAt(x, z) > 0.6) width += 0.05;
  }
  return width;
}

/** Deepest point of the stream at a given easting; the channel meanders. */
function deepestAt(x: number): number {
  let deepest = 0;
  for (let z = -10; z <= 24; z += 0.05) {
    deepest = Math.max(deepest, stageStreamDepthAt(x, z));
  }
  return deepest;
}

describe("stream crossing", () => {
  it("cuts a real trench out on the flanks", () => {
    expect(deepestAt(-30)).toBeGreaterThan(1.5);
    expect(deepestAt(30)).toBeGreaterThan(1.5);
  });

  it("is narrow enough to clear with a jump at canter, not only at gallop", () => {
    const { canterSpeed, gallopSpeed } = DEFAULT_HORSE_TUNING;
    const width = trenchWidthAt(-30);

    // Wide enough to be a real obstacle...
    expect(width).toBeGreaterThan(3);
    // ...and inside a canter jump with margin, so careful riding is rewarded
    // rather than requiring maximum speed.
    expect(width).toBeLessThan(jumpRange(canterSpeed) * 0.9);
    expect(jumpRange(gallopSpeed)).toBeGreaterThan(width * 1.8);
  });

  /**
   * The gate that the first version of this stage failed. A trench narrow
   * enough to jump has walls the horse cannot climb, so if the deep section sat
   * on the gallop corridor the opening minute ended with the player stuck in a
   * ditch. The straight-ahead line must be rideable.
   */
  it("keeps the corridor crossing shallow and rideable", () => {
    expect(deepestAt(0)).toBeLessThan(0.75);
    for (let z = -6; z <= 18; z += 0.5) {
      expect(stageSlopeDegrees(0, z)).toBeLessThan(CLIMB_LIMIT_DEGREES);
    }
    expect(trenchWidthAt(0)).toBe(0);
  });

  it("leaves the ford wide enough to find at speed", () => {
    for (const x of [-6, -3, 0, 3, 6]) {
      expect(trenchWidthAt(x)).toBe(0);
    }
  });
});

describe("readability of difficult ground", () => {
  /** Steepest sample along the bank's western flank, where the horse arrives. */
  function steepestBankSample(): { x: number; z: number; slope: number } {
    let best = { x: 0, z: -22, slope: 0 };
    for (let x = 50; x <= 66; x += 0.25) {
      const slope = stageSlopeDegrees(x, -22);
      if (slope > best.slope) best = { x, z: -22, slope };
    }
    return best;
  }

  it("makes the steep bank genuinely unclimbable", () => {
    expect(steepestBankSample().slope).toBeGreaterThan(CLIMB_LIMIT_DEGREES);
  });

  it("shows unclimbable ground as rock rather than grass", () => {
    const steepest = steepestBankSample();
    expect(stageSurfaceAt(steepest.x, steepest.z)).toBe("rock");
  });

  it("keeps the overlook knoll rideable", () => {
    for (let offset = 4; offset <= 30; offset += 2) {
      expect(stageSlopeDegrees(-58 + offset, 58)).toBeLessThan(CLIMB_LIMIT_DEGREES);
    }
  });

  it("drops off the plateau's north face hard enough to stumble", () => {
    const top = stageHeightAt(-6, 32);
    const bottom = stageHeightAt(-6, 38);
    const fall = top - bottom;
    const impactSpeed = Math.sqrt(2 * DEFAULT_HORSE_TUNING.gravity * fall);
    expect(impactSpeed).toBeGreaterThan(DEFAULT_HORSE_TUNING.hardLandingSpeed);
  });
});

describe("stage boundary", () => {
  it("keeps the collision boundary inside the terrain mesh", () => {
    expect(STAGE_BOUNDARY_RADIUS).toBeLessThan(STAGE_HALF_EXTENT);
  });

  it("has continuous ground everywhere the horse can reach", () => {
    // A galloping player must never run out of terrain. Every point inside the
    // boundary ring needs ground, and it must not be a bottomless drop.
    for (let angle = 0; angle < Math.PI * 2; angle += 0.15) {
      for (let radius = 0; radius <= STAGE_BOUNDARY_RADIUS; radius += 4) {
        const height = stageHeightAt(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
        );
        expect(height).toBeGreaterThan(-4);
        expect(height).toBeLessThan(20);
      }
    }
  });

  it("stops the player at the wet shoreline before deep water", () => {
    let maximumDepth = -Infinity;
    for (let angle = 0; angle < Math.PI * 2; angle += 0.05) {
      const bed = stageHeightAt(
        Math.cos(angle) * STAGE_BOUNDARY_RADIUS,
        Math.sin(angle) * STAGE_BOUNDARY_RADIUS,
      );
      maximumDepth = Math.max(maximumDepth, STAGE_WATER_LEVEL - bed);
    }
    expect(maximumDepth).toBeLessThan(0.35);
  });
});

describe("stage props", () => {
  it("has stable unique ids", () => {
    const ids = new Set(STAGE_PROPS.map((prop) => prop.id));
    expect(ids.size).toBe(STAGE_PROPS.length);
  });

  it("places every prop inside the reachable plot", () => {
    for (const prop of STAGE_PROPS) {
      expect(Math.hypot(prop.x, prop.z)).toBeLessThan(STAGE_HALF_EXTENT);
      expect(Number.isFinite(stageHeightAt(prop.x, prop.z))).toBe(true);
    }
  });

  it("leaves the spawn clear so the first seconds are unobstructed", () => {
    for (const prop of STAGE_PROPS) {
      const distance = Math.hypot(prop.x - STAGE_SPAWN.x, prop.z - STAGE_SPAWN.z);
      expect(distance).toBeGreaterThan(6);
    }
  });

  /**
   * The ridden line is the whole spine of the lab, not just the run-up to the
   * stream. An earlier version of this test stopped at z = -14 and passed while
   * a scatter rock sat at (-1.5, 14.2), squarely on the plateau ramp; browser
   * inspection found the horse parked against it with the tour timing out.
   */
  it("keeps the whole ridden line free of stopping obstacles at its centre", () => {
    // Shrubs and markers do not collide, and logs are deliberately on the line
    // because clearing one is the point of putting it there. What must never
    // sit on the centre is something the horse can only stop against.
    const stopping = new Set(["rock", "boulder", "tree"]);
    const blocking = STAGE_PROPS.filter(
      (prop) =>
        stopping.has(prop.kind) &&
        Math.abs(prop.x) < 2 &&
        prop.z > STAGE_SPAWN.z &&
        prop.z < 32,
    );
    expect(blocking.map((prop) => `${prop.id} (${prop.x}, ${prop.z})`)).toEqual([]);
  });
});

describe("terrain mesh", () => {
  it("shares one vertex buffer between the visual and the collider", () => {
    const mesh = buildStageTerrainMesh();
    const side = mesh.segments + 1;
    expect(mesh.positions.length).toBe(side * side * 3);
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect(mesh.triangleCount).toBe(mesh.segments * mesh.segments * 2);
  });

  it("indexes only existing vertices", () => {
    const mesh = buildStageTerrainMesh();
    const vertexCount = mesh.positions.length / 3;
    let maximum = 0;
    for (const index of mesh.indices) maximum = Math.max(maximum, index);
    expect(maximum).toBeLessThan(vertexCount);
  });

  it("samples the same analytic field the game logic uses", () => {
    const mesh = buildStageTerrainMesh();
    const side = mesh.segments + 1;
    for (const [ix, iz] of [
      [10, 10],
      [64, 64],
      [100, 30],
    ] as const) {
      const offset = (iz * side + ix) * 3;
      const x = mesh.positions[offset]!;
      const z = mesh.positions[offset + 2]!;
      expect(mesh.positions[offset + 1]).toBeCloseTo(stageHeightAt(x, z), 6);
    }
  });
});
