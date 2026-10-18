---
id: SSP-252
title: "Run the PEGI 7 / ESRB E10+ content review and extend IP hygiene checks"
milestone: M7
status: todo
type: test
estimate: M
labels: [type:test, area:test, area:assets, area:docs, size:M]
depends_on: [SSP-249, SSP-251, SSP-003, SSP-192, SSP-233]
blocks: [SSP-254]
---

# SSP-252: Run the PEGI 7 / ESRB E10+ content review and extend IP hygiene checks

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** test · **Size:** M · **Areas:** test, assets, docs

## Summary

Produce the evidence for the Content rating and IP hygiene exit checks: review all shipped content against the rating guardrails, and extend ipHygiene.test.ts to scan in-game text, the credits data and the itch page copy.

## Context

Rating guardrails (GDD §3, CLAUDE rule 11):
- Nobody is ever injured. Pedestrians fall over cartoonishly, get up and shake a fist. Animals leap, yowl and bolt.
- No blood, no gore, no ragdolls.
- Collisions with people are framed as the player's embarrassment.
- Dog mess is the crudest joke.
- Night revellers are "singing", never drunk on screen, and no alcohol is shown.
Check specifically:
- fx.splat colours are 08/13 (brown), never red
- the fall/get-up/angry frames
- the cat is never hurt
- the Doris handbag "Take that!" stays slapstick
- Kebab Mile and pub facades/signs show no alcohol
- Mercury headline pools, Pam barks and caption strings
The current ipHygiene.test.ts (M0) scans `assets-src/ai/**/prompt.md`, `_style_preamble.md`, `src/data/*.json` and asset IDs for blocked trademark terms. EXTEND it to cover in-game text sources (headline pools, barks, captions, UI strings), the generated `public/assets/credits.json`, and the itch page copy (`docs/release/itch-page.md` or wherever SSP-251 put it).
Tool names in credits.json are nominative attribution. Keep the credits-only allowlist decided in SSP-249, so they are allowed there and blocked everywhere else.
Coverage proof must not commit a trademark: build the failing fixture at test runtime from the existing blocklist (e.g. inject a blocked term into an in-memory headline pool) instead of a committed file.
Shop sign names must be checked for real-business collisions (GDD §18.4).
Evidence: Read the zoo screenshot (`?test=1&scene=zoo`) and the contact sheets (`npm run assets:sheets` → build/sheets/). Record a checklist in the release PR.

## Scope

- Extend tests/unit/ipHygiene.test.ts scan roots to the in-game text sources, credits.json and the itch copy
- Content review checklist across zoo, contact sheets, headline/bark/caption pools and shop signs, recorded in the PR
- Fix or file any violation found (asset fixes follow the CLAUDE §6 procedures)

## Out of scope

- Obtaining an official PEGI/ESRB certificate
- Rewriting content that passes review

## Acceptance criteria

- [ ] ipHygiene.test.ts scans in-game text, credits.json and the itch page copy, and passes
- [ ] A runtime-built fixture with a blocked term injected into a headline pool makes the scanner fail (unit test), and no trademark is committed
- [ ] Tool names in credits.json pass, and the same names in any other scanned source fail (unit test)
- [ ] The PR contains a completed rating checklist with each guardrail ticked and evidence (zoo screenshot, contact sheets)
- [ ] No shipped string or sprite shows injury, blood, gore, ragdolls or alcohol

## Verification

- npm test
- npm run assets:sheets (then Read build/sheets/*)
- npm run test:visual (zoo)
- Manual: Read the zoo screenshot at ?test=1&scene=zoo

## Dependencies

**Depends on:**

- [SSP-249](SSP-249-credits-scene.md) Build CreditsScene with pipeline and tool-version provenance
- [SSP-251](SSP-251-itch-page.md) Prepare the itch.io page: copy, controls, rating note and screenshots
- [SSP-003](../M0/SSP-003-lint-purity-ip-tests.md) Add biome.json sim-purity rules plus simPurity and ipHygiene unit tests
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-233](../M6/SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

**Blocks:**

- [SSP-254](SSP-254-release-1-0.md) Push 1.0 to itch.io with butler and tag v1.0.0 and m7

## References

- ../../GDD.md#3-audience-platforms-and-rating
- ../../GDD.md#184-naming-and-ip-rules
- ../../GDD.md#182-comedy-mechanics
- ../../ART_BIBLE.md#16-do-and-dont
- ../../ROADMAP.md#6-risk-register
- ../../../CLAUDE.md#3-hard-rules-non-negotiable

## Roadmap tasks covered

- `Exit check: Content rating — review against PEGI 7 / ESRB E10+: nobody is injured, no blood, no gore, no ragdolls.`
- Exit check: IP hygiene — `ipHygiene.test.ts` passes. The itch.io page text is reviewed for trademarks.
