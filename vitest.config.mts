import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		setupFiles: ["testUtils/setup.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov", "json-summary"],
			reportsDirectory: "coverage",
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/*.d.ts",
				// Nothing else: every source file is measured. Do not add to this list, write the test (or
				// delete the dead code). tests/coverageGate.test.ts pins it.
			],
			// Ratchet: the thresholds only go up. Set to the measured floor while the suite is being
			// built, locked at 100 in the last test PR of 0.11.1 (tests/coverageGate.test.ts asserts
			// the 100 once it is locked).
			//
			// 0.11.1 data-layer PR: every module except main.ts, settings.ts and src/ui/ is at 100 %
			// (measured overall 70.05 stmts / 80.37 br / 66.49 fn / 69.45 lines). The floors sit just
			// under that; the rest follows in the dates-and-settings PR.
			thresholds: {
				lines: 69,
				functions: 66,
				branches: 80,
				statements: 70,
			},
		},
	},
	resolve: {
		alias: {
			// The `obsidian` package ships only type definitions at runtime; tests get the mock.
			obsidian: path.resolve(import.meta.dirname, "testUtils/mocks/obsidian.ts"),
		},
	},
});
