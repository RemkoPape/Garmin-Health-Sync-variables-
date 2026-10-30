#!/usr/bin/env node
// Lint src/ the way the Obsidian community-plugin review bot sees it.
//
// The bot does not install transitive type packages: values typed through `moment` (obsidian
// re-exports it) or `@types/node` are error-typed there even when local lint is clean, and the
// type-aware @typescript-eslint/no-unsafe-* rules then fire. Locally those types resolve, so
// `npm run lint` finds nothing. To see what the bot sees, hide those two packages, lint, put them
// back (AGENTS.md release rule 4, automated).
//
// Errors fail the run; warnings are reported only. Not part of check-release: it renames
// node_modules directories while it runs. A stale hidden folder from an interrupted earlier run is
// restored first. Usage: npm run lint:cloud-parity
import { rename, access } from "node:fs/promises";
import { renameSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NM = join(ROOT, "node_modules");

// [visible, hidden]. Hiding these makes TypeScript fall back to the `error` type.
const TARGETS = [
	["moment", ".cloud-parity-hidden-moment"],
	[join("@types", "node"), join("@types", ".cloud-parity-hidden-node")],
];

const exists = (p) => access(p).then(() => true, () => false);

/** Restore every hidden directory (async path, used in the normal flow). */
async function restore() {
	const failed = [];
	for (const [visible, hidden] of TARGETS) {
		if (await exists(join(NM, hidden))) {
			try {
				await rename(join(NM, hidden), join(NM, visible));
			} catch (e) {
				failed.push(`${hidden} -> ${visible}: ${e.message}`);
			}
		}
	}
	if (failed.length) {
		console.error(`\n!! node_modules was left modified. Run \`npm ci\` to repair:\n  ${failed.join("\n  ")}`);
		process.exitCode = 1;
	}
}

// Synchronous restore for process exit and signals (exit handlers cannot await).
let restored = false;
function restoreSync() {
	if (restored) return;
	restored = true;
	for (const [visible, hidden] of TARGETS) {
		try {
			if (existsSync(join(NM, hidden))) renameSync(join(NM, hidden), join(NM, visible));
		} catch {
			/* best effort; the async path reports failures */
		}
	}
}
process.on("exit", restoreSync);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
	process.on(sig, () => {
		restoreSync();
		process.exit(130);
	});
}

try {
	// An earlier run that was killed hard may have left a folder hidden.
	await restore();
	for (const [visible, hidden] of TARGETS) {
		if (await exists(join(NM, visible))) await rename(join(NM, visible), join(NM, hidden));
	}

	console.log("Linting src/ with `moment` and `@types/node` hidden, as the review bot sees it.\n");
	const r = spawnSync("npx", ["eslint", "src/**/*.ts", "--format", "json"], {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		// A fully cascaded JSON report can exceed spawnSync's 1 MB default and silently kill the child.
		maxBuffer: 64 * 1024 * 1024,
	});
	if (r.status === null) {
		console.error("eslint did not exit cleanly:", r.error?.message || "killed by signal");
		process.exitCode = 1;
	}

	let errors = 0;
	let warnings = 0;
	const byRule = new Map();
	const errorRows = [];
	try {
		for (const f of JSON.parse(r.stdout || "[]")) {
			errors += f.errorCount;
			warnings += f.warningCount;
			for (const m of f.messages) {
				const rule = m.ruleId || "(none)";
				byRule.set(rule, (byRule.get(rule) || 0) + 1);
				if (m.severity === 2) errorRows.push(`${f.filePath.replace(`${ROOT}/`, "")}:${m.line}:${m.column}  ${rule}  ${m.message}`);
			}
		}
	} catch {
		console.error("could not parse eslint output:", (r.stderr || "").slice(0, 300));
		process.exitCode = 1;
	}

	console.log(`${errors} errors, ${warnings} warnings\n`);
	for (const [rule, n] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`  ${String(n).padStart(5)}  ${rule}`);
	}
	if (errors > 0) process.exitCode = 1;
	if (errorRows.length) console.log(`\nERRORS (these can fail the review):\n${errorRows.map((e) => `  ${e}`).join("\n")}`);
	console.log("\nWarnings here are a diagnostic; only errors change the verdict.");
} finally {
	await restore();
}
