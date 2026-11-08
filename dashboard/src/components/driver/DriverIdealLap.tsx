import clsx from "clsx";

import type { TimingStatsDriver } from "@/types/state.type";

import { getDriverIdealLap } from "@/lib/idealLap";

type Props = {
	bestSectors: TimingStatsDriver["BestSectors"] | undefined;
};

export default function DriverIdealLap({ bestSectors }: Props) {
	const idealLap = getDriverIdealLap(bestSectors);

	return (
		<p
			className={clsx("text-lg leading-none font-medium tabular-nums", { "text-zinc-500": !idealLap })}
			title="Sum of this driver's best time in each sector"
		>
			{idealLap ?? "-- -- ---"}
		</p>
	);
}
