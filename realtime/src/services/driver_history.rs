use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use serde_json::{Map, Value, json};

/// Feed messages can repeat a lap's value; no real lap is this short.
const MIN_LAP_INTERVAL: Duration = Duration::from_secs(30);

/// Safety car, red flag and virtual safety car track status codes.
const NEUTRALIZED_STATUSES: [&str; 4] = ["4", "5", "6", "7"];

struct DriverLaps {
    laps: Vec<Value>,
    /// The lap in progress can't be used for pace (pit, neutralization or
    /// unknown start, such as the first lap or a lap spanning a reconnect).
    dirty: bool,
    last_lap_at: Option<Instant>,
}

impl DriverLaps {
    fn new() -> Self {
        Self {
            laps: Vec::new(),
            dirty: true,
            last_lap_at: None,
        }
    }
}

/// Per-session lap history. The live feed only exposes each driver's last and
/// best lap, so laps are recorded here as they complete. It outlives reconnects
/// and is only cleared when the session changes.
#[derive(Default)]
pub struct DriverHistory {
    session: Option<String>,
    drivers: HashMap<String, DriverLaps>,
    neutralized: bool,
}

impl DriverHistory {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn begin_connection(&mut self, initial: &Value) {
        let session = initial
            .pointer("/SessionInfo/Path")
            .and_then(Value::as_str)
            .map(str::to_owned);

        if session != self.session {
            self.drivers.clear();
            self.session = session;
        }

        for driver in self.drivers.values_mut() {
            driver.dirty = true;
        }

        self.neutralized = is_neutralized(initial.pointer("/TrackStatus/Status"));
    }

    pub fn to_value(&self) -> Value {
        let drivers = self
            .drivers
            .iter()
            .map(|(number, driver)| {
                let laps = driver
                    .laps
                    .iter()
                    .enumerate()
                    .map(|(index, lap)| (index.to_string(), lap.clone()))
                    .collect::<Map<_, _>>();

                (number.clone(), json!({ "Laps": laps }))
            })
            .collect::<Map<_, _>>();

        Value::Object(drivers)
    }

    /// Feeds an update that was already merged into `state`. Returns the
    /// `DriverHistory` delta to publish when laps were recorded.
    pub fn observe(
        &mut self,
        topic: &str,
        data: &Value,
        state: &Value,
        now: Instant,
    ) -> Option<Value> {
        match topic {
            "TrackStatus" => {
                self.observe_track_status(data);
                None
            }
            "TimingData" => self.observe_timing_data(data, state, now),
            _ => None,
        }
    }

    fn observe_track_status(&mut self, data: &Value) {
        let Some(status) = data.get("Status") else {
            return;
        };

        self.neutralized = is_neutralized(Some(status));

        if self.neutralized {
            for driver in self.drivers.values_mut() {
                driver.dirty = true;
            }
        }
    }

    fn observe_timing_data(&mut self, data: &Value, state: &Value, now: Instant) -> Option<Value> {
        let lines = data.get("Lines")?.as_object()?;

        let mut recorded = Map::new();

        for (number, line) in lines {
            if is_set(Some(line), "InPit") || is_set(Some(line), "PitOut") {
                self.driver(number).dirty = true;
            }

            let value = line
                .pointer("/LastLapTime/Value")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty());

            if let Some(value) = value
                && let Some(laps) = self.record_lap(number, value, state, now)
            {
                recorded.insert(number.clone(), json!({ "Laps": laps }));
            }
        }

        (!recorded.is_empty()).then(|| json!({ "DriverHistory": recorded }))
    }

    fn record_lap(
        &mut self,
        number: &str,
        value: &str,
        state: &Value,
        now: Instant,
    ) -> Option<Value> {
        let line = state.pointer(&format!("/TimingData/Lines/{number}"));
        let in_pit = is_set(line, "InPit") || is_set(line, "PitOut");
        let stints = state.pointer(&format!("/TimingAppData/Lines/{number}/Stints"));
        let (stint_index, stint) = last_stint(stints);

        let session = self.session.clone();
        let neutralized = self.neutralized;
        let driver = self.driver(number);

        if driver
            .last_lap_at
            .is_some_and(|last| now.duration_since(last) < MIN_LAP_INTERVAL)
        {
            return None;
        }

        let lap = json!({
            "Session": session,
            "Value": value,
            "Clean": !driver.dirty,
            "Stint": stint_index,
            "Compound": stint.and_then(|stint| stint.get("Compound")),
            "TyreAge": stint.and_then(|stint| stint.get("TotalLaps")),
        });

        let index = driver.laps.len().to_string();

        driver.laps.push(lap.clone());
        driver.dirty = in_pit || neutralized;
        driver.last_lap_at = Some(now);

        Some(json!({ index: lap }))
    }

    fn driver(&mut self, number: &str) -> &mut DriverLaps {
        self.drivers
            .entry(number.to_owned())
            .or_insert_with(DriverLaps::new)
    }
}

fn is_neutralized(status: Option<&Value>) -> bool {
    status
        .and_then(Value::as_str)
        .is_some_and(|status| NEUTRALIZED_STATUSES.contains(&status))
}

