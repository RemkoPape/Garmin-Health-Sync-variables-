// CI gate: translations move together. Compares the language files at the base of a pull request
// with the checked-out head and fails when an English text changed without the other languages
// following (rules and the I18n-Unchanged escape hatch: scripts/lib/i18nSyncChecks.mjs).
//
//   node scripts/check-i18n-sync.mjs --base <git ref>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCALES, checkI18nSync, declaredUnchanged } from "./lib/i18nSyncChecks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const at = process.argv.indexOf("--base");
const base = at > 0 ? process.argv[at + 1] : undefined;
if (!base) {
  console.error("usage: node scripts/check-i18n-sync.mjs --base <git ref>");
  process.exit(2);
}

const show = (locale) => {
  try {
    return git("show", `${base}:src/i18n/${locale}.ts`);
  } catch {
    return ""; // the file did not exist at the base (new language)
  }
};
const baseTexts = Object.fromEntries(LOCALES.map((l) => [l, show(l)]));
const headTexts = Object.fromEntries(LOCALES.map((l) => [l, readFileSync(join(ROOT, "src", "i18n", `${l}.ts`), "utf8")]));
const problems = checkI18nSync(baseTexts, headTexts, declaredUnchanged(git("log", "--format=%B", `${base}..HEAD`)));

if (problems.length === 0) {
  console.log(`ok   translations move together (base ${base.slice(0, 12)})`);
} else {
  console.error("FAIL translations do not move together. Update these keys in every language file in the same pull request,");
  console.error("     or, for an English change that needs no retranslation (a typo), add a commit-message line:");
  console.error("     I18n-Unchanged: <key>[, <key>...]\n");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
