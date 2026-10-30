// Why it matters: stamp-prerelease is what keeps betas out of main's manifest. Its guards refuse
// the inputs that would make BRAT rank a beta below the stable release or hide a committed beta.
import { describe, expect, it } from "vitest";
import { stampVersions } from "../../scripts/lib/stamp.mjs";

const base = () => ({
	manifest: { id: "x", version: "0.11.0", minAppVersion: "1.13.0" },
	pkg: { name: "x", version: "0.11.0" },
	lock: { name: "x", version: "0.11.0", packages: { "": { name: "x", version: "0.11.0" }, "node_modules/a": { version: "1.0.0" } } },
});

describe("stampVersions", () => {
	it("stamps manifest, package.json and lock root, and nothing else", () => {
		const input = base();
		const out = stampVersions(input, "0.11.1-beta.2");
		expect(out.stable).toBe("0.11.0");
		expect(out.manifest).toEqual({ id: "x", version: "0.11.1-beta.2", minAppVersion: "1.13.0" });
		expect(out.pkg.version).toBe("0.11.1-beta.2");
		expect(out.lock.version).toBe("0.11.1-beta.2");
		expect(out.lock.packages[""].version).toBe("0.11.1-beta.2");
		expect(out.lock.packages["node_modules/a"].version).toBe("1.0.0");
	});

	it("does not mutate its input", () => {
		const input = base();
		stampVersions(input, "0.11.1-beta.1");
		expect(input).toEqual(base());
	});

	it("handles a lock file without a root package entry", () => {
		const input = base();
		input.lock = { name: "x", version: "0.11.0" } as never;
		expect(stampVersions(input, "0.11.1-beta.1").lock.version).toBe("0.11.1-beta.1");
	});

	it.each(["0.11.1", "0.11.1-rc.1", "0.11.1-beta", "v0.11.1-beta.1", "0.11.1-beta.1-x", "", "garbage"])(
		"rejects %j as not a beta tag",
		(tag) => {
			expect(() => stampVersions(base(), tag)).toThrow(/not a beta tag/);
		},
	);

	it("rejects a missing tag", () => {
		expect(() => stampVersions(base(), undefined)).toThrow(/not a beta tag/);
	});

	it("refuses a committed prerelease manifest", () => {
		const input = base();
		input.manifest.version = "0.11.1-beta.1";
		expect(() => stampVersions(input, "0.11.1-beta.2")).toThrow(/already a prerelease/);
	});

	it.each(["0.11.0-beta.1", "0.10.9-beta.1", "0.9.0-beta.3"])("refuses %s: its base is not newer than the stable 0.11.0", (tag) => {
		expect(() => stampVersions(base(), tag)).toThrow(/not newer than the current stable/);
	});

	it("accepts a beta for a later minor or major", () => {
		expect(stampVersions(base(), "0.12.0-beta.1").manifest.version).toBe("0.12.0-beta.1");
		expect(stampVersions(base(), "1.0.0-beta.1").manifest.version).toBe("1.0.0-beta.1");
	});
});
