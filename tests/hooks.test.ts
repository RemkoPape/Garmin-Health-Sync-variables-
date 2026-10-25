// Why it matters: releases are tag-driven. The hook is what stops Claude from tagging past a failing
// release check, from publishing by hand, or from pushing every local tag with one command.
import { describe, expect, it } from "vitest";
import { classify } from "../.claude/hooks/pre-tag-check.mjs";

describe("pre-tag-check hook", () => {
	it.each([
		"git status",
		"git push origin main",
		"git push -u origin ci/0.11.1-tooling",
		"gh release view 0.11.1",
		"git tag --list '0.11.1-beta.*'",
		"npm run build",
	])("lets %j through", (cmd) => {
		expect(classify(cmd)).toBe("allow");
	});

	it.each([
		"git tag 0.11.1-beta.2",
		"git tag -a 0.11.1 -m x",
		"git push origin 0.11.1-beta.2",
		"git push origin refs/tags/0.11.1",
		"git add . && git tag 0.11.1 && git push origin 0.11.1",
	])("requires check-release for %j", (cmd) => {
		expect(classify(cmd)).toBe("needs-check");
	});

	it.each(["git push --tags", "git push origin --follow-tags", "git push --follow-tags origin main"])(
		"blocks %j",
		(cmd) => {
			expect(classify(cmd)).toBe("block-push-tags");
		},
	);

	it.each([
		"gh release create 0.11.1 main.js",
		"gh release upload 0.11.1 x --clobber",
		"gh release edit 0.11.1 --latest",
		"gh release delete 0.11.1",
	])("blocks manual publishing: %j", (cmd) => {
		expect(classify(cmd)).toBe("block-release-cmd");
	});
});
