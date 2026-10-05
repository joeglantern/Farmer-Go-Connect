import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { PlatformRole } from '../data/session';
import { GUIDE_URL } from './config';

/** The manual's chapter for each role (see public/guide). */
const CHAPTER: Record<PlatformRole, string> = {
  user: 'buyer',
  buyer: 'buyer',
  farmer: 'farmer',
  input_supplier: 'supplier',
  agent: 'agent',
  qa_officer: 'qa',
  driver: 'driver',
  admin: 'admin',
};

/** Open the product manual at the reader's own chapter: a new tab on the web, the in-app browser on phones. */
export function openGuide(role: PlatformRole) {
  const url = `${GUIDE_URL}?role=${CHAPTER[role] ?? 'buyer'}`;
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  void WebBrowser.openBrowserAsync(url, { toolbarColor: '#0E3B22', controlsColor: '#B9CF4B' });
}
