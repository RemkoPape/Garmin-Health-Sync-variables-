import { shiftDate } from "../../dates";
import { computeLoad, type LoadModel } from "../cards/load-card";
import { computeSleep, type SleepModel } from "../cards/sleep-card";
import type { DayIndex } from "../index";
import { baseline, windowValues, zScore } from "../stats";
import { longView, type LongView } from "../longview";

/** The smallest standard deviation per metric, so a very steady user does not get razor-thin ranges. */
const SD_FLOOR = { hrv: 2, resting_hr: 1.5, spo2: 0.7, respiration_rate: 0.4, stress: 5, steps: 500 };
const BASELINE_DAYS = 30;
const MIN_DAYS = 5;

/**
 * What the interpretations look at besides the card itself: how a metric compares with the person's own last
 * 30 days, last night's sleep, the training load and the day before. Computed once per card, on demand.
 */
export class Signals {
	private sleepModel: SleepModel | null = null;
	private loadModel: LoadModel | null = null;

	constructor(readonly index: DayIndex, readonly date: string, readonly birthYear: number | null) {}

	/** Distance of a metric on a day (default: the shown day) from the person's own 30-day mean, in standard deviations. */
	z(key: keyof typeof SD_FLOOR, date: string = this.date): number | null {
		return this.deviation(key, date)?.z ?? null;
	}

	/** The same distance in the unit of the metric. */
	delta(key: keyof typeof SD_FLOOR, date: string = this.date): number | null {
		return this.deviation(key, date)?.delta ?? null;
	}

	private deviation(key: keyof typeof SD_FLOOR, date: string): { z: number; delta: number } | null {
		const value = this.index.value(key, date);
		const b = baseline(windowValues(this.index, key, date, BASELINE_DAYS), MIN_DAYS, SD_FLOOR[key]);
		return value !== null && b ? { z: zScore(value, b), delta: value - b.mean } : null;
	}

	/** The last year of a metric, null with fewer than 60 days of values. */
	long(key: keyof typeof SD_FLOOR): LongView | null {
		return longView((d) => this.index.value(key, d), this.date);
	}

	yesterday(): string {
		return shiftDate(this.date, -1);
	}

	sleep(): SleepModel {
		return (this.sleepModel ??= computeSleep(this.index, this.date, this.birthYear));
	}

	load(): LoadModel {
		return (this.loadModel ??= computeLoad(this.index, this.date, this.birthYear));
	}
}
