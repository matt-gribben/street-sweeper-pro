# concept.spike_street

| Key | Value |
|---|---|
| Asset IDs | concept.spike_street (concept board: reference only, never shipped, no manifest entry) |
| Tool | codex |
| Output file | street.png |
| Aspect | 2:1 |
| References | none |
| Preamble | v1 |

Purpose: the M0 smoke run for `forge gen-ai` (SSP-012) and a straight-down street mood reference for
`assets-src/STYLE.md`. Everything below the marker is sent byte-for-byte; `forge gen-ai` refreshes the
agent instructions and the preamble in place before sending.

<!-- forge:send -->
<!-- forge:begin agent-instructions -->
Use your built-in image generation tool to create the image described below. Copy the resulting
PNG into the current working directory as street.png. Do not draw it with code: do not use Python,
PIL, SVG, canvas or any other programmatic method. Do not create or edit any other file.
When finished, reply with the single word DONE.
<!-- forge:end agent-instructions -->

<!-- forge:begin preamble v1 -->
Overhead view, looking straight down from directly above. Chunky pixel art with clearly visible
square pixels; characters are about 20 pixels tall (head to feet). Every shape has a 1-pixel dark outline (#0f0e12).
Light comes from the top-left. Use only flat colours from this palette, no gradients, no
anti-aliasing: #0f0e12 #24222a #3a3840 #55535a #74727a #9a989c #c3c1c0 #f2efe6 #3b2421 #6b3a2c
#9c5236 #c97b4e #e8b48a #8a5a3c #c98a1a #f2c12e #fff27a #ff8a1e #d23a2c #8a1f27 #f07a8a #1f3a2a
#2f6b3a #5fa04a #a8d06a #1c2b4a #2e5a9c #5ea0d8 #a8dcef #2a8a86 #4a2f6b #8a5ab8.
Transparent background. No text or lettering unless explicitly requested. No logos, brands or
trademarks of any kind.
<!-- forge:end preamble -->

## Asset brief

A 2:1 mood concept of one short stretch of a British seaside town street at midday, seen from
directly above, looking straight down like a camera hanging high over the middle of the road.
This is a full-bleed scene: fill the whole frame edge to edge with no transparency, which
overrides the transparent background line above. The whole image is pixel art at roughly
480x240 art pixels, upscaled, so every art pixel is a crisp visible square.

Layout, from the top edge to the bottom edge:

1. Along the top, the rooftops of a row of terraced houses seen from above: grey slate roofs
   with brick chimneys, a few flat dark felt roofs with small square vents and skylights. Each
   roof has a light line along its top-left edge and a dark line along its bottom-right edge.
2. Below the roofs, a grey paving-slab pavement with a pale kerb, a round red post box seen
   from above as a red circle, two dark green wheelie bins and a wooden bench.
3. Across the middle, a two-lane grey asphalt road running left to right, with white centre
   dashes, double yellow lines along both kerbs and a zebra crossing of white bars.
4. On the road, the star: a small, bright yellow road sweeper truck seen straight from above
   (yellow body, white cab roof, a blue stripe along both sides, two red round brushes at the
   front) driving to the right and leaving a clean, freshly scrubbed stripe of road behind it
   through patchy brown and black street grime.
5. Two small parked cars, seen only as roofs, bonnets and windscreens.
6. Below the road, another pavement, then a seafront promenade with pale blue railings, and a
   strip of sandy beach along the bottom edge.

A few tiny people on the pavements (an elderly woman pulling a shopping trolley, a jogger, a
person walking a small dog), each only about 20 art pixels tall, drawn in a high three-quarter
view from the south. Scattered litter on the pavements and in the gutters: crumpled crisp
packets, squashed drink cans, a newspaper and specks of cigarette butts.

Shadows fall towards the bottom right. Cheerful, sunny, municipal, slightly grubby. Not gritty,
not photo-real, not painterly. No text, no lettering, no words on anything, no logos.
