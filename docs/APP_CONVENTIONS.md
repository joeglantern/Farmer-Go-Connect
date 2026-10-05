# App conventions (apps/app)

Read this before writing any screen. The Lead reviews every screen against it.

## Stack
Expo SDK 57, Expo Router (typed routes: a link to a screen that does not exist fails typecheck, which is how we catch dead links), React Query, Zustand, i18next. Web preview: `pnpm --filter @farmgo/app web` on :8081 (the Lead keeps one running).

## Where things go
- `src/app/**` routes only. Signed-in screens live under `src/app/(app)/`; top-level destinations under `src/app/(app)/(tabs)/`; everything else is pushed on the stack from `src/app/(app)/`.
- `src/features/<area>/` screen bodies and area components. Route files stay thin: read params, render the feature component.
- `src/data/` React Query hooks and stores. Query keys start with the resource name (`['orders', filters]`, `['order', id]`) so realtime invalidation in `src/data/realtime.ts` reaches them.
- `src/ui/` design system. Never style a raw `Pressable`, `TextInput` or `Text` from react-native in a screen.

## Design system (src/ui)
- Layout: `Screen` (safe areas, scroll, keyboard, sticky `footer`, max width), `Header` (back, title, right actions), `SectionTitle`.
- Text: `Text` with `variant` (type roles in `theme/tokens.ts`) and `tone`. Money and counts use `numeric`.
- Actions: `Button` (primary, secondary, outline, ghost, danger), `IconButton`. Only one primary button per view.
- Inputs: `TextField`, `SearchField`, `PhoneField`, `CodeInput`, `SelectField` + pickers, `Stepper`, `Chip`, `Segmented`, `RadioRow`, `Checkbox`, `Switch`.
- Display: `Card`, `Pill` (status: text plus color, never color alone), `Tag`, `Avatar`, `ProduceImage`, `Divider`.
- Feedback: `useDialog().confirm/alert`, `useToast()`, `Sheet`, `Banner`, `Skeleton`/`SkeletonList`, `EmptyState`, `ErrorState`.
- **Never** use `Alert.alert`, `window.alert/confirm`, or any system pop-up.
- Icons: `Icon` names from `src/ui/Icon.tsx` only. Add a name there if one is missing; never import Phosphor directly.
- Colors, spacing, radius, type: from `useTheme()`. No hex values in screens. Test light and dark.

## Every screen must have
- Loading (skeleton shaped like the content), empty (EmptyState with one action), error (ErrorState with retry), pull to refresh on lists, and work offline without crashing.
- All three widths: compact (<600), medium (600-1023), expanded (>=1024). Use `useSizeClass()`/`useResponsive()`. Restructure on wide screens (columns, list + detail, tables); never just stretch.
- Every string in `src/i18n/en.ts` AND `src/i18n/sw.ts` (the Dictionary type fails the build if sw is missing a key). No em dashes. Buttons name the action ("Place order", not "Submit").
- Accessibility: `accessibilityLabel` on icon-only controls, `accessibilityRole="header"` on titles, 48 dp touch targets, visible keyboard focus on web (the ui components handle it).
- Money is integer cents in data, shown with `kes()` from `src/lib/format.ts`.

## Data
- Use `@farmgo/sdk` types (`z.infer` of the contracts DTOs) and call the API through `src/lib/api.ts` (`api.get/post/...`), which adds the token, `X-Org-Id`, `Accept-Language` and an `Idempotency-Key` on writes.
- Show server error messages through `humanError(err)` from `src/lib/errors.ts`.
- After a write, invalidate the affected query keys; show a toast for success, a Banner or toast for failure.

## Done means
`pnpm --filter @farmgo/app typecheck` green, `npx biome check apps/app` clean, the screen checked in the web preview at 390, 820 and 1440 wide in light and dark, English and Kiswahili.
