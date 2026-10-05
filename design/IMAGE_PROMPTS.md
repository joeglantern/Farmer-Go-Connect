# Image prompts for ChatGPT

Everything the app shows as an image comes from these prompts, so it all looks like one set made by one studio. Generate in the order below, save each result with the exact file name given, and drop it into `design/assets/incoming/`. The Lead slices sheets, optimizes them and wires them in.

**What is not generated here, and why**
- **Interface glyphs** (back arrow, search, bell, cart, tabs): these stay vector (Phosphor icon set, drawn in code) so they are razor sharp at every size, follow text size, and recolor for light and dark mode. PNG glyphs would blur and could not change color.
- **The FarmGo leaf mark and wordmark:** built as vector in code from the mockup.
- **M-Pesa, Visa and Mastercard logos:** use the official files from the brands' press kits; never generate trademarks.

---

## Style guide (paste this block at the start of every prompt)

> Art direction for FarmGo Connect, a Kenyan fresh-produce marketplace. Photography: natural daylight, soft and slightly warm, true-to-life color, shallow depth of field, real textures (soil, woven baskets, wet leaves, wooden crates), Kenyan settings and people. Never glossy, never plastic, no lens flare, no HDR, no bokeh orbs, no gradients, no neon, no glowing edges. Illustrations: hand-painted gouache look with visible brush texture, flat but dimensional, soft single light from the top left, muted natural palette anchored on these greens: #1E6B38, #0F3D24, #3E9B4F, #DEECD4, with produce colors kept true (tomato red #D8452E, carrot orange #E58A2B, maize yellow #E6B422). No text, letters, numbers or logos anywhere in the image. No watermark. No borders or frames unless asked.

**Sheet rules** (for every batch marked "sheet"): a perfectly regular grid, the stated number of columns and rows, every cell exactly the same size, a plain uniform background of the stated color filling every gutter, subjects centered in their cells with equal padding, nothing crossing cell edges. Square output (1024 × 1024 or 1536 × 1536) unless the prompt says otherwise.

---

## Batch 1: Home category illustrations (sheet, 4 × 2, transparent or #FFFFFF)

File: `categories-sheet.png`

> [Style guide] A 4 by 2 sheet of eight small still-life objects in the gouache style, each centered in its cell on a plain white background, soft contact shadow under each object, each object filling about 70% of its cell. Row 1, left to right: (1) a bunch of fresh sukuma wiki kale leaves with a green cucumber, (2) a red apple, a ripe mango and a small bunch of bananas, (3) a raw beef steak beside a whole plucked chicken on a small board, (4) a glass bottle of fresh milk next to a small tub of yoghurt. Row 2: (5) a small sisal sack of maize grains with beans spilling out, (6) a jar of golden honey and a jar of peanut butter, (7) a small sack of organic compost with a green seedling growing from the top, (8) four tiny mixed items arranged in a neat 2 by 2 grid: a tomato, an egg, a carrot and a small bundle of dhania (coriander).

Used for: Vegetables, Fruits, Meat & Poultry, Dairy, Grains & Staples, Value Added, Natural Fertilizers, All Products.

## Batch 2: Sign-up role illustrations (sheet, 2 × 2, #F1F7EF)

File: `roles-sheet.png`

