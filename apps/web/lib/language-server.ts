import 'server-only';

import { cookies } from 'next/headers';

import { LANGUAGE_COOKIE, type Language, resolveLanguage } from './language';

export async function getPreferredLanguage(defaultLanguage: Language): Promise<Language> {
  const cookieStore = await cookies();
  return resolveLanguage(cookieStore.get(LANGUAGE_COOKIE)?.value, defaultLanguage);
}
