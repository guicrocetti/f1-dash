import clsx from "clsx";

import { getLastLapGap } from "@/lib/idealLap";

type Props = {
	lastLap: string | undefined;
	bestLap: string | undefined;
};

export default function DriverLastLapGap({ lastLap, bestLap }: Props) {
	const gap = getLastLapGap(lastLap, bestLap);

	return (
		<p
			className={clsx("text-lg leading-none font-medium whitespace-nowrap tabular-nums", {
				"text-zinc-500": gap === null,
			})}
			title="Difference between this driver's last lap and best lap"
		>
			{gap === null ? "-- ms" : `${gap} ms`}
		</p>
	);
}
