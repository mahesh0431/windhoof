import { HorseInputBuffer } from "../game/input/horseInputBuffer";
import type { ChaseCamera } from "../render/camera/chaseCamera";

export interface InputBindingHooks {
  /** True only while the player is actually riding. */
  isRiding(): boolean;
  isPointerLocked(): boolean;
  onToggleDiagnostics(): void;
  onLookActivity(): void;
}

export interface InputBindings {
  readonly buffer: HorseInputBuffer;
  readonly gallopHeld: boolean;
  clear(): void;
  detach(): void;
}

/**
 * Physical keys and pointer movement map into the stable action shape here and
 * nowhere else. The simulation never learns that a keyboard exists, which is
 * what will let gamepad and remapping arrive later without touching it.
 */
export function createInputBindings(
  target: HTMLElement,
  camera: ChaseCamera,
  hooks: InputBindingHooks,
): InputBindings {
  const buffer = new HorseInputBuffer();
  const held = new Set<string>();

  const isForward = (code: string) => code === "KeyW" || code === "ArrowUp";
  const isBack = (code: string) => code === "KeyS" || code === "ArrowDown";
  const isLeft = (code: string) => code === "KeyA" || code === "ArrowLeft";
  const isRight = (code: string) => code === "KeyD" || code === "ArrowRight";

  const refreshMove = () => {
    let moveX = 0;
    let moveY = 0;
    for (const code of held) {
      if (isForward(code)) moveY += 1;
      if (isBack(code)) moveY -= 1;
      if (isLeft(code)) moveX -= 1;
      if (isRight(code)) moveX += 1;
    }
    // Normalise so a diagonal is not faster than a straight line.
    const magnitude = Math.hypot(moveX, moveY);
    if (magnitude > 1) {
      moveX /= magnitude;
      moveY /= magnitude;
    }
    buffer.setMove(moveX, moveY);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) {
      if (event.code === "Space") event.preventDefault();
      return;
    }

    switch (event.code) {
      case "Escape":
        buffer.press("pausePressed");
        return;
      case "F3":
        event.preventDefault();
        hooks.onToggleDiagnostics();
        return;
      default:
        break;
    }

    if (!hooks.isRiding()) return;

    switch (event.code) {
      case "Space":
        event.preventDefault();
        buffer.press("jumpPressed");
        return;
      case "KeyC":
        buffer.press("callPressed");
        return;
      case "KeyR":
        buffer.press("resetPressed");
        return;
      case "KeyE":
        buffer.press("interactPressed");
        return;
      case "ShiftLeft":
      case "ShiftRight":
        buffer.setContinuous("gallopHeld", true);
        held.add(event.code);
        return;
      default:
        break;
    }

    if (
      isForward(event.code) ||
      isBack(event.code) ||
      isLeft(event.code) ||
      isRight(event.code)
    ) {
      event.preventDefault();
      held.add(event.code);
      refreshMove();
    }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    held.delete(event.code);
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      if (!held.has("ShiftLeft") && !held.has("ShiftRight")) {
        buffer.setContinuous("gallopHeld", false);
      }
    }
    refreshMove();
  };

  const onMouseMove = (event: MouseEvent) => {
    if (!hooks.isPointerLocked() || !hooks.isRiding()) return;
    camera.look(event.movementX, event.movementY);
    hooks.onLookActivity();
  };

  /**
   * Losing keyboard focus must not leave the horse running. Everything held is
   * released, which also stops a "stuck gallop" the player cannot see the cause
   * of after switching tabs.
   */
  const clear = () => {
    held.clear();
    buffer.clear();
  };
  const onBlur = clear;

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  target.ownerDocument.addEventListener("mousemove", onMouseMove);

  return {
    buffer,
    get gallopHeld() {
      return held.has("ShiftLeft") || held.has("ShiftRight");
    },
    clear,
    detach() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      target.ownerDocument.removeEventListener("mousemove", onMouseMove);
    },
  };
}
