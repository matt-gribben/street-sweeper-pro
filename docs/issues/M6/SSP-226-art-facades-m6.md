---
id: SSP-226
title: "Art Pass 2: facade module sets for every remaining building style"
milestone: M6
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, size:L]
depends_on: [SSP-204, SSP-206, SSP-209, SSP-212, SSP-215, SSP-197, SSP-210, SSP-111, SSP-125, SSP-126]
blocks: [SSP-233]
---

# SSP-226: Art Pass 2: facade module sets for every remaining building style

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** L · **Areas:** assets

## Summary

Author the 32x40 facade module grids and procedural sets for every Wed-Sun building style, replacing the placeholder facades the new districts use.

## Context

Technique (ASSET_PIPELINE §10.9, ART_BIBLE §9.4): draw 32x40 module grids in assets-src/sprites/facade/<name>.sprite.txt using base ramp values only, and reference them from assets-src/procedural/facades/<set>.json. The forge derives `_lit` (N/W faces) and `_dark` (E/S faces) by ramp shift. Styles needed (LEVEL_DESIGN §5.3-5.8, ART_BIBLE §5.5):
- Gasworks: industrial units (29 teal cladding, greys 03/04/05) and 6-storey tower blocks
- Conker Hill: 1930s semis (11 pantiles, gardens)
- Promenade: arcades and seafront shops (saturated 20/16/29)
- Kebab Mile: pubs, takeaways and nightclub, with lit-window modules for night (interior 16 lemon + 11 curtain stripe)
- Civic Quarter: civic stone (06/07), library, museum, chapel and Town Hall walls
- Depot Yard: facade.depot_shed and facade.workshop
Low-frequency rule for 4+ storeys: features at least 2 px, because magnification reaches ~1.91x at 6 storeys. Replace every placeholder facade ID added by the district issues, keeping the IDs stable. Check lean in lean_quadrants and in each district at 1080p (4x).

## Scope

- Module grids and facade set JSON for each style
- Lit-window modules for night
- Manifest updates removing placeholder facade entries
- Generated outputs; lean_quadrants/zoo goldens re-approved if changed

## Out of scope

- Shop signs (SSP-227)
- Landmark roofs

## Acceptance criteria

- [ ] Every facade.* referenced by the seven M6 levels is non-placeholder
- [ ] Modules use only base ramp values, and _lit/_dark are derived (forge lint passes)
- [ ] assets:verify passes, and npm run levels still compiles all districts
- [ ] Contact sheet, lean_quadrants and a frozen screenshot of each district reviewed with Read
- [ ] Lit windows stay lit under the night remap in Kebab Mile (screenshot)

## Verification

- npm run assets && npm run assets:lint && npm run assets:verify
- npm run levels
- npm run assets:sheets
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-204](SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-212](SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-197](SSP-197-depot-yard-level.md) Author and compile district.depot_yard with all seven Skip Run variants
- [SSP-210](SSP-210-night-lighting.md) Implement night: night remap with street-lamp and headlight light mask
- [SSP-111](../M4/SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-125](../M4/SSP-125-facades-old-town.md) Old Town terrace facade modules and the pledge rosette (Puddle Lane)
- [SSP-126](../M4/SSP-126-facades-high-street.md) High Street shopfront facade modules and facade sets

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

## References

- ../../ASSET_PIPELINE.md#109-facade-module-grid--procedural-assembly
- ../../ART_BIBLE.md#94-facades
- ../../ART_BIBLE.md#55-district-colour-keys
- ../../ART_BIBLE.md#13-night-weather-and-time-of-day

## Roadmap tasks covered

- `All Wed–Sun assets, batched by class, each batch reviewed via contact sheets and the zoo. (facades)`
