---
name: grandma-pet
description: Make an importable animated character pack for Grandma Mode using an original character or a reference the user can use. The pack animates the slide, chart drawing, and knitting scenes.
---

Create a `.grandma-pet.json` file for **Grandma Mode → Appearance settings → Import pack**. Use the user's character idea or reference; any consistent character can star in all three scenes. Carry over the supplied creator and rights credit. Ask for it only when attribution would otherwise be unknown and is necessary for distribution.

Use ImageGen for three separate transparent 2×2 pose sheets. If the user has ready artwork, arrange their frames into the same layout. Keep the character's design, scale, camera angle, and ground position consistent. The frames run top-left, top-right, bottom-left, bottom-right.

- **Slide** — run in, land low, skid on the ground, then hold the final pose. Adapt the limbs and posture to the character.
- **Draw** — get ready, draw a mark, finish the chart, then admire it. Keep the board still.
- **Knit** — start a stitch, catch the yarn, tighten it, then rest. Keep the needles attached to the hands or paws.

Use equal square cells with transparent gutters. Fit each pose and its props fully inside its cell, align feet or ground at roughly 92% of each cell's height, and keep poses close enough to read as one motion. Save each sheet as a square still WebP, preferably 768×768. All three WebPs together must fit within 512 KiB. Remove file metadata before packing. Keep the fourth frame readable on its own for reduced motion.

Inspect each sheet for clipped frames, inconsistent registration, stray background, disconnected limbs, and accidental text. Run this helper from the skill directory with the actual file paths:

```sh
node scripts/pack-pet.mjs cat.grandma-pet.json "Bread Cat" "Artwork by the creator" slide.webp draw.webp knit.webp
```

Leave the credit argument empty when no credit is needed. Deliver the validated pack and say where to import it. Credit included in a pack does not itself grant redistribution rights.
