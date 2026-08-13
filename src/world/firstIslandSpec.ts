import specJson from "../../docs/contracts/world-spec.first-island.json";
import type { WorldSpecV4 } from "../game/world/compiler/worldTypes";

/**
 * The authored full-island source plan. It compiles independently while the
 * shipped Milestone-4 slice remains frozen and reproducible.
 */
export const FIRST_ISLAND_SPEC = specJson as unknown as WorldSpecV4;
