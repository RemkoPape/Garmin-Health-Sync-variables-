// A scriptable HealthProvider for sync tests: no network, every call recorded.
import type { HealthData, HealthProvider, LoginResult } from "../src/providers/provider";

export class FakeProvider implements HealthProvider {
	readonly id: string = "fake";
	readonly name = "Fake";
	configured = true;
	sessionValid = true;
	authResult: LoginResult = { ok: true, cancelled: false };
	/** Per-date result or error; falls back to `defaultData`. */
	byDate = new Map<string, HealthData | Error>();
	defaultData: HealthData = { metrics: { steps: 8000 }, activities: {} };
	batchDelay: number | undefined = 2000;
	/** Called after each fetchData starts; lets a test observe timing. */
	onFetch: ((date: string) => void) | null = null;
	/** When set, fetchData waits for it after recording the call (holds a sync open). */
	gate: Promise<void> | null = null;

	fetchCalls: { date: string; enabledMetrics: string[] }[] = [];
	authCalls = 0;
	delayCalls: string[][] = [];

	isConfigured(): boolean {
		return this.configured;
	}
	isSessionValid(): boolean {
		return this.sessionValid;
	}
	async authenticate(): Promise<LoginResult> {
		this.authCalls++;
		if (this.authResult.ok) this.sessionValid = true;
		return this.authResult;
	}
	async fetchData(date: string, enabledMetrics: string[]): Promise<HealthData> {
		this.fetchCalls.push({ date, enabledMetrics });
		this.onFetch?.(date);
		if (this.gate) await this.gate;
		const result = this.byDate.get(date) ?? this.defaultData;
		if (result instanceof Error) throw result;
		return result;
	}
	getRecommendedBatchDelay(enabledMetrics: string[]): number {
		this.delayCalls.push(enabledMetrics);
		return this.batchDelay as number;
	}
}

/** A provider without the optional batch delay method. */
export class NoDelayProvider extends FakeProvider {
	constructor() {
		super();
		(this as { getRecommendedBatchDelay?: unknown }).getRecommendedBatchDelay = undefined;
	}
}
