import { normalizeKenyanPhone } from '@farmgo/contracts';
import { create } from 'zustand';
import i18n, { currentLanguage, setLanguage } from '../i18n';
import { api, configureApi, request } from '../lib/api';
import { secureStorage } from '../lib/secure-storage';
import { toastOutside } from '../ui/overlays/Toast';

const TOKEN_KEY = 'farmgo.session';
const ORG_KEY = 'farmgo.org';
/** The admin's own token, kept while they view the app as another user. */
const ADMIN_KEY = 'farmgo.adminToken';

import type { MeDto } from '@farmgo/contracts';

export type PlatformRole = MeDto['user']['role'];
export type Me = MeDto;
export type OrgProfile = NonNullable<MeDto['organizations'][number]['profile']>;

type Status = 'booting' | 'signedOut' | 'signedIn';

interface SessionState {
  status: Status;
  token: string | null;
  me: Me | null;
  orgId: string | null;
  /** True while an admin is viewing the app as another user (Profile > View as). */
  impersonating: boolean;
  boot: () => Promise<void>;
  viewAs: (userId: string) => Promise<Me>;
  stopViewingAs: () => Promise<void>;
  signInWithToken: (token: string) => Promise<Me>;
  refreshMe: () => Promise<Me | null>;
  setOrg: (orgId: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'booting',
  token: null,
  me: null,
  orgId: null,
  impersonating: false,

  async boot() {
    const [token, orgId, adminToken] = await Promise.all([
      secureStorage.get(TOKEN_KEY),
      secureStorage.get(ORG_KEY),
      secureStorage.get(ADMIN_KEY),
    ]);
    set({ impersonating: !!adminToken });
    if (!token) {
      set({ status: 'signedOut' });
      return;
    }
    set({ token, orgId });
    try {
      // Short timeout: launch must never wait on an unreachable server.
      const me = await request<Me>('GET', '/v1/me', { timeoutMs: 6000 });
      set({ me, status: 'signedIn' });
      void import('./favorites').then((m) => m.useFavorites.getState().sync());
      if (me.user.preferredLanguage) await setLanguage(me.user.preferredLanguage);
    } catch (err) {
      // Offline at launch: stay signed in with no profile until the network returns.
      const status = (err as { status?: number }).status;
      if (status === 401 && adminToken) {
        // The view-as session expired: return to the admin's own account.
        await get().stopViewingAs();
      } else if (status === 401) {
        await secureStorage.remove(TOKEN_KEY);
        set({ token: null, me: null, status: 'signedOut' });
      } else {
        set({ status: 'signedIn' });
      }
    }
  },

  async signInWithToken(token) {
    await secureStorage.set(TOKEN_KEY, token);
    set({ token });
    const me = await api.get<Me>('/v1/me');
    set({ me, status: 'signedIn' });
    void import('./favorites').then((m) => m.useFavorites.getState().sync());
    // A brand-new account keeps the language picked on Welcome (QA APP-015); an existing
    // account brings its saved language with it.
    const lang = currentLanguage();
    if (me.needsOnboarding && me.user.preferredLanguage !== lang) {
      void api.patch('/v1/me', { preferredLanguage: lang }).catch(() => undefined);
    } else if (me.user.preferredLanguage && me.user.preferredLanguage !== lang) {
      await setLanguage(me.user.preferredLanguage);
    }
    return me;
  },

  async refreshMe() {
    if (!get().token) return null;
    const me = await api.get<Me>('/v1/me');
    set({ me });
    return me;
  },

  async setOrg(orgId) {
    await secureStorage.set(ORG_KEY, orgId);
    set({ orgId });
  },

  async viewAs(userId) {
    if (get().impersonating) {
      // Switching straight from one user to another: end this view first, as the admin.
      const admin = await secureStorage.get(ADMIN_KEY);
      try {
        await api.post('/api/auth/sign-out', {});
      } catch {
        // ignore
      }
      await secureStorage.remove(ADMIN_KEY);
      set({ token: admin, impersonating: false });
    }
    const adminToken = get().token;
    if (!adminToken) throw new Error('Not signed in');
    const res = await api.post<{ session: { token: string } }>('/api/auth/admin/impersonate-user', {
      userId,
    });
    await secureStorage.set(ADMIN_KEY, adminToken);
    await secureStorage.remove(ORG_KEY);
    set({ orgId: null, impersonating: true });
    return get().signInWithToken(res.session.token);
  },

  async stopViewingAs() {
    const adminToken = await secureStorage.get(ADMIN_KEY);
    try {
      await api.post('/api/auth/sign-out', {});
    } catch {
      // the view-as session is dropped locally either way
    }
    await Promise.all([secureStorage.remove(ADMIN_KEY), secureStorage.remove(ORG_KEY)]);
    set({ impersonating: false, orgId: null });
    if (!adminToken) {
      await secureStorage.remove(TOKEN_KEY);
      set({ token: null, me: null, status: 'signedOut' });
      return;
    }
    try {
      await get().signInWithToken(adminToken);
    } catch {
      await secureStorage.remove(TOKEN_KEY);
      set({ token: null, me: null, status: 'signedOut' });
    }
  },

  async signOut() {
    if (get().impersonating) return get().stopViewingAs();
    try {
      await api.post('/api/auth/sign-out', {});
    } catch {
      // the token is dropped locally either way
    }
    await Promise.all([secureStorage.remove(TOKEN_KEY), secureStorage.remove(ORG_KEY)]);
    set({ token: null, me: null, orgId: null, status: 'signedOut' });
    void import('./favorites').then((m) => m.useFavorites.setState({ keys: [] }));
  },
}));

