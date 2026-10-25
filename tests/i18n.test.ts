// Why it matters: a missing or malformed translation shows users a raw key, and a lost {placeholder}
// shows them a literal "{count}" in a notice. Every language must carry every key and every placeholder.
import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";
import { es } from "../src/i18n/es";
import { fr } from "../src/i18n/fr";
import { ja } from "../src/i18n/ja";
import { zh } from "../src/i18n/zh";
import { t } from "../src/i18n/t";

const languages: Record<string, Record<string, string>> = { de, es, fr, ja, zh };
const placeholders = (s: string): string[] => [...s.matchAll(/\{[a-zA-Z]+\}/g)].map((m) => m[0]).sort();

describe("translations", () => {
	for (const [lang, table] of Object.entries(languages)) {
		describe(lang, () => {
			it("has exactly the English key set", () => {
				expect(Object.keys(table).sort()).toEqual(Object.keys(en).sort());
			});

			it("has no empty strings", () => {
				const empty = Object.entries(table).filter(([, v]) => v.trim() === "").map(([k]) => k);
				expect(empty).toEqual([]);
			});

			it("keeps the same {placeholders} as English for every key", () => {
				const diverging = Object.keys(en).filter(
					(k) => placeholders(table[k] ?? "").join() !== placeholders((en as Record<string, string>)[k] ?? "").join(),
				);
				expect(diverging).toEqual([]);
			});
		});
	}

	it("English has no empty strings", () => {
		expect(Object.values(en).filter((v) => v.trim() === "")).toEqual([]);
	});
});

describe("t()", () => {
	it("returns the text in the requested language", () => {
		expect(t("commandSync", "de")).toBe(de.commandSync);
		expect(t("commandSync", "en")).toBe(en.commandSync);
	});

	it("defaults to English", () => {
		expect(t("commandSync")).toBe(en.commandSync);
	});

	it("falls back to English for an unknown language", () => {
		expect(t("commandSync", "xx")).toBe(en.commandSync);
	});

	it("falls back to the key itself when no table has it", () => {
		expect(t("no_such_key" as never, "de")).toBe("no_such_key");
	});

	it("falls back to English when a language lacks a key", () => {
		const original = (de as Record<string, string>).commandSync;
		delete (de as Record<string, string>).commandSync;
		try {
			expect(t("commandSync", "de")).toBe(en.commandSync);
		} finally {
			(de as Record<string, string>).commandSync = original as string;
		}
	});
});
