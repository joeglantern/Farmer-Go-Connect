import type { Href } from 'expo-router';
import type { PlatformRole } from '../data/session';
import type { IconName } from '../ui/Icon';

/** Top-level tab routes that exist under src/app/(app)/(tabs). */
export type TabRoute =
  | 'home'
  | 'orders'
  | 'sell'
  | 'messages'
  | 'profile'
  | 'scan'
  | 'history'
  | 'people'
  | 'money'
  | 'logistics';

export interface NavItem {
  key: string;
  labelKey: string;
  icon: IconName;
  href: Href;
  /** Present when the item is also a bottom tab on phones. */
  tab?: TabRoute;
  /** Emphasised center action on phones (farmer "Sell"). */
  primary?: boolean;
}

export interface NavSection {
  titleKey?: string;
  items: NavItem[];
}

const home: NavItem = { key: 'home', labelKey: 'tabs.home', icon: 'home', href: '/home', tab: 'home' };
const orders: NavItem = {
  key: 'orders',
  labelKey: 'tabs.orders',
  icon: 'orders',
  href: '/orders',
  tab: 'orders',
};
const messages: NavItem = {
  key: 'messages',
  labelKey: 'tabs.messages',
  icon: 'messages',
  href: '/messages',
  tab: 'messages',
};
const profile: NavItem = {
  key: 'profile',
  labelKey: 'tabs.profile',
  icon: 'profile',
  href: '/profile',
  tab: 'profile',
};

/** Navigation per role. Sections appear in the sidebar; items with `tab` also on phones. */
export function navFor(role: PlatformRole): NavSection[] {
  switch (role) {
    case 'farmer':
      return [
        {
          items: [
            home,
            orders,
            { key: 'sell', labelKey: 'tabs.sell', icon: 'plus', href: '/sell', tab: 'sell', primary: true },
            messages,
            profile,
          ],
        },
        {
          titleKey: 'nav.farming',
          items: [
            { key: 'demand', labelKey: 'nav.buyersNeed', icon: 'megaphone', href: '/demand-board' },
            { key: 'listings', labelKey: 'tabs.listings', icon: 'basket', href: '/listings' },
            { key: 'matches', labelKey: 'nav.matches', icon: 'handshake', href: '/matches' },
            { key: 'earnings', labelKey: 'nav.earnings', icon: 'wallet', href: '/earnings' },
            { key: 'farms', labelKey: 'nav.farms', icon: 'farm', href: '/farms' },
            { key: 'inputs', labelKey: 'nav.inputs', icon: 'sprout', href: '/inputs' },
            { key: 'prices', labelKey: 'nav.prices', icon: 'chart', href: '/prices' },
          ],
        },
      ];
    case 'input_supplier':
      return [
        {
          items: [
            home,
            orders,
            { key: 'products', labelKey: 'tabs.products', icon: 'storefront', href: '/products' },
            profile,
          ],
        },
        {
          titleKey: 'nav.more',
          items: [
            { key: 'earnings', labelKey: 'nav.earnings', icon: 'wallet', href: '/earnings' },
            { key: 'prices', labelKey: 'nav.prices', icon: 'chart', href: '/prices' },
          ],
        },
      ];
    case 'agent':
      return [
        {
          items: [
            { ...home, labelKey: 'tabs.farmers', icon: 'users' },
            {
              key: 'add',
              labelKey: 'tabs.addFarmer',
              icon: 'plus',
              href: '/agent/register',
              tab: 'sell',
              primary: true,
            },
            orders,
            profile,
          ],
        },
        {
          titleKey: 'nav.more',
          items: [{ key: 'demand', labelKey: 'nav.buyersNeed', icon: 'megaphone', href: '/demand-board' }],
        },
      ];
    case 'qa_officer':
      return [
        {
          items: [
            { ...home, labelKey: 'tabs.tasks', icon: 'shield' },
            { key: 'history', labelKey: 'tabs.history', icon: 'clock', href: '/history', tab: 'history' },
            profile,
          ],
        },
      ];
    case 'driver':
      return [
        {
          items: [
            { ...home, labelKey: 'tabs.today', icon: 'truck' },
            { key: 'scan', labelKey: 'tabs.scan', icon: 'scan', href: '/scan', tab: 'scan', primary: true },
            { key: 'history', labelKey: 'tabs.routes', icon: 'route', href: '/history', tab: 'history' },
            profile,
          ],
        },
      ];
    case 'admin':
      return [
        {
          items: [
            { ...home, labelKey: 'tabs.overview', icon: 'chart' },
            orders,
            { key: 'people', labelKey: 'tabs.people', icon: 'users', href: '/people', tab: 'people' },
            { key: 'money', labelKey: 'tabs.money', icon: 'wallet', href: '/money', tab: 'money' },
            {
              key: 'logistics',
              labelKey: 'tabs.logistics',
              icon: 'truck',
              href: '/logistics',
              tab: 'logistics',
            },
          ],
        },
        {
          titleKey: 'nav.more',
          items: [
            { key: 'catalog', labelKey: 'nav.catalog', icon: 'basket', href: '/admin/catalog' },
            { key: 'settings', labelKey: 'tabs.settings', icon: 'settings', href: '/admin/settings' },
            { key: 'viewAs', labelKey: 'viewAs.title', icon: 'eye', href: '/settings/view-as' },
            profile,
          ],
        },
      ];
    default:
      // buyer (hotel, restaurant, household) and anyone not yet onboarded
      return [
        { items: [home, orders, messages, profile] },
        {
          titleKey: 'nav.buying',
          items: [
            { key: 'requirements', labelKey: 'nav.requirements', icon: 'repeat', href: '/requirements' },
            { key: 'matches', labelKey: 'nav.matches', icon: 'handshake', href: '/matches' },
            { key: 'favorites', labelKey: 'nav.favorites', icon: 'heart', href: '/favorites' },
            { key: 'invoices', labelKey: 'nav.invoices', icon: 'invoice', href: '/invoices' },
            { key: 'prices', labelKey: 'nav.prices', icon: 'chart', href: '/prices' },
          ],
        },
      ];
  }
}

export function tabsFor(role: PlatformRole): NavItem[] {
  return navFor(role)
    .flatMap((s) => s.items)
    .filter((i) => i.tab);
}
