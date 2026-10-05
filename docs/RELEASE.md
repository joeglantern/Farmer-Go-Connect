# Releasing the FarmGo Connect app

How the Android, iOS and web builds are made, where their settings live and how testers get them. The app is one Expo project (`apps/app`) built in the cloud with EAS.

## What you need once

- An Expo account (`npx eas-cli@latest login`). The project is linked with `npx eas-cli@latest init` from `apps/app`, which writes `owner` and `extra.eas.projectId` into `app.json`.
- An Apple Developer account for iPhone builds. EAS creates the certificates and profiles the first time you build; let it.
- A Google Play Console account for store releases. Testers do not need it: preview builds are APKs installed from a link.
- The deployed API, reachable over HTTPS. Phones refuse plain HTTP.

## Settings per build

Every setting the app reads is an `EXPO_PUBLIC_*` variable, listed with explanations in `apps/app/.env.example`. Builds take them from the `env` block of the profile in `apps/app/eas.json`.

| Variable | Tester value |
|---|---|
| `EXPO_PUBLIC_API_URL` | `https://api.<host>` (the VPS, see docs/OPERATIONS.md) |
| `EXPO_PUBLIC_SUPPORT_EMAIL`, `_PHONE`, `_WHATSAPP` | Shown in Profile when set. Add them to `build.base.env` only with a real value: EAS rejects empty strings |
| `EXPO_PUBLIC_TERMS_URL`, `_PRIVACY_URL` | Shown in Profile when set |
| `EXPO_PUBLIC_MAP_TILES`, `_MAP_ATTRIBUTION` | Empty uses OpenStreetMap, fine for testing |

These values are compiled into the app. Changing one needs a new build or an over-the-air update.

## Profiles (`apps/app/eas.json`)

| Profile | Use | Android | iOS |
|---|---|---|---|
| `development` | Developer builds with the dev client | APK | Simulator or registered devices |
| `preview` | Testers | APK, installed from a link | Ad hoc (registered devices) or upload to TestFlight |
| `production` | Stores | App bundle for Google Play | App Store and TestFlight |
| `production-apk` | Testers, release settings | Installable APK built like the store bundle | Not used |

Version numbers: `version` in `app.json` is the public version (1.0.0). Build numbers are kept by EAS (`appVersionSource: remote`) and go up by themselves on every preview and production build.

## Building for testers

From `apps/app`:

```bash
npx eas-cli@latest build --profile preview --platform android
npx eas-cli@latest build --profile production --platform ios   # then submit to TestFlight
npx eas-cli@latest submit --platform ios --latest
```

The Android build finishes with a link and a QR code: send that to testers. They allow installs from their browser the first time.

For iPhones, TestFlight is the simplest: after `submit`, add testers in App Store Connect under TestFlight, Internal Testing. Internal testers (people on your App Store Connect team) get the build within minutes; external testers need a short Apple review first.

Before any build, from `apps/app`:

```bash
npx tsc --noEmit
npx expo-doctor
npx expo export --platform web --output-dir dist   # proves the bundle compiles
```

## Over-the-air updates

`runtimeVersion` follows the app version, so JavaScript-only fixes can reach installed builds without a new install:

```bash
npx eas-cli@latest update --channel preview --message "Fix checkout copy"
```

Anything that changes native code (a new Expo module, a permission, the icon) needs a new build and a higher `version`.

## The web app

The web build is a single page app served by Caddy on the VPS.

```bash
cd apps/app
EXPO_PUBLIC_API_URL=https://api.<host> npx expo export --platform web --output-dir dist --clear
```

Keep `--clear`: Metro caches transformed files, and without it a build can keep the API address from an earlier build. Check the result with `grep -c "api.<host>" dist/_expo/static/js/web/entry-*.js`.

Copy `dist/` to the VPS with `infra/ship.sh <user@host> --with-web` where Caddy serves it at `https://app.<host>` and sends every unknown path to `index.html`, so deep links work. The web origin must be in the API's `CORS_ORIGINS`, which also feeds Better Auth's trusted origins.

## Icons and splash

All icon files in `apps/app/assets/images` are generated from the leaf mark by `node design/make-icons.mjs` (run from the repo root). Change the mark or colours there, re-run it, then make a new build.

## Push notifications

- Android needs Firebase Cloud Messaging: add the project's `google-services.json` with `npx eas-cli@latest credentials`.
- iOS needs an APNs key, which EAS can create during the first iOS build.

Until both are set, everything else works and notifications still appear inside the app.

## Release checklist

1. `pnpm copy-lint`, app typecheck and `expo-doctor` are clean.
2. `API_URL=https://api.<host> pnpm smoke` passes against the deployed stack.
3. `node scripts/crawl.mjs` against the web build shows no broken pages.
4. The QA pass in `docs/qa/TEST_PLAN.md` is complete on a real Android phone and an iPhone.
5. The version in `app.json` is raised for any native change.
