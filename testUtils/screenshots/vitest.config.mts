import { defineConfig } from "vitest/config";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

// Same environment as the unit tests (the Obsidian mock, happy-dom helpers), but runs only the screenshot capture.
export default defineConfig({
	root,
	test: {
		include: ["testUtils/screenshots/*.shots.ts"],
		setupFiles: ["testUtils/setup.ts"],
	},
	resolve: { alias: { obsidian: path.resolve(root, "testUtils/mocks/obsidian.ts") } },
});
