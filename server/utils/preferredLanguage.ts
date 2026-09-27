import type {
  PreferredLanguageMediaType,
  UserPreferredLanguages,
} from '@server/interfaces/api/userSettingsInterfaces';

const ISO_639_3_TO_639_1: Record<string, string> = {
  alb: 'sq',
  ara: 'ar',
  baq: 'eu',
  cat: 'ca',
  ces: 'cs',
  chi: 'zh',
  cze: 'cs',
  dan: 'da',
  deu: 'de',
  dut: 'nl',
  ell: 'el',
  eng: 'en',
  est: 'et',
  eus: 'eu',
  fin: 'fi',
  fra: 'fr',
  fre: 'fr',
  ger: 'de',
  gre: 'el',
  heb: 'he',
  hin: 'hi',
  hrv: 'hr',
  hun: 'hu',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  lit: 'lt',
  nld: 'nl',
  nor: 'no',
  pol: 'pl',
  por: 'pt',
  ron: 'ro',
  rum: 'ro',
  rus: 'ru',
  slk: 'sk',
  slo: 'sk',
  slv: 'sl',
  spa: 'es',
  sqi: 'sq',
  srp: 'sr',
  swe: 'sv',
  tur: 'tr',
  ukr: 'uk',
  vie: 'vi',
  zho: 'zh',
};

export const getPreferredLanguage = (
  preferences: UserPreferredLanguages | null | undefined,
  mediaType: PreferredLanguageMediaType
): string | undefined => {
  if (
    preferences &&
    Object.prototype.hasOwnProperty.call(preferences, mediaType)
  ) {
    return preferences[mediaType] ?? undefined;
  }

  return preferences?.all ?? undefined;
};

export const normalizeLanguageCode = (
  language?: string
): string | undefined => {
  if (!language) return undefined;

  const rawCode =
    language
      .split('/')
      .filter(Boolean)
      .at(-1)
      ?.split(/[-_]/)[0]
      ?.trim()
      .toLowerCase() ?? '';

  if (!rawCode) return undefined;
  return ISO_639_3_TO_639_1[rawCode] ?? rawCode;
};

export const languageCodesMatch = (
  language: string | undefined,
  preferredLanguage: string | undefined
): boolean => {
  const normalizedLanguage = normalizeLanguageCode(language);
  const normalizedPreference = normalizeLanguageCode(preferredLanguage);

  return !!normalizedLanguage && normalizedLanguage === normalizedPreference;
};

export const languageNameMatchesCode = (
  languageName: string | undefined,
  preferredLanguage: string | undefined
): boolean => {
  const languageCode = normalizeLanguageCode(preferredLanguage);
  if (!languageName || !languageCode) return false;

  let displayName = languageCode;
  try {
    displayName =
      new Intl.DisplayNames(['en'], { type: 'language' }).of(languageCode) ??
      languageCode;
  } catch {
    // Keep the code as a fallback for runtimes without Intl.DisplayNames.
  }

  const normalizeName = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean);
  const expected = normalizeName(displayName);
  const actual = normalizeName(languageName);

  return (
    actual.join('') === expected.join('') ||
    expected.some((word) => actual.includes(word))
  );
};
