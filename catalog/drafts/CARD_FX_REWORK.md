# Card FX rework backlog

Owner reviewed the 39 card facets (Card Motion & Foil, TCG Foils, Deck & Hand) on the
Prism Foil Picker voting page (2026-09-06): **30 loved, 9 passed**. Decision: keep all 39
published and **rework** the 9 rather than cut them. Nothing is removed. Iterate in place;
re-run the pipeline and recapture the GIF for each as it is reworked, then tick it off here.

## Reworked (done)

- **Overhand Shuffle** `.dk-overhand` (2026-09-06) - rebuilt as a clear two-stack pull-and-drop: a highlighted (warn-bordered) 3-card packet lifts off the right stack, arcs over the gap and drops onto the left stack, then returns.
- **Halo Foil** `.fxc-f-halo` (2026-09-06) - bolder, higher-contrast swooping arcs (info+crit bands) with a raking white sheen; fxcArc travel bumped to -13px.
- **Enchanted** `.fxc-f-enchanted` (2026-09-06) - ornate glowing corner filigree + double inset border, richer whole-face cold-foil (rainbow + diagonal sheen).

## To rework (remaining)

| Facet | Ref | Why it fell short | Rework direction |
|---|---|---|---|
| Flip Up | `.fxc-m-flipx` | Redundant with the stronger Flip Over | Give it a distinct hinge (top-edge lift with a hand-shadow), or retire if it stays a near-dupe |
| Toss Spin | `.fxc-m-toss` | Reads as a blur in motion | Slow the spin, clearer arc and a definite landing pose before it exits |
| Cosmos Holo | `.fxc-f-cosmos` | Overlaps Rainbow Holo | Push the galaxy read: denser starfield + parallax (borrow from the reworked Starlight), less flat rainbow |
| Linear Foil | `.fxc-f-linear` | Too subtle | Stronger brushed-metal grain + a sharper directional sheen sweep |
| Gold Foil | `.fxc-f-gold` | Reads flat | Engraved gold frame (masked to the border) + warmer specular highlight |
| Tinsel | `.fxc-f-tinsel` | Too close to Linear | Tighter, brighter shimmer with a faster travel, or fold into Linear |

## Loved (30) — keep as-is

- Motion: Flip Over, Tap, Upside Down, Deal In, Peek
- Foils: Rainbow Holo, Shine, Reverse Holo, Etched, Prismatic
- Composed: Flip + Holo, Tap + Etched, Live Holo Tilt
- TCG: Cracked Ice, Water Web, Starlight, Stamped Orbs, Honeycomb, Surge, Confetti, Oil Slick, Glyph Stamp, Dragon-Scale, Cold Foil
- Deck & Hand: Draw from Deck, Draw from Discard, Deal Out, Fan a Hand, Riffle & Bridge, Table Wash

Voting page (private, owner): https://claude.ai/code/artifact/988513c5-fe06-4c7a-a2a6-db716a760d16
