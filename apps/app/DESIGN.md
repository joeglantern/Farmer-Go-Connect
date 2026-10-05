# FarmGo Connect design

The look comes from the original product mockup (`design/reference/app-screens-mockup.png`): fresh-produce greens, white cards on a faintly green ground, pill buttons and real photographs of produce and farmers. It should feel like a well-kept market stall, calm and trustworthy, never like a template.

## Colour

All colours are roles in `src/theme/tokens.ts`; components never hard-code hex values.

| Role | Light | Use |
|---|---|---|
| `primary` | green 700 `#1C6536` | Buttons, links, active tab, selected states |
| `band` | green 900 `#0E3B22` | Dashboard headers, dark bands, splash |
| `leaf` | green 500 `#3E9B4F` | Success, organic, the word "Connect" |
| `lime` | `#B9CF4B` | The light half of the leaf mark; decoration only, never text |
| `bg` | `#F4F7F3` | Page ground |
| `surface` | white | Cards, sheets, inputs |

Dark mode has its own values for every role (not an automatic invert), chosen for contrast on near-black green.

No gradients for decoration. Depth comes from flat tones, soft shadows on light surfaces and the leaf texture on dark bands.

## Type

Figtree everywhere. Roles, not sizes: `display`, `title1` to `title3`, `headline`, `body`, `bodyStrong`, `callout`, `caption`, `micro`, `statNumber`, `price`. Numbers use tabular figures (`numeric`). Text scales with the system text size setting.

## Shape and space

- 4 pt spacing grid.
- Radius: 10 for small tiles, 14 for cards (the mockup's card), 18 to 24 for sheets and media, pill for buttons, chips and search.
- Touch targets are at least 44 pt, even when the drawn control is smaller.

## Layout by size

| Size class | Width | Navigation | Lists |
|---|---|---|---|
| compact | under 600 | Bottom tab bar, centre action for farmers and drivers | Single column |
| medium | 600 to 1023 | Navigation rail | Two columns or list beside detail |
| expanded | 1024 and up | Sidebar | List beside detail, grids of three or four |

Foldables switch class live as they open.

## Imagery

- Produce: studio photographs on linen, one subject per frame. When a listing has no photo, the catalog photo for that produce is shown, centred on its own linen colour rather than stretched.
- People and farms: natural photographs of Kenyan farmers and fields.
- Illustrations (categories, roles, badges): gouache style, matte, no text.
- All of it is generated from the prompts in `design/IMAGE_PROMPTS.md` and sliced by `design/slice_assets.py`.

## Icons

Phosphor icons through `ui/Icon.tsx` only, imported one by one (importing the whole set adds megabytes to the web build). Regular weight by default, fill for selected states, duotone for empty states.

## Motion

Short and purposeful: 120 to 320 ms, ease-out for things arriving. Respect reduced motion. No bouncing, no motion for its own sake.

## Feedback

- Confirmations for anything irreversible or about money use our Dialog, with the action named on the button ("Cancel order", not "OK").
- Toasts confirm what just happened in one line and offer one action at most (Undo, Retry, View cart).
- Banners explain a lasting state on a screen (offline, payment pending, viewing as another user).
- Errors say what happened and what to do next, in plain words.

## App icon

Generated from the leaf mark by `design/make-icons.mjs`: the two-tone leaf on pale leaf green for the app icon, a white silhouette for Android notifications, and the mark alone for the splash on light and dark grounds.
