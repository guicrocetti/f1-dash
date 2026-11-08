"use client";

import { getIdealLap } from "@/lib/idealLap";

import { useDataStore } from "@/stores/useDataStore";

export default function IdealLap() {
	const idealLap = useDataStore((state) => getIdealLap(state.state?.TimingStats));

	return (
		<div className="flex shrink-0 flex-col justify-center" title="Sum of the fastest time of each sector">
			<p className="text-sm leading-none font-medium text-zinc-500">Ideal</p>
			<p className="text-2xl leading-none font-extrabold text-violet-600 tabular-nums">{idealLap ?? "-:--.---"}</p>
		</div>
	);
}
