import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";

export interface RendererBundle {
  readonly renderer: WebGLRenderer;
  readonly camera: PerspectiveCamera;
  resize(): void;
  dispose(): void;
}

/**
 * WebGL 2 with no post-processing, as the architecture requires until the base
 * scene is comfortably inside budget. Device pixel ratio is capped at 1.5 to
 * match the stated performance gate rather than letting a retina display quietly
 * quadruple the fragment cost.
 */
export function createRenderer(canvas: HTMLCanvasElement): RendererBundle {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    stencil: false,
  });

  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap is deprecated in this Three version and silently falls
  // back to PCF anyway; asking for it directly keeps the console clean.
  renderer.shadowMap.type = PCFShadowMap;

  const camera = new PerspectiveCamera(62, 1, 0.15, 1600);

  const resize = () => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };

  resize();

  return {
    renderer,
    camera,
    resize,
    dispose() {
      renderer.dispose();
    },
  };
}
