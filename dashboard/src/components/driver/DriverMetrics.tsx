import { type ReactNode, useMemo } from "react";
import clsx from "clsx";

import type { DriverHistoryLap } from "@/types/state.type";

import { formatMillis } from "@/lib/idealLap";
import { formatDelta, getLapStats, getSectorDeficits, getTeammate, getTeammateDelta } from "@/lib/driverMetrics";

import { useDataStore } from "@/stores/useDataStore";

type Props = {
	racingNumber: string;
};

const SPEED_TRAPS = ["I1", "I2", "FL", "ST"] as const;

export default function DriverMetrics({ racingNumber }: Props) {
	const drivers = useDataStore((state) => state.state?.DriverList);
	const timingStats = useDataStore((state) => state.state?.TimingStats);
	const session = useDataStore((state) => state.state?.SessionInfo?.Path);
	const history = useDataStore((state) => state.state?.DriverHistory?.[racingNumber]);

	const driver = timingStats?.Lines[racingNumber];
	const teammate = getTeammate(drivers, racingNumber);
	const delta = getTeammateDelta(driver, teammate ? timingStats?.Lines[teammate.RacingNumber] : undefined);
	const deficits = getSectorDeficits(timingStats, driver);

	const stats = useMemo(() => {
		const laps: DriverHistoryLap[] = Object.values(history?.Laps ?? {}).filter((lap) => lap.Session === session);
		return getLapStats(laps);
	}, [history, session]);

	return (
		<div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-zinc-800 px-1 pt-2 pb-1 lg:grid-cols-5">
			<Section title={teammate ? `vs ${teammate.Tla}` : "Teammate"}>
				<Metric label="Ideal">
					<Delta value={delta.ideal} />
				</Metric>
				<Metric label="Best lap">
					<Delta value={delta.bestLap} />
				</Metric>
			</Section>

			<Section title="To purple">
				{deficits.map((deficit, i) => (
					<Metric key={`deficit.${i}`} label={`S${i + 1}`}>
						<Delta value={deficit} />
					</Metric>
				))}
			</Section>

			<Section title="Speed (km/h)">
				{SPEED_TRAPS.map((trap) => {
					const speed = driver?.BestSpeeds?.[trap];

					return (
						<Metric key={trap} label={trap}>
							{speed?.Value ? `${speed.Value} P${speed.Position}` : "--"}
						</Metric>
					);
				})}
			</Section>

			<Section title="Race pace">
				<Metric label="Median">{stats.pace !== null ? formatMillis(Math.round(stats.pace)) : "--"}</Metric>
				<Metric label="Std dev">{stats.consistency !== null ? `${Math.round(stats.consistency)} ms` : "--"}</Metric>
				<Metric label="Clean laps">{stats.cleanLaps}</Metric>
			</Section>

			<Section title="Tyre degradation">
				{stats.stints.length === 0 && <p className="text-zinc-500">Needs 5+ clean laps</p>}

				{stats.stints.map((stint) => (
					<Metric key={`stint.${stint.stint}`} label={`${stint.compound ?? "Stint"} (${stint.laps})`}>
						{`${formatDelta(stint.perLap)}/lap`}
					</Metric>
				))}
			</Section>
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="flex min-w-32 flex-col gap-0.5 text-sm leading-tight">
			<h3 className="font-medium text-zinc-500">{title}</h3>
			{children}
		</div>
	);
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex justify-between gap-3">
			<span className="text-zinc-400">{label}</span>
			<span className="font-medium tabular-nums">{children}</span>
		</div>
	);
}

function Delta({ value }: { value: number | null }) {
	return (
		<span
			className={clsx({
				"text-emerald-500": value !== null && value < 0,
				"text-red-500": value !== null && value > 0,
				"text-zinc-500": value === null,
			})}
		>
			{formatDelta(value)}
		</span>
	);
}
