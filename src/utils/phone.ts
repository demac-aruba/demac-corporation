import { CountryCode, getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';

export const DEFAULT_PHONE_COUNTRY: CountryCode = 'AW';

export type PhoneNormalization = {
  raw: string;
  e164: string;
  display: string;
  country: CountryCode;
  nationalNumber: string;
  valid: boolean;
  explicitInternational: boolean;
};

const countries = new Set<CountryCode>(getCountries());

export function asCountryCode(value?: string): CountryCode {
  return value && countries.has(value as CountryCode) ? value as CountryCode : DEFAULT_PHONE_COUNTRY;
}

export function countryFlag(country: string) {
  return country.toUpperCase().replace(/./g, (letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)));
}

export function countryName(country: CountryCode) {
  try {
    const DisplayNames = (Intl as unknown as { DisplayNames?: new (locales: string[], options: { type: string }) => { of: (value: string) => string | undefined } }).DisplayNames;
    return DisplayNames ? new DisplayNames(['es'], { type: 'region' }).of(country) ?? country : country;
  } catch {
    return country;
  }
}

export function countryCallingCode(country: CountryCode) {
  return `+${getCountryCallingCode(country)}`;
}

export function normalizePhone(rawValue: string, defaultCountryValue?: string): PhoneNormalization {
  const raw = String(rawValue ?? '').trim();
  const defaultCountry = asCountryCode(defaultCountryValue);
  const explicitInternational = raw.startsWith('+') || raw.startsWith('00');
  const candidate = raw.startsWith('00') ? `+${raw.slice(2)}` : raw;
  const parsed = candidate
    ? parsePhoneNumberFromString(candidate, explicitInternational ? undefined : defaultCountry)
    : undefined;
  return {
    raw,
    e164: parsed?.number ?? '',
    display: parsed?.formatInternational() ?? raw,
    country: parsed?.country ?? defaultCountry,
    nationalNumber: parsed?.nationalNumber ?? raw.replace(/\D/g, ''),
    valid: parsed?.isValid() ?? false,
    explicitInternational,
  };
}

export function internationalSuggestion(rawValue: string, selectedCountryValue?: string) {
  const raw = String(rawValue ?? '').trim();
  if (!raw || raw.startsWith('+') || raw.startsWith('00')) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 9) return null;
  const parsed = parsePhoneNumberFromString(`+${digits}`);
  const selectedCountry = asCountryCode(selectedCountryValue);
  if (!parsed?.isValid() || !parsed.country || parsed.country === selectedCountry) return null;
  return {
    country: parsed.country,
    e164: parsed.number,
    display: parsed.formatInternational(),
  };
}

export function phoneComparisonKey(rawValue: string, countryValue?: string) {
  const normalized = normalizePhone(rawValue, countryValue);
  return normalized.valid ? normalized.e164.replace(/\D/g, '') : rawValue.replace(/\D/g, '');
}

export function formatStoredPhone(rawValue: string, countryValue?: string) {
  const normalized = normalizePhone(rawValue, countryValue);
  return normalized.valid ? normalized.display : rawValue || 'No registrado';
}

export function templateLanguageFor(preferredLanguage: string) {
  if (preferredLanguage === 'Español') return 'es' as const;
  if (preferredLanguage === 'Nederlands') return 'nl' as const;
  return 'en' as const;
}

export function allPhoneCountries() {
  return getCountries().map((country) => ({
    country,
    name: countryName(country),
    callingCode: countryCallingCode(country),
  })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
