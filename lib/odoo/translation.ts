/**
 * Odoo translatable-field helpers.
 *
 * Odoo stores translatable text columns (`name`, `description`, etc.) as a
 * JSONB object keyed by locale: `{"en_US": "Down Payment (POS)"}`. For the
 * cleaning UI we want to render and edit just the human text, but we must
 * preserve the JSONB shape on disk so the import step writes the value Odoo
 * expects without losing other locales.
 */

const LOCALE_PATTERN = /^[a-z]{2}(_[A-Z]{2})?$/;

const PREFERRED_LOCALES = ["en_US", "en", "id_ID", "id"];

export type TranslationDict = Record<string, string>;

/**
 * Returns true when `value` is a plain object whose keys all look like
 * locale codes (e.g. "en_US", "fr", "id_ID"). False for arrays, scalars,
 * and objects with non-locale keys.
 */
export function isTranslationDict(value: unknown): value is TranslationDict {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  for (const k of keys) {
    if (!LOCALE_PATTERN.test(k)) return false;
    if (typeof obj[k] !== "string") return false;
  }
  return true;
}

/** Pick the best locale to display from a translation dict. */
export function pickDisplayLocale(dict: TranslationDict): string {
  for (const candidate of PREFERRED_LOCALES) {
    if (candidate in dict) return candidate;
  }
  const first = Object.keys(dict)[0];
  return first ?? "en_US";
}

/**
 * Unwrap a translation dict for display.
 * Returns `{ text, locale }` if value is a translation, or null otherwise.
 */
export function unwrapTranslation(
  value: unknown,
): { text: string; locale: string; original: TranslationDict } | null {
  if (!isTranslationDict(value)) return null;
  const locale = pickDisplayLocale(value);
  return { text: value[locale] ?? "", locale, original: value };
}

/**
 * Wrap a user-edited plain string back into a translation dict, preserving
 * other locales from the original dict. If `original` is not a translation
 * dict (or null), a fresh `{ [locale]: text }` is returned.
 */
export function wrapTranslation(
  original: unknown,
  newText: string,
  locale?: string,
): TranslationDict {
  const base: TranslationDict = isTranslationDict(original)
    ? { ...original }
    : {};
  const targetLocale =
    locale ?? (isTranslationDict(original) ? pickDisplayLocale(original) : "en_US");
  base[targetLocale] = newText;
  return base;
}
