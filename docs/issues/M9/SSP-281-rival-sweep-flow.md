---
id: SSP-281
title: "Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally"
milestone: M9
status: todo
type: feature
estimate: L
labels: [type:feature, area:gameplay, area:ui, area:save, area:audio, area:test, area:docs, size:L]
depends_on: [SSP-275, SSP-280, SSP-192, SSP-229, SSP-208, SSP-186, SSP-156, SSP-142, SSP-143, SSP-144, SSP-237, SSP-235]
blocks: [SSP-282, SSP-283]
---

# SSP-281: Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** feature · **Size:** L · **Areas:** gameplay, ui, save, audio, test, docs

## Summary

Make Rival Sweep playable end to end: from the Title, pick an unlocked district, see Sid's intro card, then play a 180 s duel with both sweepers' LU dumped on the HUD. A Mercury tally declares the winner and the record is saved locally.

## Context

**Rules and cast.** GDD §13.5: 'Versus Spotless Sid in a chosen district for 180 s. Winner is whoever dumps the most LU.' Cast (GDD §4.2): Sid is from Snobbington; smug, immaculate, green-and-white sweeper. Pam bark sample (GDD §18.3): 'Snobbington's laughing at us, rookie.' The intro card uses Sid's portrait (64×64, 2 expressions; ROADMAP §5.1 makes it real in M6). ART_BIBLE §12.4 proposes the ID `portrait.spotless_sid`: use whatever ID M6 committed to the manifest.

**Timer and audio.** The 180 s timer comes from mode tuning (SSP-275). The lead stem enters under 60 s remaining, i.e. at 120 s elapsed (AUDIO_DESIGN §9.1). Music reuses the district song (AUDIO_DESIGN §15.1). Jingles: `jng.tally`, `jng.sacked`, `jng.towed`. No new audio assets.

**HUD.** GDD §15.2 and ART_BIBLE §12 rules apply: internal pixel space, 4 px safe margin, Kerbside 5×7 and Bold 8×8 for headlines, 9-slice panels, palette names not hex, and 'the road ahead of Bessie is sacred'. Add a two-value LU-dumped readout (player vs Sid). Its placement isn't specified, so propose one (e.g. under the score, top-centre) and record it in GDD §15.2. Optional: an off-screen arrow to Sid.

**Scenes.** Title → Rival Sweep → district picker → ShiftIntroScene → ShiftScene → TallyScene. Tally exits are 'Rematch' and 'Title' (no Skip Run, Workshop or Week Map). Pause → Retire returns to Title.

**Open questions.** Propose, get the lead's OK, and record in GDD §13.5:
- Districts. Proposed: any unlocked campaign district, never `district.depot_yard`. In Friday's Promenade the `rival_cameo` event is suppressed, so there is only one Sid.
- Other district events. Proposed: they run unchanged.
- Ties. Proposed: a draw.
- SACKED/TOWED. Proposed: still apply and count as a loss.
- Assists (GDD §17.1). Proposed: +60 s doesn't apply (as decided in SSP-275); Chill Shift and the 'instant dump' access option apply, with a tally stamp. Accessibility is never locked out.
- Workshop upgrades. Proposed: the player's loadout applies, and Sid stays at base.
- £ and stars. Proposed: none.
- Save. Proposed: `rival.<districtId> {wins, losses, draws, bestLu}` in ssp.save.v1, written at tally.

**Tally.** TallyScene Mercury variant with a result headline from a small new pool. Lines are British English with no trademarks, and Sid is the butt of the joke without anyone getting hurt (PEGI 7). Also show both LU totals and 'Pinched by Sid'.

**Visual test.** CLAUDE.md §7 asks for a visual scene when adding a visual feature. Propose `hud_rival` (or extend `hud_specimen`), list it in TECHNICAL_DESIGN §18.4, and Read the expected/actual/diff before approving.

## Scope

