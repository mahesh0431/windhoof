import {
  DirectionalLight,
  Fog,
  HemisphereLight,
  Scene,
  Vector3,
} from "three";
import type { StageWorld } from "../../stage/stageWorld";
import { FOG_FAR, FOG_NEAR, PALETTE, SUN_DIRECTION } from "../palette";
import { createPropsVisual } from "./propsVisual";
import { createSeaVisual, type SeaVisual } from "./seaVisual";
import { createSkyDome } from "./skyDome";
import { createTerrainVisual } from "./terrainVisual";

export interface StageScene {
  readonly scene: Scene;
  readonly sun: DirectionalLight;
  /** Keeps the sky, shadow volume, and water centred on the player. */
  update(elapsedSeconds: number, focusX: number, focusY: number, focusZ: number): void;
  dispose(): void;
}

const SHADOW_RADIUS = 26;

export function createStageScene(stage: StageWorld): StageScene {
  const scene = new Scene();
  scene.fog = new Fog(PALETTE.fog, FOG_NEAR, FOG_FAR);

  const sky = createSkyDome();
  scene.add(sky);

  // Two lights only. A warm low sun for shape and long readable shadows, and a
  // sky/ground hemisphere fill so shadowed terrain still shows its slope.
  // Sun and fill are balanced so shadows read as shape, not as holes. Fully
  // black shade would hide exactly the traversability the terrain colours are
  // there to communicate.
  const sun = new DirectionalLight(PALETTE.sunLight, 2.2);
  sun.position.set(SUN_DIRECTION.x * 60, SUN_DIRECTION.y * 60, SUN_DIRECTION.z * 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 180;
  sun.shadow.camera.left = -SHADOW_RADIUS;
  sun.shadow.camera.right = SHADOW_RADIUS;
  sun.shadow.camera.top = SHADOW_RADIUS;
  sun.shadow.camera.bottom = -SHADOW_RADIUS;
  sun.shadow.bias = -0.0006;
  // Grazing light across near-flat terrain is where acne shows first. Pushed
  // much beyond this and the offset exceeds the radius of a tree trunk, which
  // self-shadows the whole trunk into a black column.
  sun.shadow.normalBias = 0.05;
  // Three does not refresh the shadow projection when the frustum bounds are
  // edited, so without this the light keeps its default ten-metre box and
  // everything past the horse's feet renders as if it were in shadow.
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  const fill = new HemisphereLight(PALETTE.skyLight, PALETTE.bounceLight, 2.05);
  scene.add(fill);

  scene.add(createTerrainVisual(stage.terrain));
  scene.add(createPropsVisual(stage.placedProps));

  const sea: SeaVisual = createSeaVisual();
  scene.add(sea.group);

  const sunOffset = new Vector3(
    SUN_DIRECTION.x,
    SUN_DIRECTION.y,
    SUN_DIRECTION.z,
  ).multiplyScalar(80);

  return {
    scene,
    sun,
    update(elapsedSeconds, focusX, focusY, focusZ) {
      sky.position.set(focusX, 0, focusZ);
      sea.update(elapsedSeconds);

      // The shadow volume is small and follows the horse. Snapping it to whole
      // texels stops shadow edges from crawling while the player rides.
      const texelSize = (SHADOW_RADIUS * 2) / 2048;
      const snappedX = Math.round(focusX / texelSize) * texelSize;
      const snappedZ = Math.round(focusZ / texelSize) * texelSize;
      sun.target.position.set(snappedX, focusY, snappedZ);
      sun.position.set(
        snappedX + sunOffset.x,
        focusY + sunOffset.y,
        snappedZ + sunOffset.z,
      );
      sun.target.updateMatrixWorld();
    },
    dispose() {
      scene.clear();
    },
  };
}
