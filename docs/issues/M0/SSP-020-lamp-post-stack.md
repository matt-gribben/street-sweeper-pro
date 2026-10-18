---
id: SSP-020
title: "Prototype a 4-slice sprite-stack lamp post and add it to lean_quadrants (D-02 input)"
milestone: M0
status: todo
type: spike
estimate: M
labels: [type:spike, area:render, area:assets, size:M, vertical-slice]
depends_on: [SSP-019, SSP-007]
blocks: [SSP-021, SSP-022, SSP-024, SSP-026, SSP-131, SSP-148]
---

# SSP-020: Prototype a 4-slice sprite-stack lamp post and add it to lean_quadrants (D-02 input)

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** spike · **Size:** M · **Areas:** render, assets · **Vertical slice**

## Summary

Build one sprite-stack prop, `prop.lamp_post` with 4 slices, rendered through `spriteStack.ts` in the items batch, to check that the perspective camera leans it the same way as the buildings. It is the key input to D-02, and settles the slice-count and slice-shadow open items.

## Context

Sprite stacks (TECHNICAL_DESIGN §12.5, ART_BIBLE §4.1): 4-8 horizontal slice quads at increasing heights in the items batch. The perspective camera leans them like buildings; flat actors never lean. Slices keep their real heights.
- Cell 32x32 per slice, atlas `items`.
- Frame IDs `prop.lamp_post:slice:-:<k>`, k = 0 at ground, upward.
- prop.lamp_post is a canonical ENTITY_CATALOG ID (blender (proposed), stack). It is a spike-quality asset under its final ID (placeholder-first) and may be redone in M4.

ROADMAP M0 asks for 4 slices; ART_BIBLE §8.6 proposes 8 for the lamp post (01 post, 07 lamp head that writes the light mask at night). Final slice counts are TBD (M0 spike): record the finding.

Technique (choose one and justify in the PR):
- Blender: `--headings 1`, size 128 (4 x 32), moving the camera clip_start/clip_end through height bands to write slice_0..slice_3.png. Exercises the rig and matches the catalog. Needs `forge build` support for slice_<k>.png → `slice:-:<k>`, and wrapper support for prop headings = 1.
- Grid: `frame slice:-:<k>` blocks in `assets-src/sprites/prop/lamp_post.sprite.txt`. Faster, already supported by the grid path.
Either way: add the manifest entry (technique, cell [32,32], states [slice], dirs "-", frames {slice:4}, atlas items, outline true, swaps []), run `npm run assets`, and commit the outputs (the items atlas appears).

Shadows: ART_BIBLE §6.4 proposes that only the lowest and highest slices cast the +2,+2 drop shadow; decide in M0 and record the decision. The night light mask from the lamp head belongs to SSP-021; leave a per-slice flag hook.

Place lamp posts beside the blocks in all four quadrants of lean_quadrants. Check the ART_BIBLE §15.2 item "Sprite-stack slices line up vertically when the camera is centred (no wobbling stack)". The items batch adds 1 draw call (≤ 10 total).

## Scope

- src/render/spriteStack.ts (slices as instances in the items batch at real heights)
- prop.lamp_post source (Blender script or grid), manifest entry, forge support for slices if Blender, committed outputs
- Lamp posts in all four quadrants of lean_quadrants
- Record the slice count and slice-shadow findings in the PR (for SSP-026 / ART_BIBLE §17)

## Out of scope

- Other props
- Light pools (SSP-021)
- Collision shapes (M3)

## Acceptance criteria

- [ ] prop.lamp_post has a manifest entry; its 4 slice frames are in public/assets/atlas/items.json and FRAME; `npm run assets:lint` and `npm run assets:verify` pass
- [ ] In lean_quadrants (frozen, test mode) each lamp post leans outward from screen centre in the same direction as the adjacent buildings (screenshot under build/, opened with Read)
- [ ] With setCamera centred over a lamp post, all slices stack with zero pixel offset
- [ ] renderer.info.render.calls ≤ 10
- [ ] The PR records the technique, slice count, which slices cast shadows and the screenshot paths
- [ ] If Blender was used, `npm run assets:blender -- prop.lamp_post --check` reports 0 changed pixels

## Verification

- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --only prop.lamp_post, then Read build/sheets/only_prop.lamp_post.png
- Open /?test=1&scene=lean_quadrants&freeze=1, capture a screenshot to build/ and Read it

## Dependencies

**Depends on:**

- [SSP-019](SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-007](SSP-007-blender-rig-wrapper.md) Implement assets-src/blender/rig.py and the forge blender wrapper with --check

**Blocks:**

- [SSP-021](SSP-021-night-shadow-tuning.md) Tune night[32] and shadow[32] remap tables in the spike scene (D-05, D-06)
- [SSP-022](SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)
- [SSP-024](SSP-024-look-decisions.md) Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)
- [SSP-026](SSP-026-style-lock.md) Write assets-src/STYLE.md v1 locking scale, palette and people style; mirror ART_BIBLE
- [SSP-131](../M4/SSP-131-blender-props-stacks.md) Blender sprite-stack props: lamp post, phone box, tree, bus shelter, stall
- [SSP-148](../M4/SSP-148-small-props-grids.md) Hand-author small prop grids, including grid sprite stacks

## References

- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../ASSET_PIPELINE.md#75-special-cases
- ../../ASSET_PIPELINE.md#102-volumetric-or-tall-prop-prop-blender--sprite-stack
- ../../ART_BIBLE.md#41-the-camera
- ../../ART_BIBLE.md#86-props
- ../../ART_BIBLE.md#64-shadows
- ../../ART_BIBLE.md#152-the-checklist
- ../../ART_BIBLE.md#17-open-items

## Roadmap tasks covered

- `Sprite-stack prototype with one lamp post (4 slices), to check that its lean matches the building lean (input to D-02).`