- Title entry 'Rival Sweep' and a district picker (unlocked campaign districts only)
- Intro card with Sid's portrait and briefing text
- ShiftScene rival mode: spawn Sid with the AI controller, suppress the Friday `rival_cameo` event, 180 s timer
- HUD LU-dumped duel readout (and an optional off-screen arrow)
- Pure result function (win/loss/draw from LU dumped and end state) with unit tests
- Mercury tally variant with the winner headline, totals and 'Pinched by Sid'; local record saved at tally; exits to Rematch/Title
- Visual golden for the duel HUD; Playwright e2e `tests/e2e/rival.spec.ts`
- Docs: GDD §13.5 (decided rules), §15.2 (HUD element), §15.1 and TECHNICAL_DESIGN §6.2 diagrams, TECHNICAL_DESIGN §18.4 scene list

## Out of scope

- Difficulty tier selection UI (tiers are deferred tuning)
- New music, jingles or portrait art
- Local or online multiplayer (ROADMAP §7: not planned)

## Acceptance criteria

- [ ] From the Title, Rival Sweep offers only unlocked campaign districts and starts a 180 s shift with exactly one Sid (no Friday cameo Sid)
- [ ] The HUD shows the player's and Sid's LU dumped, updates on each completed dump, and doesn't overlap the look-ahead zone
- [ ] At 180 s the tally names the winner by higher LU dumped (draw on a tie, as decided), and undumped hopper contents don't count (unit test on the result function)
- [ ] SACKED or TOWED ends the duel and is recorded per the decided rule (unit test on the result function)
- [ ] The district record (wins/losses/draws/bestLu) persists in ssp.save.v1, and the mode is playable to the tally with localStorage throwing
- [ ] The `hud_rival` (or extended `hud_specimen`) golden passes at pixelmatch threshold 0, and its diff PNGs were Read before approval
- [ ] `tests/e2e/rival.spec.ts` drives a canned 180 s run to the tally with no console errors
- [ ] GDD §15.1 and TECHNICAL_DESIGN §6.2 include the Rival Sweep path and match each other, and GDD §13.5 records the decided rules
- [ ] `ipHygiene.test.ts` passes with the new headline strings

## Verification

- npm run test:e2e
- npm run test:visual
- npm test
- npm run dev → Title → Rival Sweep → Puddle Lane (manual run to tally)

## Dependencies

**Depends on:**

- [SSP-275](SSP-275-mode-plumbing.md) Add Daily Shift and Rival Sweep mode plumbing: params, timer, replay, save
- [SSP-280](SSP-280-rival-ai-controller.md) Build Sid's Rival Sweep AI on the lane graph and LitterField
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-229](../M6/SSP-229-art-mercury-portraits.md) Art Pass 2: Mercury newspaper art and portraits for Sid, Doris and the Inspector
- [SSP-208](../M6/SSP-208-rival-sweeper-cameo.md) Implement veh.rival_sweeper Friday cameo and the rival_cameo event
- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-156](../M4/SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-142](../M4/SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning
- [SSP-143](../M4/SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-144](../M4/SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages

**Blocks:**

- [SSP-282](SSP-282-mode-replays.md) Commit deterministic replays for Daily Shift (pinned date) and Rival Sweep
- [SSP-283](SSP-283-m9-release-close.md) Publish desktop builds and both modes on itch.io, then close M9

## References

- ../../GDD.md#135-rival-sweep-m9
- ../../GDD.md#42-cast
- ../../GDD.md#152-hud-layout
- ../../GDD.md#153-tally-screen-the-muckleford-mercury
- ../../GDD.md#171-assists-m7
- ../../GDD.md#183-writing-samples
- ../../GDD.md#151-scene-flow
- ../../ART_BIBLE.md#12-ui-art-and-pixel-fonts
- ../../TECHNICAL_DESIGN.md#62-scene-flow
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../AUDIO_DESIGN.md#91-canonical-rules
- ../../AUDIO_DESIGN.md#151-plan
- ../../LEVEL_DESIGN.md#43-event-catalogue

## Roadmap tasks covered

- Rival Sweep: versus `veh.rival_sweeper` (Spotless Sid), most LU dumped in 180 s. Rival AI reuses the traffic and litter systems.
