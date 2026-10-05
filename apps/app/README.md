# FarmGo Connect app

The Expo app for every FarmGo role: buyers (businesses and households), farmers, field agents, QA officers, drivers, green-input suppliers and admins. One codebase runs on Android, iOS and the web, and adapts from phone to tablet, foldable and desktop.

## Run it

From the repo root, with the backend running (`pnpm dev`, see the root README):

```bash
pnpm --filter @farmgo/app web       # browser on http://localhost:8081
pnpm --filter @farmgo/app start     # Expo Go on a phone (scan the QR code)
```

On a phone, set `EXPO_PUBLIC_API_URL` to your computer's LAN address first (copy `.env.example` to `.env`). Sign in with the demo accounts listed in the root README. Admins can open the app as any demo user from Profile, View as another user.

Checks before handing work back:

```bash
npx tsc --noEmit          # must be zero errors
npx biome check .         # from the repo root: npx biome check apps/app
node ../../scripts/copy-lint.mjs
```

Builds and releases are in [docs/RELEASE.md](../../docs/RELEASE.md).

## How it is organised

```
src/
  app/          Expo Router routes only. Each file is a screen; (auth) is signed out,
                (app) is signed in, (app)/(tabs) are the bottom tabs. Route files stay thin
                and render a feature component.
  features/     Screens and components per area: orders, chat, shop, home, buyer, farmer,
                agent, qa, driver, supplier, admin, account, maps
  data/         Session, realtime socket, cart, favorites, addresses, orders, checkout:
                TanStack Query hooks and small stores shared across features
  ui/           The design system: Text, Button, TextField, Controls, ListRow, Screen,
                Dialog, Sheet, Toast, Banner, States, Media, Icon
  theme/        Tokens (colour roles, type, spacing, radius, motion) and the theme provider
  i18n/         en.ts and sw.ts. sw.ts must contain every key in en.ts (the type enforces it)
  lib/          API client, errors, formatting, deep links, config
  nav/          Navigation per role (tabs on phones, rail on tablets, sidebar on desktop)
  assets/       Images and the registry that maps keys to them
```

## Rules that keep it working

- Every screen handles loading, empty and error states. A failed request always shows a message with a retry; nothing fails silently. Errors pass through `humanError` in `src/lib/errors.ts`, which turns server codes into plain sentences in the user's language (the `apiErrors` namespace).
- Popups, confirmations and toasts are our own (`ui/overlays`). Never `Alert.alert`.
- All copy is in English and Kiswahili. No em dashes, emoji or curly quotes (`scripts/copy-lint.mjs` checks). Never state laws or retention periods.
- A tappable card never contains another button: put the action beside the card's tap area.
- Respect safe areas: headers add the top inset, the tab bar the bottom inset, and `SafeSides` the left and right in landscape.
- Typed routes are on, so a link to a screen that does not exist fails the typecheck.
- Money is integer KES cents everywhere; format with `kes()` from `src/lib/format.ts`.

Visual rules are in [DESIGN.md](DESIGN.md).
