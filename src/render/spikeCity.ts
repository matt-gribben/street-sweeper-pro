// M0 spike city (SSP-017): the 1-, 3- and 6-storey blocks (2.5 / 7.5 / 15 m) as a cell grid around the origin,
// rendered as the city mesh plus its building shadows: exactly two draw calls. SSP-019 composes these blocks at
// four screen offsets in the lean_quadrants scene; this layout is the dev-build default until then.
//
// With the camera over the origin (30 m × 16.9 m visible at W = 480, north up):
//   - 6 storeys, top-left (x −8..−2, y −4..−2): shows its south and east faces;
//   - 3 storeys, top-right (x 4..10, y −6..−2): south and west faces;
//   - 1 storey, bottom-left (x −12..−6, y 2..6): north and east faces;
//   - bottom-right: a 3-storey block on a 1-storey L (x 4..12, y 2..6), so its south and east walls face lower
//     cells and start at 2.5 m.
// Each block sits on a ring of slab pavement in an asphalt street.
import { Group } from 'three';
import { createCityMesh, mergeBoxes, parseCityGrid } from './cityMesh.ts';
import { createBuildingShadows } from './shadows.ts';

/** The spike layout, one character per 2 m cell (`.` asphalt, `:` slab, digits = storeys); row 0 is north. */
export const SPIKE_CITY_ROWS: readonly string[] = [
  '....................',
  '....................',
  '...........:::::....',
  '.....:::::.:333:....',
  '.....:666:.:333:....',
  '.....:::::.:::::....',
  '...:::::...::::::...',
  '...:111:...:3311:...',
  '...:111:...:1111:...',
  '...:::::...::::::...',
  '....................',
  '....................',
];

/** Sim position of the layout's NW corner: the 40 m × 24 m grid is centred on the origin. */
export const SPIKE_CITY_ORIGIN_M: readonly [x: number, y: number] = [-20, -12];

/** Builds the spike city: the city mesh (render order 0), then the building shadows (render order 1). */
export function createSpikeCity(): Group {
  const grid = parseCityGrid(SPIKE_CITY_ROWS, SPIKE_CITY_ORIGIN_M[0], SPIKE_CITY_ORIGIN_M[1]);
  const city = createCityMesh(grid);
  city.renderOrder = 0;
  const shadows = createBuildingShadows(mergeBoxes(grid));
  // Shadows must follow the city so roofs and walls are already in the depth buffer.
  shadows.renderOrder = 1;
  const group = new Group();
  group.name = 'spikeCity';
  group.add(city, shadows);
  return group;
}
