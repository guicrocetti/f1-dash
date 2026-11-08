import type { DriverHistoryLap, DriverList, TimingStats, TimingStatsDriver } from "@/types/state.type";

import { getDriverIdealMillis } from "@/lib/idealLap";
import { toMillis } from "@/lib/lapTime";

// laps slower than this ratio of the median are traffic or mistakes, not pace
const REPRESENTATIVE_LAP_RATIO = 1.05;
const MIN_LAPS_FOR_CONSISTENCY = 3;
const MIN_LAPS_FOR_DEGRADATION = 5;

export type StintDegradation = {
	stint: number;
	compound: string | null;
	laps: number;
	/** milliseconds lost per lap of tyre age */
	perLap: number;
};

export type LapStats = {
	cleanLaps: number;
	pace: number | null;
	consistency: number | null;
	stints: StintDegradation[];
};

type MeasuredLap = { millis: number; lap: DriverHistoryLap };

const median = (values: number[]): number => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);

	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const standardDeviation = (values: number[]): number => {
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);

	return Math.sqrt(variance);
};

const slope = (points: { x: number; y: number }[]): number | null => {
	const meanX = points.reduce((sum, { x }) => sum + x, 0) / points.length;
	const meanY = points.reduce((sum, { y }) => sum + y, 0) / points.length;
	const spread = points.reduce((sum, { x }) => sum + (x - meanX) ** 2, 0);

	if (spread === 0) return null;

	return points.reduce((sum, { x, y }) => sum + (x - meanX) * (y - meanY), 0) / spread;
};

export const getLapStats = (laps: DriverHistoryLap[]): LapStats => {
	const clean = laps.flatMap((lap): MeasuredLap[] => {
		const millis = toMillis(lap.Value);
		return lap.Clean && millis !== null && millis > 0 ? [{ millis, lap }] : [];
	});

	if (clean.length === 0) return { cleanLaps: 0, pace: null, consistency: null, stints: [] };

	const limit = median(clean.map(({ millis }) => millis)) * REPRESENTATIVE_LAP_RATIO;
	const representative = clean.filter(({ millis }) => millis <= limit);
	const times = representative.map(({ millis }) => millis);

	const byStint = new Map<number, MeasuredLap[]>();

	for (const measured of representative) {
		const { Stint: stint, TyreAge: age } = measured.lap;
		if (stint === null || age === null) continue;

		byStint.set(stint, [...(byStint.get(stint) ?? []), measured]);
	}

	const stints = Array.from(byStint.entries()).flatMap(([stint, stintLaps]): StintDegradation[] => {
		if (stintLaps.length < MIN_LAPS_FOR_DEGRADATION) return [];

		const perLap = slope(stintLaps.map(({ millis, lap }) => ({ x: lap.TyreAge as number, y: millis })));
		if (perLap === null) return [];

		return [{ stint, compound: stintLaps[0].lap.Compound, laps: stintLaps.length, perLap }];
	});

	return {
		cleanLaps: representative.length,
		pace: median(times),
		consistency: times.length >= MIN_LAPS_FOR_CONSISTENCY ? standardDeviation(times) : null,
		stints: stints.sort((a, b) => a.stint - b.stint),
	};
};

export const getTeammate = (drivers: DriverList | undefined, racingNumber: string) => {
	if (!drivers) return null;

	const team = drivers[racingNumber]?.TeamName;

	return (
		Object.values(drivers).find((driver) => driver.TeamName === team && driver.RacingNumber !== racingNumber) ?? null
	);
};

export const getTeammateDelta = (driver: TimingStatsDriver | undefined, teammate: TimingStatsDriver | undefined) => {
	const delta = (own: number | null, other: number | null) => (own !== null && other !== null ? own - other : null);

	return {
		ideal: delta(getDriverIdealMillis(driver?.BestSectors), getDriverIdealMillis(teammate?.BestSectors)),
		bestLap: delta(toMillis(driver?.PersonalBestLapTime?.Value), toMillis(teammate?.PersonalBestLapTime?.Value)),
	};
};

/** How far each of the driver's best sectors is from the overall fastest. */
export const getSectorDeficits = (
	timingStats: TimingStats | undefined,
	driver: TimingStatsDriver | undefined,
): (number | null)[] => {
	const lines = Object.values(timingStats?.Lines ?? {});

	return [0, 1, 2].map((sector) => {
		const own = toMillis(driver?.BestSectors?.[sector]?.Value);
		const times = lines
			.map((line) => toMillis(line.BestSectors?.[sector]?.Value))
			.filter((time): time is number => time !== null && time > 0);

		return own === null || own <= 0 || times.length === 0 ? null : own - Math.min(...times);
	});
};

export const formatDelta = (millis: number | null): string => {
	if (millis === null) return "--";

	const sign = millis > 0 ? "+" : millis < 0 ? "-" : "";

	return `${sign}${(Math.abs(millis) / 1000).toFixed(3)}`;
};
