import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { sw } from './sw';

export type Language = 'en' | 'sw';
const KEY = 'farmgo.language';

function deviceLanguage(): Language {
  const code = getLocales()[0]?.languageCode;
  return code === 'sw' ? 'sw' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, sw: { translation: sw } },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Restore the user's saved choice (called once at startup). */
export async function restoreLanguage() {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved === 'en' || saved === 'sw') await i18n.changeLanguage(saved);
  } catch {
    // storage unavailable: keep the device language
  }
}

export async function setLanguage(lang: Language) {
  await i18n.changeLanguage(lang);
  try {
    await AsyncStorage.setItem(KEY, lang);
  } catch {
    // not persisted, still applied for this session
  }
}

export function currentLanguage(): Language {
  return i18n.language === 'sw' ? 'sw' : 'en';
}

export default i18n;
