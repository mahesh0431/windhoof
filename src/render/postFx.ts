import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";

/**
 * The finishing pass: colour grade and vignette, on by default.
 *
 * This is deliberately the cheapest tier of post-processing - one render
 * target and one fullscreen shader, no SSAO, no bloom chain, no depth reads.
 * The island runs without post entirely if the player turns it off, and the
 * performance gates are measured against the full pass being on.
 *
 * What the grade does: a touch more saturation and contrast than the raw
 * output, a slightly warm white point, and a soft vignette that holds the eye
 * in the middle of the frame where the horse is. Individually invisible;
 * together they are the difference between "renders" and "looks finished".
 *
 * Colour management: the scene is rendered into the target with the renderer's
 * ACES tone mapping already applied per-material, but WITHOUT the output sRGB
 * transfer, which Three only applies to the canvas. The grade therefore works
 * in linear light - where grading belongs - and applies the sRGB transfer
 * itself as its final step.
 */

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 srgb(vec3 linear) {
    return mix(
      linear * 12.92,
      1.055 * pow(linear, vec3(1.0 / 2.4)) - 0.055,
      step(0.0031308, linear)
    );
  }

  void main() {
    vec3 color = texture2D(tScene, vUv).rgb;

    // Saturation, about the luma the eye actually sees.
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, 1.14);

    // Gentle S-curve contrast about middle grey.
    color = mix(vec3(0.5), color, 1.05);

    // A warm white point: sunlight, not fluorescent light.
    color *= vec3(1.02, 1.0, 0.965);

    // Vignette: wide and soft, so it reads as light falling off rather than
    // as a border. Aspect-corrected so corners darken evenly.
    vec2 centred = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float fall = smoothstep(1.35, 0.45, length(centred));
    color *= mix(0.72, 1.0, fall);

    gl_FragColor = vec4(srgb(max(color, 0.0)), 1.0);
  }
`;

export interface PostFx {
  /** Renders the scene through the grade. Falls back to direct when off. */
  render(scene: Scene, camera: PerspectiveCamera): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export function createPostFx(renderer: WebGLRenderer): PostFx {
  let enabled = true;
  const size = new Vector2();
  const target = new WebGLRenderTarget(1, 1, { samples: 4 });

  // One triangle covering the screen: fewer vertices than a quad and no seam.
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  geometry.setAttribute(
    "uv",
    new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2),
  );
  const material = new ShaderMaterial({
    uniforms: {
      tScene: { value: target.texture },
      uResolution: { value: new Vector2(1, 1) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  const quadScene = new Scene();
  quadScene.add(quad);
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    render(scene, camera) {
      if (!enabled) {
        renderer.render(scene, camera);
        return;
      }
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) {
        target.setSize(size.x, size.y);
        (material.uniforms.uResolution!.value as Vector2).copy(size);
      }
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCamera);
    },
    setEnabled(value) {
      enabled = value;
    },
    dispose() {
      target.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
