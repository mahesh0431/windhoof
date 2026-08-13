import specJson from "../../docs/contracts/world-spec.example.json";
import type { WorldSpec } from "../game/world/compiler/worldTypes";

/**
 * The production vertical-slice world.
 *
 * This is the same authored `WorldSpec` the generation suite compiles, imported
 * rather than copied so the shipped island and the verified island can never be
 * two different worlds. The compiler validates it on the way in, so a bad edit
 * fails loudly at startup instead of rendering something subtly wrong.
 */
export const VERTICAL_SLICE_SPEC = specJson as unknown as WorldSpec;
