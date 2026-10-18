// Dev panel seed (F1, dev builds only). main.ts imports this module behind `import.meta.env.DEV`, so release
// builds tree-shake it away; `npm run build && grep -rl devPanel dist` must print nothing. The full panel
// (tuning live-edit, readouts, replay export) is SSP-048 in M1.

/** What the panel can drive: M0 has no vehicle, so a speed slider stands in for Bessie's speed. */
export type DevPanelControls = {
  speedMps: number;
  zoomEnabled: boolean;
};

const PANEL_ID = 'ssp-devPanel';
const MAX_SLIDER_SPEED_MPS = 12;

/** Mounts the panel (hidden until F1). `readout` is polled a few times a second for the status line. */
export function mountDevPanel(controls: DevPanelControls, readout: () => string): void {
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  // System colours via color-scheme: no raw colour values, and none of this ships (CLAUDE.md hard rule 3).
  panel.style.cssText =
    'position:fixed;top:8px;left:8px;z-index:10;display:none;padding:6px 8px;font:12px/1.4 monospace;' +
    'color-scheme:dark;background:Canvas;color:CanvasText;opacity:0.9';

  const speedLabel = document.createElement('label');
  const speed = document.createElement('input');
  speed.type = 'range';
  speed.min = '0';
  speed.max = String(MAX_SLIDER_SPEED_MPS);
  speed.step = '0.1';
  speed.value = String(controls.speedMps);
  const speedValue = document.createElement('span');
  const showSpeed = (): void => {
    speedValue.textContent = ` ${controls.speedMps.toFixed(1)} m/s`;
  };
  speed.addEventListener('input', () => {
    controls.speedMps = Number(speed.value);
    showSpeed();
  });
  speedLabel.append('speed ', speed, speedValue);

  const zoomLabel = document.createElement('label');
  const zoom = document.createElement('input');
  zoom.type = 'checkbox';
  zoom.checked = controls.zoomEnabled;
  zoom.addEventListener('change', () => {
    controls.zoomEnabled = zoom.checked;
  });
  zoomLabel.append(zoom, ' speed zoom (D-01)');

  const status = document.createElement('pre');
  status.style.margin = '4px 0 0';

  panel.append(speedLabel, document.createElement('br'), zoomLabel, status);
  document.body.append(panel);
  showSpeed();

  window.addEventListener('keydown', (event) => {
    if (event.key === 'F1') {
      event.preventDefault();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  });
  window.setInterval(() => {
    if (panel.style.display !== 'none') {
      status.textContent = readout();
    }
  }, 250);
}