> [Style guide] A 2 by 2 sheet of four gouache spot illustrations on a plain very pale green (#F1F7EF) background, each centered, each about 60% of its cell. (1) A hotel chef's hat resting on a small wooden crate of fresh vegetables. (2) A farmer's wide-brimmed straw hat hung on a hoe handle beside a young maize plant. (3) A young person's hands potting a seedling in a small bag of compost. (4) A woven shopping basket with tomatoes, a pineapple and greens, as for a family kitchen.

Used for: Hotel / Restaurant, Farmer, Youth Enterprise, Individual / Household.

## Batch 3: Welcome hero photo (single, portrait 1024 × 1536)

File: `hero-welcome.png`

> [Style guide] Photograph. A smiling Kenyan woman farmer in her thirties, wearing a wide straw hat and a green apron, holding a large woven basket overflowing with fresh tomatoes, sukuma wiki, carrots, capsicum and cabbage, standing in lush green vegetable rows on a sunny morning in the Kiambu highlands. Camera at chest height, subject centered in the lower two thirds, the upper third is soft green field and pale sky so a white logo and text can sit above her head. Natural light, gentle warmth, real skin texture, no makeup look.

## Batch 4: Home banner photos (sheet, 1 × 3, portrait output split into three landscape cells, #FFFFFF gutters)

File: `banners-sheet.png`

> [Style guide] A sheet of three photographs stacked vertically, each a wide landscape cell with a 2.4 to 1 ratio, separated by thin white gutters. (1) Crates of fresh tomatoes, sukuma wiki and carrots on the tailgate of a small pickup at a farm gate at sunrise. (2) A hotel kitchen prep counter with a wooden crate of the same fresh vegetables being unpacked by a chef's hands, bright and clean. (3) A young Kenyan man and woman loading reusable green plastic crates of produce into a delivery van. In every photo keep the left 45% calm and darker (shade, soft focus) so white text can sit there.

## Batch 5: Produce catalog photos (sheets, 3 × 3, #F4F6F2)

These are the default photos for every catalog item. Consistent studio still life: one subject per cell, shot from 45 degrees above, on a plain warm off-white linen surface (#F4F6F2), soft shadow to the lower right, same scale and lighting in every cell.

File `produce-sheet-1.png`:
> [Style guide] A 3 by 3 sheet of food product photographs, same studio set in every cell as described. Row 1: ripe red tomatoes (a small pile), a bunch of sukuma wiki kale, a bunch of spinach. Row 2: red onions, a green cabbage, carrots with tops. Row 3: capsicum (red, green, yellow), French beans in a small bundle, courgettes.

File `produce-sheet-2.png`:
> [Style guide] Same set. Row 1: potatoes, sweet potatoes, avocados (one halved). Row 2: bananas (a small bunch), mangoes, passion fruit (one halved). Row 3: a pineapple, a watermelon wedge beside a whole small watermelon, a bunch of dhania (coriander).

File `produce-sheet-3.png`:
> [Style guide] Same set. Row 1: fresh ginger roots, garlic bulbs, dry red kidney beans in a small wooden bowl. Row 2: green grams (ndengu) in a small wooden bowl, maize cobs with husks pulled back, a tray of brown eggs. Row 3: fresh milk in a glass bottle, a jar of honey with a wooden dipper, a jar of peanut butter.

File `produce-sheet-4.png`:
> [Style guide] Same set. Row 1: a fresh beef cut on butcher paper, goat meat cuts on butcher paper, a whole plucked chicken on butcher paper. Row 2: dried mango slices in a small bowl, a tub of natural yoghurt, a small jar of ghee. Row 3: arrowroots (nduma), a bunch of managu (African nightshade), a bunch of terere (amaranth greens).

## Batch 6: Demo farmer and farm portraits (sheet, 3 × 2, #FFFFFF)

File: `farmers-sheet.png`. Clearly demo content; replaced by real farmers' photos later.

> [Style guide] A 3 by 2 sheet of environmental portraits, square cells. (1) A young Kenyan woman in a green headscarf kneeling between rows of kale. (2) A Kenyan man in his fifties in a checked shirt holding a crate of tomatoes in a greenhouse. (3) A young Kenyan woman smiling beside rows of French beans. (4) A Kenyan man in his thirties with a cap holding freshly dug potatoes. (5) A young man inspecting mango trees in an orchard in Machakos. (6) Two young women sorting capsicum into crates under a shade net. Natural outdoor light, relaxed genuine expressions, subjects centered so a circular crop keeps the face.

File: `farms-sheet.png`
> [Style guide] A 3 by 2 sheet of landscape photographs of small Kenyan farms, no people: (1) terraced kale rows on red soil, (2) a small polythene greenhouse with tomato vines, (3) a French bean field with drip lines, (4) a potato field in the highlands with mist, (5) a mango orchard in dry land, (6) a shaded nursery of seedlings in black bags.

## Batch 7: Empty and outcome states (sheet, 4 × 3, #FFFFFF)

File: `states-sheet.png`

> [Style guide] A 4 by 3 sheet of small gouache spot illustrations, each centered on white with generous padding, all at the same scale and with the same soft shadow. Row 1: (1) an empty woven basket (empty cart), (2) an empty wooden crate with a small clipboard (no orders), (3) two simple speech bubbles made of leaves (no messages), (4) a sleeping rooster (no notifications). Row 2: (5) a magnifying glass over a single bean sprout (no search results), (6) a seedling in a pot with a small flag (no listings yet), (7) a handshake made of two leaves (no matches yet), (8) a folded paper map with a pin (no routes today). Row 3: (9) a cloud with a small unplugged cable (offline), (10) a toppled crate with spilled tomatoes (something went wrong), (11) a green crate with a check-shaped ribbon tied around it (order placed), (12) a phone resting in a palm with a small green coin (payment received).

## Batch 8: Trust badges (sheet, 3 × 2, transparent or #FFFFFF)

File: `badges-sheet.png`

> [Style guide] A 3 by 2 sheet of round embossed seal illustrations in the gouache style, no text or letters on them at all, only symbols, each a circular seal with a subtle scalloped edge. (1) Quality checked: a magnifier over a leaf, deep green. (2) Organic: a sprout with two leaves, leaf green. (3) Local: a map pin made of a leaf, forest green. (4) Youth-led: a young sapling growing tall, lime green. (5) Woman-led: a sunflower head, warm yellow. (6) Verified farmer: a shield with a leaf, deep green.

## Batch 9: Textures and patterns (single images, seamless)

File: `pattern-leaves.png` (1024 × 1024, seamless tile)
> A seamless repeating pattern tile of thin hand-drawn line leaves and small seed shapes, single color #FFFFFF lines at 12% opacity on a solid #0F3D24 background, loose and organic, even density, no text. It must tile perfectly on all four edges.

File: `pattern-rows.png` (1024 × 1024, seamless tile)
> A seamless repeating pattern tile that abstracts ploughed field rows seen from above: gently curving parallel contour lines in #3E9B4F at 10% opacity on a solid #F1F7EF background, like a topographic map of terraces, even density, no text. It must tile perfectly on all four edges.

File: `texture-paper.png` (1024 × 1024, seamless)
> A seamless, very subtle natural paper grain texture, off-white #FBFCFA, fine fibers and faint mottling only, extremely low contrast so it can sit behind text, no stains, no folds. It must tile perfectly.

File: `texture-linen.png` (1024 × 1024, seamless)
> A seamless, very subtle woven linen texture in pale sage #E6EFE3, fine even weave, extremely low contrast, no wrinkles. It must tile perfectly.

## Batch 10: App store and splash (single images)

File: `splash-field.png` (1284 × 2778)
> [Style guide] Photograph from above of lush green vegetable rows on red soil in Kenya, morning light, calm and uniform so a centered white logo can sit on it, slightly darkened overall.

File: `feature-graphic.png` (1024 × 500)
> [Style guide] Wide photograph of a farmer's hands passing a crate of fresh vegetables to a chef's hands at a farm gate, left half calm and softly out of focus for text.

---

## After generating
1. Save with the exact file names into `design/assets/incoming/`.
2. Tell the Lead which batches are done. The Lead slices the sheets, crops to the app's sizes, compresses to WebP and PNG, and checks every image against the style guide.
3. If an image comes back with text, a border, a gradient or a glossy 3D look, regenerate it; say "no text, no border, matte gouache" again at the end of the prompt.
