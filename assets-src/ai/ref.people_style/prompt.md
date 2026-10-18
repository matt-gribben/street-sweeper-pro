# ref.people_style

| Key | Value |
|---|---|
| Asset IDs | ref.people_style (the people style reference; its cells also feed npc.old_woman "Doris" via ingest.json) |
| Tool | codex |
| Output file | sheet.png |
| Aspect | 2:1 |
| References | none (this sheet IS the reference every later human prompt attaches with -i) |
| Preamble | v1 |

Purpose (SSP-014, decision D-04): a fresh `forge gen-ai` generation of the people style reference,
replacing the probe candidate (`assets-src/_probe/codex/old_woman_sheet.png`, whose prompt was never
saved). Layout: row 1 = Doris facing the viewer (south) in four key poses; row 2 = Doris standing,
turned to south-west, west, north-west and north, the authored directions of ART_BIBLE §4.5
(SE, E and NE are mirrored in the grid). The brief overrides the preamble's straight-down camera
line for people, because ART_BIBLE §4.4 draws humans in a high three-quarter view. Everything below
the marker is sent byte-for-byte; `forge gen-ai` refreshes the agent instructions and the preamble
in place before sending.

<!-- forge:send -->
<!-- forge:begin agent-instructions -->
Use your built-in image generation tool to create the image described below. Copy the resulting
PNG into the current working directory as sheet.png. Do not draw it with code: do not use Python,
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

A 2:1 character sprite sheet of one small elderly British lady, arranged as a grid of 4 columns
and 2 rows, for a top-down arcade game. Each figure stands alone in the centre of its cell with
wide empty transparent space around it. No figure touches another figure or the cell edges.

Camera for people (this overrides the straight-down line above): a high three-quarter view, as if
seen from about 60 degrees above the ground, from the south (from the bottom of the image). We see
the top of her head, her face when she faces the viewer, a foreshortened body, and her feet. Every
cell uses exactly the same camera angle.

Resolution, the most important rule: this is very low-resolution pixel art. Think of the whole
sheet as only about 200 x 100 art pixels, scaled up so each art pixel is a big crisp square, which
makes each cell about 50 x 50 art pixels. The lady is tiny inside her cell: only about 19 art pixels
from the top of her head to the soles of her feet, outline included, and about 10 art pixels wide
across the body. Count the art pixels: she must not be taller than 20 of them. Every figure on the
sheet is exactly the same pixel size.

Keep her simple and readable at that size, like a classic 16-colour arcade sprite: big flat areas
of colour, one 1-pixel dark outline around the outside of the whole silhouette, and almost no dark
lines inside it (no outlined buttons, no outlined arms, no outlined folds). Her head is big, about
8 art pixels tall, so her face reads: two dark 1-pixel eyes under a frowning brow line and a small
cross mouth. She glares.

The character, the same in every cell:
- a lavender headscarf (#8a5ab8) tied under the chin, with a little grey-white hair (#c3c1c0)
  showing at the front, and her face clearly visible below it (skin #e8b48a, shade #c97b4e);
- a long plum coat down to her shins, in a clear mid purple: mostly #8a5ab8 on the top and
  shoulders and #4a2f6b on the lower half; nothing on the coat is darker than #4a2f6b, and the coat
  is never near-black. She is hunched forward with rounded shoulders;
- a small maroon handbag (#8a1f27) hanging from one forearm;
- she pulls a small two-wheeled shopping trolley by its handle, held close at her side: a narrow
  bag in bold red and navy tartan (#d23a2c squares on #1c2b4a, big simple checks), about 4 art
  pixels wide and no taller than her shoulders, with two tiny dark wheels. She and her trolley
  together are no more than 18 art pixels wide;
- small dark shoes.

Row 1, all four facing the viewer (south), trolley at her side:
1. Standing still, glaring at the viewer.
2. Walking, left foot forward.
3. Walking, feet together, passing step.
4. Walking, right foot forward.

Row 2, standing still, the same pose in four directions:
5. Turned towards the bottom left (south-west), three-quarter front view.
6. Facing left (west), side view, the trolley trailing close behind her.
7. Turned towards the top left (north-west), three-quarter back view.
8. Facing away from the viewer (north), back view, only the back of the headscarf and coat visible.

Flat colours, top-lit shading (highlights on the top of the head and shoulders, shade lower down),
no cast shadows and no ground under her (the game adds its own shadow). No text, no lettering, no
words, no logos, no labels or numbers on the sheet.
