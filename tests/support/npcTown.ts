// A hand-built open district for NPC tests (SSP-080): `tiles` × `tiles` of open road with a pavement nav graph
// laid as a square grid of nodes every NAV_STEP_M metres, starting at the first tile centre (1 m). The edge
// nodes are the portals, every interior node with an even column and row is a door (the spawner's other spawn
// points; their frontage ids are made up, there are no frontages) and there is one anchor (`1` = `home`, the
// node nearest the map centre).
// Bessie starts at the centre facing north. The NPC spawn spec is whatever the caller passes (merged over an
// empty one), as the compiler would emit it (SSP-077): mix and caps sorted by id, named anchors and routes as
// nav node indices.
import { TILE_M } from '../../src/sim/constants.ts';
import {
  buildNavGraph,
  createBlankLevel,
  Ground,
  type Level,
  type NpcSpawn,
  surfaceOfGround,
} from '../../src/sim/map.ts';

/** Spacing of the nav grid, metres. */
export const NAV_STEP_M = 8;

export type NpcTown = {
  level: Level;
  /** Nav grid nodes per side. */
  side: number;
  /** The node index at grid column c, row r. */
  node: (c: number, r: number) => number;
  /** The anchor node (`1` = `home`). */
  home: number;
};

export function npcTown(tiles: number, npc: Partial<NpcSpawn>): NpcTown {
  const level = createBlankLevel('test.npc_town', tiles, tiles);
  level.layers.ground.fill(Ground.Road);
  level.layers.surface.fill(surfaceOfGround(Ground.Road));
  const sizeM = tiles * TILE_M;
  const side = Math.floor((sizeM - 2) / NAV_STEP_M) + 1;
  const node = (c: number, r: number): number => r * side + c;
  const nodes: [number, number][] = [];
  for (let r = 0; r < side; r++)
    for (let c = 0; c < side; c++) nodes.push([1 + c * NAV_STEP_M, 1 + r * NAV_STEP_M]);
  const edges: [number, number, number][] = [];
  const portals: number[] = [];
  const doors: { frontage: string; node: number }[] = [];
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      const i = node(c, r);
      if (c + 1 < side) edges.push([i, i + 1, 0]);
      if (r + 1 < side) edges.push([i, i + side, 0]);
      if (r === 0 || c === 0 || r === side - 1 || c === side - 1) portals.push(i);
      else if (c % 2 === 0 && r % 2 === 0) doors.push({ frontage: `fr_${c}_${r}`, node: i });
    }
  }
  const mid = Math.floor(side / 2);
  const home = node(mid, mid);
  level.nav = buildNavGraph(
    { nodes, edges, portals, doors, anchors: [{ char: '1', name: 'home', node: home }] },
    tiles,
    tiles,
  );
  level.npc = { population: [], mix: [], caps: [], named: [], perches: null, flocks: [], ...npc };
  level.player = { x: sizeM / 2, y: sizeM / 2, heading: 0 };
  return { level, side, node, home };
}
