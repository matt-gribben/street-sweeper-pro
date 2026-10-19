// Pointer device for menus (GDD §6.1, TECHNICAL_DESIGN §13.2, SSP-286): mouse (and pen) presses and releases on the
// canvas, queued in client (CSS) pixels until a menu scene takes them, once per tick, through
// Actions.takePointer(). The scene maps them to internal pixels with the inverse of the upscale transform
// (render/upscale.ts clientToInternalPx) and hit-tests its menu (src/ui/menus.ts): a press focuses and arms the
// item under it, and the release over the same item selects it. Selecting on `pointerup`, never on 'click', is
// what lets the M8 tap work (SSP-262) reuse the same path.
//
// - Pointer Events only, on the canvas. Only the primary pointer counts, and only the main button (button 0; a
//   touch or a pen tip reports 0 too). pointercancel drops the armed item.
// - Never stopPropagation and never preventDefault: the M5 audio unlock listens for `pointerdown` on the page
//   (TECHNICAL_DESIGN §14), and the browser's own handling of the canvas stays as it is.
// - The queue holds POINTER_QUEUE_LENGTH samples; a sample that arrives with the queue full is dropped (16 presses
//   inside one tick do not happen). Samples are preallocated: queueing and taking allocate nothing.
// - Pointer input never reaches the sim InputFrame: Actions.sampleForTick() never reads it.
// - Activity: a press makes 'keyboard' (keyboard and mouse) the active device (actions.ts). SSP-262 gives touch
//   presses their own kind.

import {
  type InputDeviceKind,
  POINTER_PHASE,
  type PointerPhase,
  type PointerSample,
  type PointerSource,
} from './actions.ts';

/** Samples the queue holds between two ticks. */
export const POINTER_QUEUE_LENGTH = 16;

/** The parts of a PointerEvent the device reads (unit tests pass plain objects). */
export type PointerEventLike = {
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly isPrimary: boolean;
};

/** Where the pointer listens: the canvas in the browser. */
export type PointerEventTarget = {
  addEventListener(
    type: 'pointerdown' | 'pointerup' | 'pointercancel',
    listener: (event: PointerEvent) => void,
  ): void;
  removeEventListener(
    type: 'pointerdown' | 'pointerup' | 'pointercancel',
    listener: (event: PointerEvent) => void,
  ): void;
};

/** Mouse presses and releases on the canvas, for menus. */
export class PointerDevice implements PointerSource {
  readonly kind: InputDeviceKind = 'keyboard';
  private readonly queue: PointerSample[] = Array.from({ length: POINTER_QUEUE_LENGTH }, () => ({
    phase: POINTER_PHASE.Cancel,
    clientX: 0,
    clientY: 0,
  }));
  /** Index of the oldest queued sample, and how many are queued. */
  private head = 0;
  private count = 0;
  private used = false;

  /** Samples waiting to be taken. */
  get queued(): number {
    return this.count;
  }

  /** Listens on `target` (the canvas); returns a function that stops listening. */
  attach(target: PointerEventTarget): () => void {
    const onDown = (event: PointerEvent): void => this.handle(POINTER_PHASE.Down, event);
    const onUp = (event: PointerEvent): void => this.handle(POINTER_PHASE.Up, event);
    const onCancel = (event: PointerEvent): void => this.handle(POINTER_PHASE.Cancel, event);
    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    return () => {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
    };
  }

  /** Queues one pointer event (the listeners call it; tests call it directly). */
  handle(phase: PointerPhase, event: PointerEventLike): void {
    if (!event.isPrimary) return;
    if (phase !== POINTER_PHASE.Cancel && event.button !== 0) return;
    if (phase === POINTER_PHASE.Down) this.used = true;
    if (this.count === POINTER_QUEUE_LENGTH) return;
    const slot = this.queue[(this.head + this.count) % POINTER_QUEUE_LENGTH];
    if (slot === undefined) return;
    slot.phase = phase;
    slot.clientX = event.clientX;
    slot.clientY = event.clientY;
    this.count += 1;
  }

  take(out: PointerSample): boolean {
    if (this.count === 0) return false;
    const slot = this.queue[this.head];
    this.head = (this.head + 1) % POINTER_QUEUE_LENGTH;
    this.count -= 1;
    if (slot === undefined) return false;
    out.phase = slot.phase;
    out.clientX = slot.clientX;
    out.clientY = slot.clientY;
    return true;
  }

  takeActivity(): boolean {
    const used = this.used;
    this.used = false;
    return used;
  }
}
