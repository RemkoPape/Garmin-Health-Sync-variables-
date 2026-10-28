/**
 * The structure of a Garmin response for the sync diagnostics: field names and types, never values. A bug report that
 * carries it shows exactly what Garmin sent for a watch, so a mapper can be written against the real thing.
 *
 * `{totalSteps: int, userNote: string, heartRate: {rest: int, max: int|null}, devices: [2]{id: string}}`
 */

/** Deepest level written; deeper values are shown as their kind (`object`, `array`). */
const MAX_DEPTH = 4;
/** Longest description of one response; the rest is cut. */
const MAX_LENGTH = 1500;
/** The first elements of a list that are compared to find the fields they have together. */
const SAMPLE_ELEMENTS = 3;
/** A field name Garmin's schema uses: letters, digits and underscores. Anything else (an id used as a key, a name, an address) is not printed. */
const SAFE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/** The kind of a value that is no list and no object. */
function kindOf(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
	if (typeof value === "string") return "string";
	return "bool";
}

function shapeOf(value: unknown, depth: number): string {
	if (Array.isArray(value)) {
		if (value.length === 0) return "[0]";
		if (depth >= MAX_DEPTH) return `[${value.length}]`;
		const shapes = [...new Set(value.slice(0, SAMPLE_ELEMENTS).map((v) => shapeOf(v, depth + 1)))];
		return `[${value.length}]${shapes.join("|")}`;
	}
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>);
		if (depth >= MAX_DEPTH) return `object(${entries.length})`;
		let hidden = 0;
		const parts: string[] = [];
		for (const [key, v] of entries) {
			if (SAFE_KEY.test(key)) parts.push(`${key}: ${shapeOf(v, depth + 1)}`);
			else hidden++;
		}
		if (hidden > 0) parts.push(`${hidden} other key${hidden === 1 ? "" : "s"}`);
		return `{${parts.join(", ")}}`;
	}
	return kindOf(value);
}

/** The shape of a response, cut at a fixed length. */
export function describeShape(data: unknown): string {
	const shape = shapeOf(data, 0);
	return shape.length > MAX_LENGTH ? `${shape.slice(0, MAX_LENGTH)}…` : shape;
}
