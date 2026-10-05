import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/** The role picked on "Create Your Account", carried through sign-up into profile setup. */
export type SignupRole = 'hotel' | 'farmer' | 'youth' | 'household';

const KEY = 'farmgo.signupRole';

interface IntentState {
  role: SignupRole | null;
  setRole: (r: SignupRole | null) => void;
  restore: () => Promise<void>;
}

export const useSignupIntent = create<IntentState>((set) => ({
  role: null,
  setRole: (role) => {
    set({ role });
    if (role) void AsyncStorage.setItem(KEY, role).catch(() => undefined);
    else void AsyncStorage.removeItem(KEY).catch(() => undefined);
  },
  restore: async () => {
    try {
      const v = await AsyncStorage.getItem(KEY);
      if (v === 'hotel' || v === 'farmer' || v === 'youth' || v === 'household') set({ role: v });
    } catch {
      // ignore
    }
  },
}));

/** Farmers and households sign up by phone; businesses by email. */
export const signupMethod = (r: SignupRole | null): 'phone' | 'email' =>
  r === 'hotel' || r === 'youth' ? 'email' : 'phone';
