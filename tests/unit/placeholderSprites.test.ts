// SSP-101: every M3 knockable, hazard and power-up, and every map character the M3 maps use, resolves to generated
// frames (ENTITY_CATALOG §9, §10, §12; ART_BIBLE §7.1, §8.5–8.7, §9.1; LEVEL_DESIGN §8.3). The props are placeholder
// grids under their final IDs: `flat:-:0`, or a stack `slice:-:0..n−1` with the STYLE.md v1 §8 slice count; hazards
// are 32×32 world-atlas decals or tile variants (`v:-:n`); power-ups are 16×16 items-atlas `bob:-:0`/`bob:-:1`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FRAME } from '../../src/gen/assets.ts';
import { GROUND_TILE_ASSET } from '../../src/render/groundLayer.ts';
import { HAZARD_ENTITY_IDS, KNOCKABLE_IDS, POWERUP_IDS, STATIC_PROP_IDS } from '../../src/sim/entities.ts';
import { DEFAULT_ENTITIES } from '../../src/sim/tuning.ts';
import { DEFAULT_LEGEND, GROUNDS, type LegendDef, START_CHAR } from '../../tools/levels/compile-level.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Frames `<asset>:<state>:-:0..` that exist, in order (contiguous from 0). */
function framesOf(asset: string, state: string): string[] {
  const out: string[] = [];
  for (let n = 0; Object.hasOwn(FRAME, `${asset}:${state}:-:${n}`); n++) out.push(`${asset}:${state}:-:${n}`);
  return out;
}

function frame(id: string): (typeof FRAME)[keyof typeof FRAME] {
  if (!Object.hasOwn(FRAME, id)) throw new Error(`missing frame ${id}`);
  return FRAME[id as keyof typeof FRAME];
}

/**
 * Render per prop (ENTITY_CATALOG §9, slice counts locked in STYLE.md v1 §8): `flat`, or the stack's slice count.
 * `prop.lamp_post` is the 4-slice M0 prototype until SSP-131 renders its locked 8 slices.
 */
const PROP_RENDER: Readonly<Record<string, 'flat' | number>> = {
  'prop.wheelie_bin': 4,
  'prop.traffic_cone': 4,
  'prop.a_board': 4,
  'prop.shopping_trolley': 'flat',
  'prop.recycling_box': 'flat',
  'prop.lamp_post': 4,
  'prop.bollard': 4,
  'prop.bench': 'flat',
  'prop.bus_shelter': 8,
  'prop.phone_box': 4,
  'prop.post_box': 4,
  'prop.hydrant': 'flat',
  'prop.tree': 8,
  'prop.planter': 'flat',
  'prop.market_stall': 8,
  'prop.litter_bin': 4,
  'prop.roadworks_barrier': 4,
};

/** The frames a prop draws with: its flat frame or its slices. */
function propFrames(asset: string): string[] {
  const flat = framesOf(asset, 'flat');
  return flat.length > 0 ? flat : framesOf(asset, 'slice');
}

describe('M3 prop, hazard and power-up sprites (SSP-101)', () => {
  it('draws every knockable and static prop under its entity sprite ID, in the items atlas at 32×32', () => {
    const props = [
      ...KNOCKABLE_IDS.map((id) => DEFAULT_ENTITIES.knockables[id]),
      ...STATIC_PROP_IDS.map((id) => DEFAULT_ENTITIES.staticProps[id]),
    ];
    expect(props).toHaveLength(17);
    for (const entity of props) {
      const render = PROP_RENDER[entity.sprite];
      expect(render, entity.sprite).toBeDefined();
      const frames = render === 'flat' ? framesOf(entity.sprite, 'flat') : framesOf(entity.sprite, 'slice');
      expect(frames, entity.sprite).toHaveLength(render === 'flat' ? 1 : (render ?? 0));
      for (const id of frames) {
        const f = frame(id);
        expect([f.atlas, f.w, f.h, f.px, f.py], id).toEqual(['items', 32, 32, 16, 16]);
      }
    }
  });

  it('draws every hazard entity as 32×32 world-atlas variants; broken glass has its 2-frame glint', () => {
    for (const id of HAZARD_ENTITY_IDS) {
      const sprite = DEFAULT_ENTITIES.hazards[id].sprite;
      const frames = framesOf(sprite, 'v');
      expect(frames.length, sprite).toBeGreaterThan(0);
      for (const f of frames.map(frame)) expect([f.atlas, f.w, f.h]).toEqual(['world', 32, 32]);
    }
    expect(framesOf('haz.broken_glass', 'v')).toHaveLength(2);
  });

  it('draws all six power-ups as 16×16 items-atlas bob pairs', () => {
    for (const id of POWERUP_IDS) {
      const sprite = DEFAULT_ENTITIES.powerups[id].sprite;
      expect(framesOf(sprite, 'bob'), sprite).toEqual([`${sprite}:bob:-:0`, `${sprite}:bob:-:1`]);
      for (const f of framesOf(sprite, 'bob').map(frame))
        expect([f.atlas, f.w, f.h]).toEqual(['items', 16, 16]);
    }
  });
});

