import type { TimingStats, TimingStatsDriver } from "@/types/state.type";

import { toMillis } from "@/lib/lapTime";

const SECTORS = [0, 1, 2];

export const formatMillis = (ms: number): string => {
	const minutes = Math.floor(ms / 60_000);
	const seconds = ((ms % 60_000) / 1000).toFixed(3).padStart(6, "0");

	return `${minutes}:${seconds}`;
};

/**
 * Sum of the fastest (purple) time of each sector across all drivers.
 * Returns null until every sector has been set by at least one driver.
 */
export const getIdealLap = (timingStats: TimingStats | undefined): string | null => {
	if (!timingStats?.Lines) return null;

	const lines = Object.values(timingStats.Lines);

	let total = 0;

	for (const sector of SECTORS) {
		const times = lines
			.map((line) => toMillis(line.BestSectors?.[sector]?.Value))
			.filter((time): time is number => time !== null && time > 0);

		if (times.length === 0) return null;

		total += Math.min(...times);
	}

	return formatMillis(total);
};

export const getDriverIdealMillis = (bestSectors: TimingStatsDriver["BestSectors"] | undefined): number | null => {
	let total = 0;

	for (const sector of SECTORS) {
		const time = toMillis(bestSectors?.[sector]?.Value);

		if (time === null || time <= 0) return null;

		total += time;
	}

	return total;
};

/**
 * Sum of a single driver's own best time in each sector.
 * Returns null until the driver has set a time in every sector.
 */
export const getDriverIdealLap = (bestSectors: TimingStatsDriver["BestSectors"] | undefined): string | null => {
	const ideal = getDriverIdealMillis(bestSectors);

	return ideal === null ? null : formatMillis(ideal);
};

/**
 * Milliseconds the last lap was slower than the best lap.
 * Returns null until both are known.
 */
export const getLastLapGap = (lastLap: string | undefined, bestLap: string | undefined): number | null => {
	const last = toMillis(lastLap);
	const best = toMillis(bestLap);

	if (last === null || best === null || last <= 0 || best <= 0) return null;

	return last - best;
};
