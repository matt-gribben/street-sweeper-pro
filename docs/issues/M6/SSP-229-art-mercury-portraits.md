---
id: SSP-229
title: "Art Pass 2: Mercury newspaper art and portraits for Sid, Doris and the Inspector"
milestone: M6
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:ui, size:M]
depends_on: [SSP-192, SSP-112, SSP-152]
blocks: [SSP-233, SSP-281]
---

# SSP-229: Art Pass 2: Mercury newspaper art and portraits for Sid, Doris and the Inspector

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** M · **Areas:** assets, ui

## Summary

Produce the Codex ai-art one-offs for the Mercury front page and the three remaining 64x64 two-expression portraits.

## Context

Technique (ASSET_PIPELINE §10.11), ai-art: Codex at full resolution -> golden -> crop, pixelize at the detected pseudo-pixel period (about 3-4x), palette map, optional Bayer. ingest.json uses mode art with crop, period_override (null = auto) and dither ('none' or 'bayer4'). There is no grid step: npm run assets rebuilds from the golden every time. Portraits: a 1:1 golden with 2 expressions side by side, ~64x64 art pixels each; IDs portrait.spotless_sid, portrait.doris and portrait.inspector (ART_BIBLE §12.4 proposed, GDD §4.2). The expressions are not specified (Big Pam has briefing and stern). Proposal: a neutral and a reaction pose per character (Sid smug/annoyed, Doris glare/harrumph, Inspector neutral/disapproving); record them. Mercury art: newspaper photo art as `art.*` goldens, Bayer-dithered like halftone (ART_BIBLE §12.4). The docs do not name the IDs; propose e.g. art.mercury_photo_<subject> and add them to the manifest and ART_BIBLE. Masthead lettering is Kerbside, never generated (see SSP-192). Character designs must match the in-game sprites and cast descriptions (Sid smug, immaculate, green-and-white; Doris with handbag and tartan trolley; the Inspector with clipboard and tiny pencil). Review candidates with Read; check mercury_tally and the intro cards at 1080p (4x). No trademarks; the rating guard applies.

## Scope

- prompt.md, goldens, meta.json and ingest.json for the three portraits and the Mercury photo set
- Manifest entries; wire portraits into intro cards and Mercury quotes where used
- Re-approve the mercury_tally golden after reading diffs

## Out of scope

- Mercury layout code
- Big Pam portrait (M4)

## Acceptance criteria

- [ ] Each portrait has 2 expressions at 64x64 each, with complete provenance
- [ ] Mercury photo art renders in the tally with Bayer halftone dither and only Kerbside-32 colours
- [ ] assets:lint and assets:verify pass
- [ ] mercury_tally passes after a Read-reviewed update with a one-line reason
- [ ] No placeholder: true remains for these IDs; ART_BIBLE lists the art.mercury_* IDs

## Verification

- npm run gen:ai -- portrait.doris --candidates 4 (local only)
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run test:visual
- npm run test:visual:update (only after reading diffs)

## Dependencies

**Depends on:**

- [SSP-192](SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-112](../M4/SSP-112-forge-build-ai-art.md) Add the ai-art build technique: crop, pixelize at detected period, palette map
- [SSP-152](../M4/SSP-152-portrait-big-pam.md) portrait.big_pam: 64x64 intro-card portrait with 2 expressions

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag
- [SSP-281](../M9/SSP-281-rival-sweep-flow.md) Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally

## References

- ../../ASSET_PIPELINE.md#1011-title-key-art-intro-cards-mercury-art-portraits-ai-art
- ../../ART_BIBLE.md#124-screens
- ../../GDD.md#42-cast
- ../../GDD.md#153-tally-screen-the-muckleford-mercury

## Roadmap tasks covered

- Mercury art, portraits for the remaining cast (`portrait.spotless_sid`, `portrait.doris`, `portrait.inspector`).