/**
 * What a legend character draws (ART_BIBLE §9.1 "Ground → tile" and "Sites and features"): its ground tile, its
 * prop, site or hazard sprite.
 */
function resolveLegend(def: LegendDef): string[] {
  const out: string[] = [];
  if (def.ground !== undefined) {
    const tile = GROUND_TILE_ASSET[GROUNDS[def.ground].id];
    if (tile === null || tile === undefined) throw new Error(`ground ${def.ground} has no tile`);
    out.push(`${tile}:v:-:0`);
  }
  if (def.prop !== undefined) out.push(propFrames(def.prop)[0] ?? `${def.prop}: no flat or slice frame`);
  if (def.haz !== undefined) out.push(`${def.haz}:v:-:0`);
  if (def.site === 'site.zebra' || def.site === 'site.school_crossing') out.push('tile.zebra:v:-:0');
  else if (def.site === 'site.skip' || def.site === 'site.depot_bay') out.push(`${def.site}:flat:-:0`);
  if (def.mark === 'parking_bay') out.push('tile.parking_bay:v:-:0');
  return out;
}

/**
 * The characters High Street will use (LEVEL_DESIGN §5.2, authored by SSP-105): roads and the one-way Station Road
 * loop, pavements, the cobbled Market Square, ginnels, the depot apron and bays, zebras, bus stops, loading bays,
 * dropped kerbs, and the A-board/litter bin/planter pavements with bus shelters, stall pitches, benches, phone and
 * post boxes, bollards, lamp posts, hydrants, skips and low walls.
 */
const HIGH_STREET_PLANNED = '#><.:;+zbpd$shlnufqi!gmw';

describe('M3 map characters (SSP-101)', () => {
  const puddleLane = readFileSync(`${REPO_ROOT}assets-src/levels/puddle_lane.map.txt`, 'utf8');
  const used = new Set([...puddleLane.replace(/\n/g, ''), ...HIGH_STREET_PLANNED]);

  it('resolves every legend character Puddle Lane and the planned High Street use to existing frames', () => {
    const checked: string[] = [];
    for (const char of [...used].sort()) {
      if (/[A-Z0-9]/.test(char) || char === START_CHAR) continue; // buildings (facade + roof), anchors, the start
      const def = DEFAULT_LEGEND[char];
      expect(def, `legend ${JSON.stringify(char)}`).toBeDefined();
      if (def === undefined) continue;
      // Walls, hedges and railings are solid cells that draw their inherited ground (ART_BIBLE §9.1); the
      // ground-inheritance rule means they always land on some ground tile, which the ground characters cover.
      if (def.solid === true) continue;
      const frames = resolveLegend(def);
      expect(frames.length, `legend ${JSON.stringify(char)}`).toBeGreaterThan(0);
      for (const id of frames)
        expect(Object.hasOwn(FRAME, id), `legend ${JSON.stringify(char)} → ${id}`).toBe(true);
      checked.push(char);
    }
    expect(checked).toEqual(
      expect.arrayContaining([':', 'u', 'g', 'm', 'n', 'f', 'q', 'i', '!', 'l', 't', 'h']),
    );
  });

  it('draws cobbles with their own tile, not the setts fallback', () => {
    expect(resolveLegend(DEFAULT_LEGEND[':'] ?? {})).toEqual(['tile.cobbles:v:-:0']);
    expect(framesOf('tile.cobbles', 'v')).toHaveLength(4);
  });

  it('has a sprite for every prop the default legend names', () => {
    for (const def of Object.values(DEFAULT_LEGEND)) {
      if (def.prop !== undefined) expect(propFrames(def.prop).length, def.prop).toBeGreaterThan(0);
    }
  });
});
