export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Pose {
  readonly position: Vec3;
  readonly yaw: number;
}

export const ZERO_VEC3: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function approach(current: number, target: number, maximumDelta: number): number {
  if (current < target) {
    return Math.min(current + maximumDelta, target);
  }

  return Math.max(current - maximumDelta, target);
}

export function wrapRadians(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
}

export function moveAngleTowards(
  current: number,
  target: number,
  maximumDelta: number,
): number {
  const delta = wrapRadians(target - current);
  return wrapRadians(current + clamp(delta, -maximumDelta, maximumDelta));
}

export function horizontalDistanceSquared(left: Vec3, right: Vec3): number {
  const x = left.x - right.x;
  const z = left.z - right.z;
  return x * x + z * z;
}

