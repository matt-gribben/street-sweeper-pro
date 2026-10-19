// Drives a menus.ts Menu from the player's input, one tick at a time (SSP-286): the glue between src/input (the
// menu commands with hold-repeat from menuInput.ts, the canvas pointer queue) and src/ui (the Menu, which knows no
// devices). A menu scene owns one:
//
//   enter()        reset(): drop menu edges and pointer samples latched before the scene showed, and ignore
//                  directions still held from the previous scene until they are released.
//   fixedUpdate()  update(menu): the tick's MENU_* bits become one Menu.command(), then each queued pointer sample
//                  is mapped from client to internal pixels (SceneContext.clientToInternal, the inverse of the
//                  upscale transform) and becomes pointerDown / pointerUp / pointerCancel. update(null) consumes
//                  the tick's input and drops it (the tally's 0.5 s input lock).
//
// Menu input never reaches the sim: the controller reads only Actions' menu side, never the InputFrame
// (TECHNICAL_DESIGN §13.1).
import type { SceneContext } from '../app/Game.ts';
import {
  ACTION,
  type InputDeviceKind,
  type MenuInputSource,
  POINTER_PHASE,
  type PointerSample,
} from '../input/actions.ts';
import { MenuInputSampler } from '../input/menuInput.ts';
import type { InternalPoint } from '../render/upscale.ts';
import { MENU_COMMAND, type Menu } from '../ui/menus.ts';

/** ACTION.MENU_* bits → MENU_COMMAND bits. */
export function menuCommandsFrom(actions: number): number {
  return (
    (actions & ACTION.MENU_UP ? MENU_COMMAND.Up : 0) |
    (actions & ACTION.MENU_DOWN ? MENU_COMMAND.Down : 0) |
    (actions & ACTION.MENU_SELECT ? MENU_COMMAND.Select : 0) |
    (actions & ACTION.MENU_BACK ? MENU_COMMAND.Back : 0)
  );
}

/** One menu scene's input: keyboard and pad commands with hold-repeat, and the mouse. */
export class MenuController {
  private readonly context: SceneContext;
  private readonly input: MenuInputSource;
  private readonly sampler: MenuInputSampler;
  private readonly sample: PointerSample = { phase: POINTER_PHASE.Cancel, clientX: 0, clientY: 0 };
  private readonly point: InternalPoint = { x: 0, y: 0 };

  constructor(context: SceneContext, input: MenuInputSource) {
    this.context = context;
    this.input = input;
    this.sampler = new MenuInputSampler(input);
  }

  /** The kind of device the player used last (prompts pick their glyphs by it). */
  get activeDevice(): InputDeviceKind {
    return this.input.activeDevice;
  }

  /** Drops latched menu input and pointer samples (call from enter()). */
  reset(): void {
    this.sampler.reset();
    while (this.input.takePointer(this.sample)) {
      // dropped: pressed before the scene showed
    }
  }

  /** One tick: commands, then pointer samples, into `menu` (null: consume and drop them). */
  update(menu: Menu | null): void {
    const commands = menuCommandsFrom(this.sampler.sample());
    if (menu !== null && commands !== 0) menu.command(commands);
    const sample = this.sample;
    const point = this.point;
    while (this.input.takePointer(sample)) {
      if (menu === null) continue;
      if (sample.phase === POINTER_PHASE.Cancel) {
        menu.pointerCancel();
        continue;
      }
      const onFrame = this.context.clientToInternal(sample.clientX, sample.clientY, point);
      if (!onFrame) menu.pointerCancel();
      else if (sample.phase === POINTER_PHASE.Down) menu.pointerDown(point.x, point.y);
      else menu.pointerUp(point.x, point.y);
    }
  }
}
