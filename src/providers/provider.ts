/** Structured training data for machine-readable output */
export interface TrainingEntry {
	type: string;
	category: string;
	distance_km?: number;
	distance_mi?: number;
	duration_min?: number;
	avg_hr?: number;
	calories?: number;
}

/** One exercise from a strength activity (from Garmin's exercise sets) */
export interface StrengthExercise {
	exercise: string;
	sets: number;
	reps: number[];
	weights_kg?: number[];
	max_weight_kg?: number;
}

/** Normalized health data — provider-independent */
export interface HealthData {
	/** Metrics as key-value pairs (normalized keys) */
	metrics: Record<string, number | string>;
	/** Activities/trainings as key-value pairs (human-readable) */
	activities: Record<string, string>;
	/** Structured training data (machine-readable, optional) */
	trainings?: TrainingEntry[];
	/** Per-exercise strength sets (optional) */
	strength?: StrengthExercise[];
	/** Start coordinates of the first activity with GPS */
	startLocation?: { lat: number; lon: number };
}

/** Result of an interactive login. `cancelled` = the user closed the login
 *  window deliberately (not a stall/escape), so callers can skip a fallback prompt. */
export interface LoginResult {
	ok: boolean;
	cancelled: boolean;
}

/** Interface implemented by every health provider */
export interface HealthProvider {
	/** Unique provider identifier */
	readonly id: string;
	/** Display name */
	readonly name: string;

	/** Checks whether valid credentials are available */
	isConfigured(): boolean;

	/** Perform an interactive login. */
	authenticate(): Promise<LoginResult>;

	/** Checks whether the current session is still valid */
	isSessionValid(): boolean;

	/** Fetch health data for a specific date */
	fetchData(date: string, enabledMetrics: string[]): Promise<HealthData>;

	/** Per-sync options (optional) */
	setOptions?(options: { strengthSets: boolean }): void;

	/** Recommended delay between dates in batch operations (ms) — optional */
	getRecommendedBatchDelay?(enabledMetrics: string[]): number;
}
