// Entry point. M0: the renderer (world MRT pass, palette pass, upscale blit) on a plain requestAnimationFrame
// loop with no sim (the fixed 60 Hz loop in src/app/loop.ts arrives in M1).
import { Group, type Object3D } from 'three';
import { updateCameraRig } from './render/camera.ts';
import { Renderer } from './render/Renderer.ts';
import { createSpikeCity } from './render/spikeCity.ts';
import { createTestWorld } from './render/testWorld.ts';
import { attachUpscaler } from './render/upscale.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (canvas === null) {
  throw new Error('Street Sweeper Pro: #game canvas missing from index.html');
}

// Build stamp for bug reports (TECHNICAL_DESIGN §20.2); the title screen shows it from M4.
canvas.dataset.sspVersion = __SSP_VERSION__;
canvas.dataset.sspCommit = __SSP_COMMIT__;
console.info(`Street Sweeper Pro v${__SSP_VERSION__} (${__SSP_COMMIT__})`);

// World pass content: the SSP-017 spike city (1/3/6-storey blocks and their shadows). Dev builds can pick another
// world with `?world=`: `palette_test` is the SSP-016 palette test world (tools/spikes/swiftShaderPalettePass.ts)
// and `empty` draws nothing, the baseline for draw-call deltas (tools/spikes/spikeCityFrame.ts). Release builds
// always get the city, and the alternatives are tree-shaken away.
function createWorld(): Object3D {
  if (import.meta.env.DEV) {
    const choice = new URLSearchParams(window.location.search).get('world');
    if (choice === 'palette_test') return createTestWorld();
    if (choice === 'empty') return new Group();
  }
  return createSpikeCity();
}
const renderer = new Renderer(canvas, createWorld());
attachUpscaler(canvas, (layout) => renderer.resize(layout));

/** Stand-in for Bessie's speed until M1: driven by the dev panel slider, 0 in release builds. */
const drive = { speedMps: 0, zoomEnabled: renderer.rig.zoomEnabled, night: false };

if (import.meta.env.DEV) {
  void import('./debug/devPanel.ts').then(({ mountDevPanel }) => {
    mountDevPanel(drive, () => {
      const rig = renderer.rig;
      return [
        `H ${rig.height.value.toFixed(2)} m  W ${rig.internalWidth}  scale ${renderer.upscale}x`,
        `cam ${rig.snappedX.toFixed(4)}, ${rig.snappedZ.toFixed(4)} m  frac ${rig.fractionX.toFixed(3)}, ${rig.fractionY.toFixed(3)} px`,
        `draw calls ${renderer.drawCalls} (world + palette + blit)  night ${renderer.night ? 'on' : 'off'}`,
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
  renderer.night = drive.night;
  updateCameraRig(renderer.rig, 0, focusZ, drive.speedMps, dtS);
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
