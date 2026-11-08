"use client";

import { useState } from "react";
import clsx from "clsx";
import { motion } from "motion/react";

import type { Driver, TimingDataDriver } from "@/types/state.type";

import { useSettingsStore } from "@/stores/useSettingsStore";
import { useDataStore } from "@/stores/useDataStore";

import DriverTag from "./DriverTag";
import DriverDRS from "./DriverDRS";
import DriverGap from "./DriverGap";
import DriverTire from "./DriverTire";
import DriverMiniSectors from "./DriverMiniSectors";
import DriverLapTime from "./DriverLapTime";
import DriverIdealLap from "./DriverIdealLap";
import DriverLastLapGap from "./DriverLastLapGap";
import DriverMetrics from "./DriverMetrics";
import DriverInfo from "./DriverInfo";
import DriverCarMetrics from "./DriverCarMetrics";

type Props = {
	position: number;
	driver: Driver;
	timingDriver: TimingDataDriver;
};

const hasDRS = (drs: number) => drs > 9;

const possibleDRS = (drs: number) => drs === 8;

const inDangerZone = (position: number, sessionPart: number) => {
	switch (sessionPart) {
		case 1:
			return position > 15;
		case 2:
			return position > 10;
		case 3:
		default:
			return false;
	}
};

export default function Driver({ driver, timingDriver, position }: Props) {
	const sessionPart = useDataStore((state) => state.state?.TimingData?.SessionPart);
	const timingStatsDriver = useDataStore((state) => state.state?.TimingStats?.Lines[driver.RacingNumber]);
	const appTimingDriver = useDataStore((state) => state.state?.TimingAppData?.Lines[driver.RacingNumber]);
	const carData = useDataStore((state) => (state?.carsData ? state.carsData[driver.RacingNumber].Channels : undefined));

	const [expanded, setExpanded] = useState(false);

	const hasFastest = timingStatsDriver?.PersonalBestLapTime.Position == 1;

	const carMetrics = useSettingsStore((state) => state.carMetrics);

	const favoriteDriver = useSettingsStore((state) => state.favoriteDrivers.includes(driver.RacingNumber));

	return (
		<motion.div
			layout="position"
			className={clsx("flex flex-col gap-1 rounded-lg p-1.5 select-none", {
				"opacity-50": timingDriver.KnockedOut || timingDriver.Retired || timingDriver.Stopped,
				"bg-sky-800/30": favoriteDriver,
				"bg-violet-800/30": hasFastest,
				"bg-red-800/30": sessionPart != undefined && inDangerZone(position, sessionPart),
			})}
		>
			<div
				role="button"
				tabIndex={0}
				aria-expanded={expanded}
				onClick={() => setExpanded((value) => !value)}
				onKeyDown={(event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					setExpanded((value) => !value);
				}}
				className="grid cursor-pointer items-center gap-2"
				style={{
					gridTemplateColumns: carMetrics
						? "5.5rem 3.5rem 5.5rem 4rem 5rem 5.5rem auto 5rem 5.5rem 10.5rem"
						: "5.5rem 3.5rem 5.5rem 4rem 5rem 5.5rem auto 5rem 5.5rem",
				}}
			>
				<DriverTag className="min-w-full!" short={driver.Tla} teamColor={driver.TeamColour} position={position} />
				<DriverDRS
					on={carData ? hasDRS(carData[45]) : false}
					possible={carData ? possibleDRS(carData[45]) : false}
					inPit={timingDriver.InPit}
					pitOut={timingDriver.PitOut}
				/>
				<DriverTire stints={appTimingDriver?.Stints} />
				<DriverInfo timingDriver={timingDriver} gridPos={appTimingDriver ? parseInt(appTimingDriver.GridPos) : 0} />
				<DriverGap timingDriver={timingDriver} sessionPart={sessionPart} />
				<DriverLapTime last={timingDriver.LastLapTime} best={timingDriver.BestLapTime} hasFastest={hasFastest} />
				<DriverMiniSectors sectors={timingDriver.Sectors} bestSectors={timingStatsDriver?.BestSectors} />
				<DriverIdealLap bestSectors={timingStatsDriver?.BestSectors} />
				<DriverLastLapGap lastLap={timingDriver.LastLapTime.Value} bestLap={timingDriver.BestLapTime.Value} />

				{carMetrics && carData && <DriverCarMetrics carData={carData} />}
			</div>

			{expanded && <DriverMetrics racingNumber={driver.RacingNumber} />}
		</motion.div>
	);
}
