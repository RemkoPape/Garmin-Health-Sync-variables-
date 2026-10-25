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
			// Locked at 100 on every metric (0.11.1). Unreachable code is deleted, never hidden from this
			// report and never excluded; tests/coverageGate.test.ts pins both the thresholds and the
			// exclude list. Raise nothing here by widening `exclude`: write the test or delete the code.
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100,
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
