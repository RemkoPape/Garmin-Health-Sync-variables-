// Lints styles.css with the two checks Obsidian's community-plugin review applies to it:
//   - no `!important`
//   - no property declared twice in one block (the review warns: "Unexpected duplicate"); a fallback for an older engine goes in an `@supports` block
//   - no CSS feature the review's browser only partially supports (for example the text-decoration longhands)
//
// The browser target is a calibrated guess at the engine the review runs against, not a published fact: "chrome 138"
// is the value that reproduced a real review's findings at the same lines (found on another plugin). Both rules are
// `error` here although the review shows the browser-feature ones as warnings: a warning in the review is still a
// finding on the plugin's page. scripts/check-release.mjs asserts this file keeps both rules enabled.
export default {
	plugins: ["stylelint-no-unsupported-browser-features"],
	rules: {
		"declaration-no-important": true,
		"declaration-block-no-duplicate-properties": true,
		"plugin/no-unsupported-browser-features": [true, { browsers: ["chrome 138"], severity: "error" }],
	},
};
