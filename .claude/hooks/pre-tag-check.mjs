#!/usr/bin/env node
// PreToolUse hook for Bash. Releases are tag-driven, so:
//  - `gh release create|upload|edit|delete` is blocked outright (release.yml publishes);
//  - `git push --tags` / `--follow-tags` is blocked (it could publish a stable release from an
//    unreviewed commit; push the one tag by name);
//  - before `git tag <semver>` or `git push` of a semver tag, `check-release --with-lint` must pass.
// Anything else passes through. Exit 2 blocks the command and shows Claude the message.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;

/** Classify a shell command: "allow", "block-release-cmd", "block-push-tags" or "needs-check". */
export function classify(command) {
	if (/\bgh\s+release\s+(?:create|upload|edit|delete)\b/.test(command)) return "block-release-cmd";
	if (/\bgit\s+push\b[^\n;&|]*--(?:follow-)?tags\b/.test(command)) return "block-push-tags";
	const createsTag = new RegExp(String.raw`\bgit\s+tag\s+(?:-[a-zA-Z]+\s+)*${SEMVER}\b`).test(command);
	const pushesTag = new RegExp(String.raw`\bgit\s+push\b[^\n;&|]*\s(?:refs/tags/)?${SEMVER}\b`).test(command);
	return createsTag || pushesTag ? "needs-check" : "allow";
}

const MESSAGES = {
	"block-release-cmd": "Blocked: releases are published by release.yml from a tag. Use the release-beta / release-stable skill.",
	"block-push-tags": "Blocked: push the one tag by name (git push origin <tag>), never --tags or --follow-tags.",
};

async function main() {
	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	let command = "";
	try {
		command = JSON.parse(input)?.tool_input?.command ?? "";
	} catch {
		process.exit(0);
	}
	const verdict = classify(command);
	if (verdict === "allow") process.exit(0);
	if (verdict !== "needs-check") {
		process.stderr.write(`${MESSAGES[verdict]}\n`);
		process.exit(2);
	}
	const run = spawnSync("npm", ["run", "check-release", "--", "--with-lint"], {
		encoding: "utf8",
		cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
	});
	if (run.status === 0) process.exit(0);
	process.stderr.write(
		`Release tag blocked: \`npm run check-release -- --with-lint\` failed (exit ${run.status}).\n` +
			`Fix it (see the release-beta skill) before tagging.\n\n${(run.stdout || "").split("\n").slice(-40).join("\n")}\n${run.stderr || ""}`,
	);
	process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
