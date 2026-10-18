// Entry point. M0: the renderer skeleton on a plain requestAnimationFrame loop with no sim (the fixed 60 Hz
// loop in src/app/loop.ts arrives in M1).
import { updateCameraRig } from './render/camera.ts';
import { Renderer } from './render/Renderer.ts';
import { attachUpscaler } from './render/upscale.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (canvas === null) {
  throw new Error('Street Sweeper Pro: #game canvas missing from index.html');
}

// Build stamp for bug reports (TECHNICAL_DESIGN §20.2); the title screen shows it from M4.
canvas.dataset.sspVersion = __SSP_VERSION__;
canvas.dataset.sspCommit = __SSP_COMMIT__;
console.info(`Street Sweeper Pro v${__SSP_VERSION__} (${__SSP_COMMIT__})`);

const renderer = new Renderer(canvas);
attachUpscaler(canvas, (layout) => renderer.resize(layout));

/** Stand-in for Bessie's speed until M1: driven by the dev panel slider, 0 in release builds. */
const drive = { speedMps: 0, zoomEnabled: renderer.rig.zoomEnabled };

if (import.meta.env.DEV) {
  void import('./debug/devPanel.ts').then(({ mountDevPanel }) => {
    mountDevPanel(drive, () => {
      const rig = renderer.rig;
      return [
        `H ${rig.height.value.toFixed(2)} m  W ${rig.internalWidth}  scale ${renderer.upscale}x`,
        `cam ${rig.snappedX.toFixed(4)}, ${rig.snappedZ.toFixed(4)} m  frac ${rig.fractionX.toFixed(3)}, ${rig.fractionY.toFixed(3)} px`,
        `draw calls ${renderer.drawCalls}`,
      ].join('\n');
    });
  });
}

/** Clamp for long gaps (background tab): springs are exact for any dt, but the pan should not jump. */
const MAX_FRAME_DT_S = 0.1;
let focusZ = 0;
let lastMs = -1;

function frame(nowMs: number): void {
  const dtS = lastMs < 0 ? 0 : Math.min(MAX_FRAME_DT_S, (nowMs - lastMs) / 1000);
  lastMs = nowMs;
  // With no vehicle yet, the camera pans north at the slider speed so snap and zoom can be judged in motion.
  focusZ -= drive.speedMps * dtS;
  renderer.rig.zoomEnabled = drive.zoomEnabled;
  updateCameraRig(renderer.rig, 0, focusZ, drive.speedMps, dtS);
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