/**
 * Switch the app language and, when signed in, save it to the account so the next launch and
 * SMS messages use it too (QA APP-032). Signed out, it is kept on the device only.
 */
export async function changeLanguage(lang: 'en' | 'sw') {
  await setLanguage(lang);
  const { me, token } = useSession.getState();
  if (!me || !token || me.user.preferredLanguage === lang) return;
  useSession.setState({ me: { ...me, user: { ...me.user, preferredLanguage: lang } } });
  try {
    await api.patch('/v1/me', { preferredLanguage: lang });
  } catch {
    toastOutside()?.error(i18n.t('profile.languageNotSaved'));
  }
}

/**
 * The token to use for admin-only calls: the admin's own while viewing as someone else,
 * otherwise the signed-in one.
 */
export async function adminToken(): Promise<string | null> {
  return useSession.getState().impersonating ? secureStorage.get(ADMIN_KEY) : useSession.getState().token;
}

configureApi({
  getToken: () => useSession.getState().token,
  getOrgId: () => useSession.getState().orgId,
  onUnauthorized: () => {
    const s = useSession.getState();
    if (s.status !== 'signedIn') return;
    void (s.impersonating ? s.stopViewingAs() : s.signOut());
  },
});

// ─── Auth actions (Better Auth endpoints) ────────────────────

interface AuthResult {
  token: string;
  user: { id: string };
}

export const auth = {
  normalizePhone: normalizeKenyanPhone,

  sendOtp: (phoneNumber: string) =>
    api.post<{ message: string }>('/api/auth/phone-number/send-otp', { phoneNumber }),

  async verifyOtp(phoneNumber: string, code: string) {
    const res = await api.post<AuthResult>('/api/auth/phone-number/verify', { phoneNumber, code });
    return useSession.getState().signInWithToken(res.token);
  },

  async signInEmail(email: string, password: string) {
    const res = await api.post<AuthResult>('/api/auth/sign-in/email', { email, password });
    return useSession.getState().signInWithToken(res.token);
  },

  async signUpEmail(name: string, email: string, password: string) {
    const res = await api.post<AuthResult>('/api/auth/sign-up/email', { name, email, password });
    return useSession.getState().signInWithToken(res.token);
  },

  requestPasswordReset: (email: string, redirectTo: string) =>
    api.post<{ status: boolean }>('/api/auth/request-password-reset', { email, redirectTo }),

  resetPassword: (token: string, newPassword: string) =>
    api.post<{ status: boolean }>('/api/auth/reset-password', { token, newPassword }),
};

/** Where a signed-in user belongs, from their role and onboarding state. */
export function homeFor(me: Me | null): string {
  if (!me) return '/welcome';
  if (me.needsOnboarding) return '/setup';
  return '/home';
}
