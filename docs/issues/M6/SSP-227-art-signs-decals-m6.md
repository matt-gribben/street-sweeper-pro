---
id: SSP-227
title: "Art Pass 2: shop signs and road decals for the Wed-Sun districts"
milestone: M6
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M]
depends_on: [SSP-210, SSP-204, SSP-209, SSP-212, SSP-215, SSP-150, SSP-110]
blocks: [SSP-233]
---

# SSP-227: Art Pass 2: shop signs and road decals for the Wed-Sun districts

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** M · **Areas:** assets

## Summary

Produce sign.* boards and decal.* ground art for the new districts through Codex goldens and ingest, with all lettering drawn in Kerbside fonts.

## Context

Technique (ASSET_PIPELINE §10.10): Codex golden -> forge ingest -> grid (ingest.json mode sheet, grid [1,1] for one-offs; decals target 32x32). Shop signs: generate the BLANK board only. Lettering is composited at build time from Kerbside glyphs declared in the manifest entry's states; never generated text. Names are invented puns (GDD §18.4 examples: 'Cod Almighty', 'Curl Up & Dye', 'The Codfather's Plaice'). Check every name for real-business collisions before it goes into a prompt. No trademarks, logos or real brands (ipHygiene.test.ts scans prompts and data). Needed: the Promenade arcade row and chip shops; Kebab Mile pubs (The Mucky Duck, The Dog & Dustpan), takeaways and nightclub; Gasworks unit numbers (Units 1-12); Civic Quarter council banners (26). Lit signs on Kebab Mile must write the light mask at night (hook from SSP-210). Decals (oil, posters, graffiti) for Wed-Sun; graffiti must stay rating-safe (PEGI 7) and be wordless or Kerbside-lettered. Review on contact sheets and in-district screenshots with Read. R-03 drift control: pin the Codex CLI version for the whole batch.

## Scope

- prompt.md, goldens, meta.json and ingested grids for each sign board and decal
- Manifest entries with Kerbside lettering states
- Night light-mask flag for lit signs
- Generated outputs

## Out of scope

- Facades
- Landmark roofs

## Acceptance criteria

- [ ] No golden contains generated lettering (Read review notes confirm)
- [ ] ipHygiene.test.ts passes; the PR lists every sign name with a collision-check note
- [ ] assets:lint and assets:verify pass; provenance is complete
- [ ] Contact sheet and in-district screenshots reviewed with Read
- [ ] Lit signs keep day colours under the night remap (Kebab Mile screenshot)

## Verification

- npm run gen:ai -- sign.<id> --candidates 4 (local only)
- npm run assets:ingest -- sign.<id>
- npm run assets && npm run assets:lint && npm run assets:verify
- npm test -- tests/unit/ipHygiene.test.ts
- npm run assets:sheets

## Dependencies

**Depends on:**

- [SSP-210](SSP-210-night-lighting.md) Implement night: night remap with street-lamp and headlight light mask
- [SSP-204](SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-212](SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-150](../M4/SSP-150-shop-signs.md) High Street shop signs: Codex blank boards plus Kerbside lettering
- [SSP-110](../M4/SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

## References

- ../../ASSET_PIPELINE.md#1010-decal-shop-sign-landmark-roof-codex--ingest
- ../../GDD.md#184-naming-and-ip-rules
- ../../ART_BIBLE.md#13-night-weather-and-time-of-day
- ../../../CLAUDE.md#3-hard-rules-non-negotiable

## Roadmap tasks covered

- `All Wed–Sun assets, batched by class, each batch reviewed via contact sheets and the zoo. (signs, decals)`
