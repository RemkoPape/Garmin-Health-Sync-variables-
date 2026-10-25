// Why it matters: reverse geocoding turns a workout's start coordinates into the place name written
// into the note. It talks to a third-party service, so the request, the failure handling and the name
// clean-up must be exact.
import { beforeEach, describe, expect, it } from "vitest";
import { network } from "obsidian";
import { reverseGeocode } from "../src/geocoding";

const URL_RE = /^https:\/\/nominatim\.openstreetmap\.org\/reverse/;
const reply = (address: Record<string, string> | undefined, status = 200) => ({ status, body: address === undefined ? {} : { address } });

beforeEach(() => {
	document.documentElement.lang = "";
});

describe("reverseGeocode request", () => {
	it("asks Nominatim for the coordinates in the document language with a User-Agent", async () => {
		document.documentElement.lang = "de-AT";
		network.on(URL_RE, reply({ city: "Wien", country: "Österreich" }));
		await reverseGeocode(48.2082, 16.3738);
		const [call] = network.calls;
		expect(call?.url).toBe(
			"https://nominatim.openstreetmap.org/reverse?lat=48.2082&lon=16.3738&format=json&zoom=14&accept-language=de",
		);
		expect(call?.headers).toEqual({ "User-Agent": "ObsidianHealthSync/1.0" });
	});

	it("defaults to English when the document has no language", async () => {
		network.on(URL_RE, reply({ city: "Bonn" }));
		await reverseGeocode(50.7, 7.1);
		expect(network.calls[0]?.url).toContain("accept-language=en");
	});
});

describe("reverseGeocode result", () => {
	it("joins the place and the country", async () => {
		network.on(URL_RE, reply({ city: "Bad Honnef", country: "Germany" }));
		expect(await reverseGeocode(50.64, 7.23)).toBe("Bad Honnef, Germany");
	});

	it.each([
		["city", { city: "A", town: "B", village: "C", municipality: "D", residential: "E", county: "F", state: "G" }, "A"],
		["town", { town: "B", village: "C", municipality: "D", residential: "E", county: "F", state: "G" }, "B"],
		["village", { village: "C", municipality: "D", residential: "E", county: "F", state: "G" }, "C"],
		["municipality", { municipality: "D", residential: "E", county: "F", state: "G" }, "D"],
		["residential", { residential: "E", county: "F", state: "G" }, "E"],
		["county", { county: "F", state: "G" }, "F"],
		["state", { state: "G" }, "G"],
	])("prefers the %s", async (_label, address, place) => {
		network.on(URL_RE, reply({ ...address, country: "X" }));
		expect(await reverseGeocode(1, 2)).toBe(`${place}, X`);
	});

	it("returns just the place, or just the country, when only one is known", async () => {
		network.on(URL_RE, reply({ town: "Hallstatt" }));
		expect(await reverseGeocode(1, 2)).toBe("Hallstatt");
		network.reset();
		network.on(URL_RE, reply({ country: "Austria" }));
		expect(await reverseGeocode(1, 2)).toBe("Austria");
	});

	it("returns null when the address has neither", async () => {
		network.on(URL_RE, reply({}));
		expect(await reverseGeocode(1, 2)).toBeNull();
	});
});

describe("reverseGeocode failures", () => {
	it("returns null without an address in the answer (coordinates in the ocean)", async () => {
		network.on(URL_RE, reply(undefined));
		expect(await reverseGeocode(0, 0)).toBeNull();
	});

	it("returns null on a non-200 answer", async () => {
		network.on(URL_RE, { status: 204 });
		expect(await reverseGeocode(1, 2)).toBeNull();
	});

	it("returns null when the request is rejected (HTTP error or no network)", async () => {
		network.on(URL_RE, { status: 429 });
		expect(await reverseGeocode(1, 2)).toBeNull();
		network.reset();
		network.fail(URL_RE);
		expect(await reverseGeocode(1, 2)).toBeNull();
	});

	it("returns null when the body is not JSON", async () => {
		network.on(URL_RE, { status: 200, body: "<html>" });
		expect(await reverseGeocode(1, 2)).toBeNull();
	});
});

describe("multi-script clean-up", () => {
	it("keeps only the Latin part of a multi-script name", async () => {
		network.on(URL_RE, reply({ village: "Oualidia ⵍⵡⴰⵍⵉⴷⵢⵢⴰ الوليدية", country: "Morocco" }));
		expect(await reverseGeocode(1, 2)).toBe("Oualidia, Morocco");
	});

	it("keeps the whole name when every word is in another script", async () => {
		network.on(URL_RE, reply({ city: "東京", country: "日本" }));
		expect(await reverseGeocode(1, 2)).toBe("東京, 日本");
		network.reset();
		network.on(URL_RE, reply({ city: "Москва" }));
		expect(await reverseGeocode(1, 2)).toBe("Москва");
	});

	it("drops the non-Latin word and keeps the Latin one (Greek next to Latin)", async () => {
		network.on(URL_RE, reply({ city: "Αθήνα Athens" }));
		expect(await reverseGeocode(1, 2)).toBe("Athens");
	});
});

describe("F4: Latin names with diacritics survive the clean-up", () => {
	it.each([
		["Hà Nội", "Hà Nội"],
		["Đà Nẵng", "Đà Nẵng"],
		["Thành phố Hồ Chí Minh", "Thành phố Hồ Chí Minh"],
		["Saint-Étienne", "Saint-Étienne"],
		["Malmö", "Malmö"],
		["Łódź", "Łódź"],
		["İstanbul", "İstanbul"],
	])("keeps %s whole", async (name, expected) => {
		network.on(URL_RE, reply({ city: name }));
		expect(await reverseGeocode(1, 2)).toBe(expected);
	});

	it("still drops other scripts next to a Vietnamese name", async () => {
		network.on(URL_RE, reply({ city: "Hà Nội 河內" }));
		expect(await reverseGeocode(1, 2)).toBe("Hà Nội");
	});
});
