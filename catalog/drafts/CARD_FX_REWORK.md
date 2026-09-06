# Card FX rework backlog

Owner reviewed the 39 card facets (Card Motion & Foil, TCG Foils, Deck & Hand) on the
Prism Foil Picker voting page (2026-09-06): **30 loved, 9 passed**. Decision: keep all 39
published and **rework** the 9 rather than cut them. Nothing is removed. Iterate in place;
re-run the pipeline and recapture the GIF for each as it is reworked, then tick it off here.

## Reworked (done)

- **Overhand Shuffle** `.dk-overhand` (2026-09-06) - rebuilt as a clear two-stack pull-and-drop: a highlighted (warn-bordered) 3-card packet lifts off the right stack, arcs over the gap and drops onto the left stack, then returns.
- **Halo Foil** `.fxc-f-halo` (2026-09-06) - bolder, higher-contrast swooping arcs (info+crit bands) with a raking white sheen; fxcArc travel bumped to -13px.
- **Enchanted** `.fxc-f-enchanted` (2026-09-06) - ornate glowing corner filigree + double inset border, richer whole-face cold-foil (rainbow + diagonal sheen).
- **Flip Up** `.fxc-m-flipx` (2026-09-06) - now a bottom-edge hinge (stand-up flip), distinct from Flip Over's in-place spin.
- **Toss Spin** `.fxc-m-toss` (2026-09-06) - slower single spin with a flat landing beat; no longer a blur.
- **Cosmos Holo** `.fxc-f-cosmos` (2026-09-06) - parallax starfield (3 layers) over a faint rainbow nebula; clearly a galaxy, distinct from the flat Rainbow Holo.
- **Linear Foil** `.fxc-f-linear` (2026-09-06) - brighter brushed-metal grain + a sharp directional sheen (info-tinted).
- **Gold Foil** `.fxc-f-gold` (2026-09-06) - embossed gold frame (::after) + a brighter warm specular.
- **Tinsel** `.fxc-f-tinsel` (2026-09-06) - tight, fast vertical shimmer with a coloured sparkle band, distinct from the brushed Linear.

## Cut (2026-09-06)

After the reworks, a re-vote still passed four, so they were removed from the fork (source,
catalog, GIFs) rather than reworked again: **Enchanted** `.fxc-f-enchanted`, **Halo**
`.fxc-f-halo`, **Linear Foil** `.fxc-f-linear`, **Tinsel** `.fxc-f-tinsel`. Card FX set is now
28 facets. The rework history above is kept for reference if any are revisited.

## To rework (remaining)

None.

## Loved (30) — keep as-is

- Motion: Flip Over, Tap, Upside Down, Deal In, Peek
- Foils: Rainbow Holo, Shine, Reverse Holo, Etched, Prismatic
- Composed: Flip + Holo, Tap + Etched, Live Holo Tilt
- TCG: Cracked Ice, Water Web, Starlight, Stamped Orbs, Honeycomb, Surge, Confetti, Oil Slick, Glyph Stamp, Dragon-Scale, Cold Foil
- Deck & Hand: Draw from Deck, Draw from Discard, Deal Out, Fan a Hand, Riffle & Bridge, Table Wash

Voting page (private, owner): https://claude.ai/code/artifact/988513c5-fe06-4c7a-a2a6-db716a760d16
