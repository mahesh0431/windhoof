/**
 * Stable simulation actions. Physical keyboard, mouse, touch, and gamepad
 * bindings live outside the simulation and map into this shape.
 */
export interface HorseInputFrame {
  readonly moveX: number;
  readonly moveY: number;
  readonly cameraYaw: number;
  readonly gallopHeld: boolean;
  readonly jumpPressed: boolean;
  readonly callPressed: boolean;
  readonly interactPressed: boolean;
  readonly resetPressed: boolean;
  readonly pausePressed: boolean;
}

export const NEUTRAL_HORSE_INPUT: HorseInputFrame = Object.freeze({
  moveX: 0,
  moveY: 0,
  cameraYaw: 0,
  gallopHeld: false,
  jumpPressed: false,
  callPressed: false,
  interactPressed: false,
  resetPressed: false,
  pausePressed: false,
});