fn is_set(line: Option<&Value>, field: &str) -> bool {
    line.and_then(|line| line.get(field))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// Stints are an array, or an object keyed by index when built from updates.
fn last_stint(stints: Option<&Value>) -> (Option<usize>, Option<&Value>) {
    match stints {
        Some(Value::Array(stints)) if !stints.is_empty() => (Some(stints.len() - 1), stints.last()),
        Some(Value::Object(stints)) => stints
            .iter()
            .filter_map(|(key, stint)| Some((key.parse::<usize>().ok()?, stint)))
            .max_by_key(|(index, _)| *index)
            .map_or((None, None), |(index, stint)| (Some(index), Some(stint))),
        _ => (None, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAP_GAP: Duration = Duration::from_secs(75);

    fn state(session: &str) -> Value {
        json!({
            "SessionInfo": { "Path": session },
            "TrackStatus": { "Status": "1" },
            "TimingData": { "Lines": { "1": { "InPit": false, "PitOut": false } } },
            "TimingAppData": { "Lines": { "1": {
                "Stints": [{ "Compound": "HARD", "TotalLaps": 3 }, { "Compound": "SOFT", "TotalLaps": 12 }]
            } } },
        })
    }

    fn lap_update(value: &str) -> Value {
        json!({ "Lines": { "1": { "LastLapTime": { "Value": value } } } })
    }

    struct Fixture {
        history: DriverHistory,
        state: Value,
        now: Instant,
    }

    impl Fixture {
        fn new() -> Self {
            let state = state("race");
            let mut history = DriverHistory::new();
            history.begin_connection(&state);

            Self {
                history,
                state,
                now: Instant::now(),
            }
        }

        fn complete_lap(&mut self) -> Option<Value> {
            self.now += LAP_GAP;
            self.history
                .observe("TimingData", &lap_update("1:14.430"), &self.state, self.now)
        }

        fn laps(&self) -> Vec<bool> {
            self.history.drivers["1"]
                .laps
                .iter()
                .map(|lap| lap["Clean"].as_bool().unwrap())
                .collect()
        }
    }

    #[test]
    fn first_lap_is_not_clean_and_following_laps_are() {
        let mut fixture = Fixture::new();

        fixture.complete_lap();
        fixture.complete_lap();

        assert_eq!(fixture.laps(), [false, true]);
    }

    #[test]
    fn records_lap_with_current_stint() {
        let mut fixture = Fixture::new();

        let update = fixture.complete_lap().unwrap();
        let lap = &update["DriverHistory"]["1"]["Laps"]["0"];

        assert_eq!(lap["Value"], "1:14.430");
        assert_eq!(lap["Session"], "race");
        assert_eq!(lap["Stint"], 1);
        assert_eq!(lap["Compound"], "SOFT");
        assert_eq!(lap["TyreAge"], 12);
    }

    #[test]
    fn repeated_lap_message_is_ignored() {
        let mut fixture = Fixture::new();

        fixture.complete_lap();

        let repeated = fixture.history.observe(
            "TimingData",
            &lap_update("1:14.430"),
            &fixture.state,
            fixture.now + Duration::from_secs(1),
        );

        assert!(repeated.is_none());
        assert_eq!(fixture.laps().len(), 1);
    }

    #[test]
    fn pit_stop_dirties_in_progress_lap() {
        let mut fixture = Fixture::new();

        fixture.complete_lap();
        fixture.complete_lap();
        fixture.history.observe(
            "TimingData",
            &json!({ "Lines": { "1": { "PitOut": true } } }),
            &fixture.state,
            fixture.now,
        );
        fixture.complete_lap();
        fixture.complete_lap();

        assert_eq!(fixture.laps(), [false, true, false, true]);
    }

    #[test]
    fn safety_car_dirties_laps_until_it_ends() {
        let mut fixture = Fixture::new();

        fixture.complete_lap();
        fixture.history.observe(
            "TrackStatus",
            &json!({ "Status": "4" }),
            &fixture.state,
            fixture.now,
        );
        fixture.complete_lap();
        fixture.complete_lap();
        fixture.history.observe(
            "TrackStatus",
            &json!({ "Status": "1" }),
            &fixture.state,
            fixture.now,
        );
        fixture.complete_lap();
        fixture.complete_lap();

        assert_eq!(fixture.laps(), [false, false, false, false, true]);
    }

    #[test]
    fn reconnect_keeps_laps_but_dirties_lap_in_progress() {
        let mut fixture = Fixture::new();

        fixture.complete_lap();
        fixture.complete_lap();
        fixture.history.begin_connection(&state("race"));
        fixture.complete_lap();
        fixture.complete_lap();

        assert_eq!(fixture.laps(), [false, true, false, true]);
    }

    #[test]
    fn new_session_clears_laps() {
        let mut fixture = Fixture::new();

        fixture.complete_lap();
        fixture.history.begin_connection(&state("next-session"));

        assert_eq!(fixture.history.to_value(), json!({}));
    }

    #[test]
    fn last_stint_supports_object_keyed_stints() {
        let stints = json!({ "0": { "Compound": "HARD" }, "10": { "Compound": "SOFT" }, "2": {} });

        let (index, stint) = last_stint(Some(&stints));

        assert_eq!(index, Some(10));
        assert_eq!(stint.unwrap()["Compound"], "SOFT");
    }
}
