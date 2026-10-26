// Pure rules behind scripts/check-i18n-sync.mjs (the CI "translations move together" gate).
// No I/O here so tests/scripts/i18nSyncChecks.test.ts can exercise them.
//
// The rule: a user-facing English text that is added, reworded or removed in a pull request must be
// added, reworded or removed in every other language file of the same pull request. Fixing a
// translation on its own (English untouched) is fine. An English change that needs no
// retranslation (a typo) is declared in a commit message of the pull request:
//
//     I18n-Unchanged: noticeSomething, commandOther
//
// so the exception is visible in review instead of silent.

/** Every language file under src/i18n/ (t.ts is the lookup, not a language). */
export const LOCALES = ["en", "de", "zh", "ja", "es", "fr"];
export const SOURCE_LOCALE = "en";

/** `\tkey: <value>,` lines of a locale file -> Map(key -> raw value text). */
export function parseLocale(text) {
  const entries = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*([A-Za-z0-9_]+):\s*(.*?),?\s*$/.exec(line);
    if (m) entries.set(m[1], m[2]);
  }
  return entries;
}

/** Keys whose value was added, removed or reworded between two versions of a locale file. */
export function changedKeys(before, after) {
  const a = parseLocale(before);
  const b = parseLocale(after);
  const changed = new Set();
  for (const [key, value] of b) if (a.get(key) !== value) changed.add(key);
  for (const key of a.keys()) if (!b.has(key)) changed.add(key);
  return changed;
}

/** Keys named in `I18n-Unchanged:` lines of commit messages. */
export function declaredUnchanged(commitMessages) {
  const keys = new Set();
  for (const m of String(commitMessages ?? "").matchAll(/^\s*I18n-Unchanged:\s*(.+)$/gim)) {
    for (const key of m[1].split(/[\s,]+/)) if (key) keys.add(key);
  }
  return keys;
}

/**
 * @param {Record<string,string>} base  locale -> file text at the base of the pull request
 * @param {Record<string,string>} head  locale -> file text at its head
 * @param {Set<string>} unchanged       keys declared as needing no retranslation
 * @returns {string[]} one problem per English key that other languages did not follow
 */
export function checkI18nSync(base, head, unchanged = new Set()) {
  const source = changedKeys(base[SOURCE_LOCALE], head[SOURCE_LOCALE]);
  const others = LOCALES.filter((l) => l !== SOURCE_LOCALE);
  const perLocale = Object.fromEntries(others.map((l) => [l, changedKeys(base[l], head[l])]));
  const problems = [];
  for (const key of [...source].sort()) {
    if (unchanged.has(key)) continue;
    const missing = others.filter((l) => !perLocale[l].has(key));
    if (missing.length > 0) problems.push(`${key}: changed in ${SOURCE_LOCALE} but not in ${missing.join(", ")}`);
  }
  return problems;
}
