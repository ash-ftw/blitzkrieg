import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AttemptResult, ContestSnapshot, ContestStatus, IncidentReport, Passage, ViolationType } from "@blitzkrieg/shared";
import { addAuditLog, getAuditLogs } from "./auditLog.js";
import { getRandomPassage } from "./passages.js";
import { listStations, getStation, clearAllStations, assignStation } from "./stations.js";
import { getRoomSnapshot } from "./room.js";

interface ContestState {
  name: string;
  status: ContestStatus;
  round: 1 | 2;
  durationSeconds: number;
  remainingSeconds: number;
  isLocked: boolean;
  qualifierCount: number;
  qualifiers: string[];
  activePassage: Passage | null;
  roundStartedAt: number | null;
  timerInterval: NodeJS.Timeout | null;
}

const state: ContestState = {
  name: "Blitzkrieg Competition",
  status: "SETUP",
  round: 1,
  durationSeconds: 60,
  remainingSeconds: 60,
  isLocked: false,
  qualifierCount: 20,
  qualifiers: [],
  activePassage: null,
  roundStartedAt: null,
  timerInterval: null
};

const incidents: IncidentReport[] = [];
const attempts = new Map<string, AttemptResult>();

let stateChangeCallback: (() => void) | null = null;
let timerTickCallback: ((remainingSeconds: number, status: ContestStatus) => void) | null = null;

export function onStateChange(callback: () => void) {
  stateChangeCallback = callback;
}

/** Register a lightweight callback for every-second timer ticks. */
export function onTimerTick(callback: (remainingSeconds: number, status: ContestStatus) => void) {
  timerTickCallback = callback;
}

function notifyStateChange() {
  if (stateChangeCallback) {
    stateChangeCallback();
  }
}

function notifyTimerTick() {
  if (timerTickCallback) {
    timerTickCallback(state.remainingSeconds, state.status);
  }
}

/** Update the competition name (called when room is created). */
export function setCompetitionName(name: string) {
  state.name = name;
  notifyStateChange();
}

/** Mark the contest as READY (all setup done, waiting to start). */
export function markReady(actor: string = "HOST") {
  state.status = "READY";
  addAuditLog(actor, "MARK_READY", "CONTEST", "Contest marked as ready to start.");
  notifyStateChange();
}

export function startRound(round: 1 | 2, actor: string = "HOST") {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  state.round = round;
  state.status = round === 1 ? "STARTING_ROUND_1" : "STARTING_ROUND_2";
  state.durationSeconds = 5;
  state.remainingSeconds = 5;
  state.activePassage = getRandomPassage(round);
  state.roundStartedAt = Date.now();

  addAuditLog(actor, "START_ROUND", `ROUND_${round}`, `Initiating Round ${round} with a 5s countdown`);

  // Set eligible stations to TYPING
  const stations = listStations();
  for (const stationSnapshot of stations) {
    const station = getStation(stationSnapshot.stationCode);
    if (!station) continue;

    if (round === 1) {
      if (station.status === "READY" || station.status === "ASSIGNED") {
        station.status = "TYPING";
      }
    } else {
      // Round 2: Only qualified participants
      if (station.email && state.qualifiers.includes(station.email)) {
        station.status = "TYPING";
      }
    }
  }

  // Countdown timer — uses lightweight tick for every-second updates
  state.timerInterval = setInterval(() => {
    state.remainingSeconds -= 1;
    if (state.remainingSeconds <= 0) {
      if (state.status === "STARTING_ROUND_1" || state.status === "STARTING_ROUND_2") {
        // Countdown finished, begin real typing phase
        state.status = round === 1 ? "ROUND_1" : "ROUND_2";
        state.durationSeconds = round === 1 ? 60 : 180;
        state.remainingSeconds = state.durationSeconds;
        state.roundStartedAt = Date.now();
        addAuditLog("SYSTEM", "ROUND_BEGIN", `ROUND_${round}`, `Round ${round} typing phase started (${state.durationSeconds}s)`);
        notifyStateChange();
        return;
      }

      // Real round over
      state.remainingSeconds = 0;
      if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }
      state.status = round === 1 ? "ROUND_1_COMPLETE" : "ROUND_2_COMPLETE";

      addAuditLog("SYSTEM", "ROUND_COMPLETE", `ROUND_${round}`, `Round ${round} timer reached zero.`);

      // Mark remaining TYPING stations as SUBMITTED (auto-submit on timer end)
      for (const sSnapshot of listStations()) {
        const s = getStation(sSnapshot.stationCode);
        if (s && s.status === "TYPING") {
          s.status = "SUBMITTED";
        }
      }

      // Round ended — full state broadcast
      notifyStateChange();
    } else {
      // Normal tick — lightweight broadcast (just timer + status)
      notifyTimerTick();
    }
  }, 1000);

  notifyStateChange();
}

export function restartRound(round: 1 | 2, actor: string = "HOST") {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  // Clear previous attempts for this round
  for (const [key] of Array.from(attempts.keys())) {
    if (key.endsWith(`-${round}`)) {
      attempts.delete(key);
    }
  }

  state.round = round;
  state.status = round === 1 ? "ROUND_1" : "ROUND_2";
  state.durationSeconds = round === 1 ? 60 : 180;
  state.remainingSeconds = state.durationSeconds;
  state.activePassage = getRandomPassage(round);
  state.roundStartedAt = Date.now();

  addAuditLog(actor, "RESTART_ROUND", `ROUND_${round}`, `Restarted Round ${round} with new passage "${state.activePassage.title}"`);

  const stations = listStations();
  for (const sSnapshot of stations) {
    const station = getStation(sSnapshot.stationCode);
    if (!station) continue;

    if (station.status !== "DISQUALIFIED" && station.status !== "OFFLINE") {
      station.wpm = null;
      station.accuracy = null;
      station.score = null;
      if (round === 1) {
        station.status = "TYPING";
      } else if (station.email && state.qualifiers.includes(station.email)) {
        station.status = "TYPING";
      } else {
        station.status = "READY";
      }
    }
  }

  state.timerInterval = setInterval(() => {
    state.remainingSeconds -= 1;
    if (state.remainingSeconds <= 0) {
      state.remainingSeconds = 0;
      if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }
      state.status = round === 1 ? "ROUND_1_COMPLETE" : "ROUND_2_COMPLETE";

      addAuditLog("SYSTEM", "ROUND_COMPLETE", `ROUND_${round}`, `Round ${round} timer reached zero.`);

      for (const sSnapshot of listStations()) {
        const s = getStation(sSnapshot.stationCode);
        if (s && s.status === "TYPING") {
          s.status = "SUBMITTED";
        }
      }

      notifyStateChange();
    } else {
      notifyTimerTick();
    }
  }, 1000);

  notifyStateChange();
}

export function resetSingleStation(stationCode: string, actor: string = "HOST") {
  const station = getStation(stationCode);
  if (!station) {
    throw new Error("Station not found");
  }

  station.wpm = null;
  station.accuracy = null;
  station.score = null;

  if (state.status === "ROUND_1" || state.status === "ROUND_2") {
    station.status = "TYPING";
  } else {
    station.status = "READY";
  }

  if (station.email) {
    attempts.delete(`${station.email}-${state.round}`);
  }

  addAuditLog(actor, "RESET_STATION_ATTEMPT", stationCode, `Reset station attempt for ${station.email ?? stationCode}`);
  notifyStateChange();
}


export function toggleLock(actor: string = "HOST") {
  state.isLocked = !state.isLocked;
  addAuditLog(actor, "TOGGLE_LOCK", "CONTEST", `Contest configuration ${state.isLocked ? "LOCKED" : "UNLOCKED"}`);
  notifyStateChange();
  return state.isLocked;
}

export function calculateQualifiers(count: number = 20, actor: string = "HOST") {
  state.qualifierCount = count;
  const allStations = listStations();
  
  const stations = allStations
    .filter((s) => s.email && s.score !== null && s.status !== "DISQUALIFIED")
    .sort((a, b) => {
      if ((b.score ?? 0) !== (a.score ?? 0)) {
        return (b.score ?? 0) - (a.score ?? 0);
      }
      if ((b.accuracy ?? 0) !== (a.accuracy ?? 0)) {
        return (b.accuracy ?? 0) - (a.accuracy ?? 0);
      }
      return (b.wpm ?? 0) - (a.wpm ?? 0);
    });

  const qualifiedStations = stations.slice(0, count);
  state.qualifiers = qualifiedStations.map((s) => s.email!);
  
  try {
    const historyData = {
      timestamp: new Date().toISOString(),
      competitionName: state.name,
      qualifiers: qualifiedStations.map(s => ({
        email: s.email,
        score: s.score,
        wpm: s.wpm,
        accuracy: s.accuracy
      }))
    };
    const filename = `qualifiers-history-${Date.now()}.json`;
    const filepath = resolve(process.cwd(), filename);
    writeFileSync(filepath, JSON.stringify(historyData, null, 2), "utf-8");
    console.log(`[contestEngine] Saved qualifiers history to ${filename}`);
  } catch (error) {
    console.error("[contestEngine] Failed to save qualifiers history", error);
  }

  // Update stations status
  for (const s of allStations) {
    const station = getStation(s.stationCode);
    if (!station || !station.email) continue;
    
    if (state.qualifiers.includes(station.email)) {
      station.status = "ASSIGNED";
      station.score = null;
      station.wpm = null;
      station.accuracy = null;
    } else {
      station.status = "DISQUALIFIED";
    }
  }

  state.status = "QUALIFICATION";

  addAuditLog(actor, "CALCULATE_QUALIFIERS", `TOP_${count}`, `Selected ${state.qualifiers.length} qualifiers for Round 2.`);
  notifyStateChange();
  return state.qualifiers;
}

export function submitAttempt(
  email: string,
  stationCode: string,
  typedText: string,
  elapsedTimeMs: number
): AttemptResult {
  const passage = state.activePassage;
  if (!passage) {
    throw new Error("No active passage found for this contest round.");
  }

  const targetText = passage.content;
  let correctChars = 0;
  let totalErrors = 0;

  const totalTyped = typedText.length;
  for (let i = 0; i < totalTyped; i++) {
    if (i < targetText.length && typedText[i] === targetText[i]) {
      correctChars++;
    } else {
      totalErrors++;
    }
  }

  // WPM calculation: (typed characters / 5) / (duration in minutes)
  const durationInMinutes = Math.max(elapsedTimeMs / 1000 / 60, 0.05);
  const grossWpm = (totalTyped / 5) / durationInMinutes;
  const netWpm = Math.max(0, Math.round(grossWpm));

  // Accuracy calculation: (correctChars / totalTyped) * 100
  const accuracy = totalTyped > 0 ? Number(((correctChars / totalTyped) * 100).toFixed(1)) : 100;

  // Final score formula: WPM * Accuracy
  const score = Math.round(netWpm * accuracy);

  const attemptResult: AttemptResult = {
    email,
    stationCode,
    round: state.round,
    wpm: netWpm,
    accuracy,
    score,
    totalErrors,
    submittedAt: new Date().toISOString()
  };

  attempts.set(`${email}-${state.round}`, attemptResult);

  // Update station record
  const station = getStation(stationCode);
  if (station) {
    station.status = "SUBMITTED";
    station.wpm = netWpm;
    station.accuracy = accuracy;
    station.score = score;
  }

  addAuditLog(email, "SUBMIT_ATTEMPT", stationCode, `Submitted Round ${state.round}: ${netWpm} WPM, ${accuracy}% Accuracy, Score ${score}`);
  notifyStateChange();
  return attemptResult;
}

export function recordViolation(
  email: string,
  stationCode: string,
  type: ViolationType,
  details: string
) {
  const incident: IncidentReport = {
    id: `inc-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    email,
    stationCode,
    type,
    timestamp: new Date().toLocaleTimeString(),
    details
  };

  incidents.unshift(incident);
  if (incidents.length > 30) {
    incidents.pop();
  }

  addAuditLog(email, "VIOLATION_TRIGGERED", stationCode, `${type}: ${details}`);

  if (type === "PASTE" || type === "COPY" || type === "MULTIPLE_SESSION" || type === "TAB_SWITCH" || type === "WINDOW_BLUR") {
    const station = getStation(stationCode);
    if (station && station.status !== "DISQUALIFIED") {
      station.status = "DISQUALIFIED";
      addAuditLog("SYSTEM", "AUTO_DISQUALIFY", stationCode, `Station disqualified due to ${type} security violation.`);
    }
  }

  notifyStateChange();
  return incident;
}

export function disqualifyStation(stationCode: string, reason: string, actor: string = "HOST") {
  const station = getStation(stationCode);
  if (station) {
    station.status = "DISQUALIFIED";
    addAuditLog(actor, "DISQUALIFY_STATION", stationCode, reason);
    recordViolation(station.email ?? "UNKNOWN", stationCode, "RESTART_ATTEMPT", reason);
  }
}

export function transferParticipant(fromStationCode: string, toStationCode: string, actor: string = "HOST") {
  const fromStation = getStation(fromStationCode);
  if (!fromStation || !fromStation.email) {
    throw new Error("Source station has no assigned participant");
  }

  const email = fromStation.email;
  assignStation(fromStationCode, null);
  assignStation(toStationCode, email);

  addAuditLog(actor, "TRANSFER_STATION", `${fromStationCode} -> ${toStationCode}`, `Transferred ${email} due to technical fault.`);
  notifyStateChange();
}

export function finalizeContest(actor: string = "HOST") {
  state.status = "FINALIZED";
  addAuditLog(actor, "FINALIZE_CONTEST", "COMPETITION", "Contest finalized. Official results frozen.");
  notifyStateChange();
}

export function resetContestState(actor: string = "HOST") {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  state.status = "SETUP";
  state.round = 1;
  state.durationSeconds = 60;
  state.remainingSeconds = 60;
  state.isLocked = false;
  state.qualifiers = [];
  state.activePassage = null;
  state.roundStartedAt = null;

  incidents.length = 0;
  attempts.clear();

  clearAllStations();

  addAuditLog(actor, "RESET_CONTEST", "COMPETITION", "Reset contest and all stations to clean state.");
  notifyStateChange();
}

export function exportCsvResults(): string {

  const stations = listStations()
    .filter((s) => s.email)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const headers = ["Rank", "Email", "Station Code", "Status", "WPM", "Accuracy (%)", "Final Score"];
  const rows = stations.map((s, index) => [
    index + 1,
    s.email,
    s.stationCode,
    s.status,
    s.wpm ?? 0,
    s.accuracy ?? 0,
    s.score ?? 0
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

export function getContestSnapshot(): ContestSnapshot {
  const stations = listStations();

  return {
    name: state.name,
    status: state.status,
    round: state.round,
    durationSeconds: state.durationSeconds,
    remainingSeconds: state.remainingSeconds,
    isLocked: state.isLocked,
    qualifierCount: state.qualifierCount,
    qualifiers: state.qualifiers,
    activePassage: state.activePassage,
    connectedStations: stations.filter((station) => station.status !== "OFFLINE").length,
    readyStations: stations.filter((station) => station.status === "READY").length,
    typingStations: stations.filter((station) => station.status === "TYPING").length,
    submittedStations: stations.filter((station) => station.status === "SUBMITTED").length,
    disqualifiedStations: stations.filter((station) => station.status === "DISQUALIFIED").length,
    offlineStations: stations.filter((station) => station.status === "OFFLINE").length,
    stations,
    incidents,
    auditLogs: getAuditLogs(),
    room: getRoomSnapshot()
  };
}

// ─── Persistence helpers (raw access for snapshotting) ──────────────

export function getContestStateRaw() {
  return state;
}

export function getAttemptsRaw(): Map<string, AttemptResult> {
  return attempts;
}

export function getIncidentsRaw(): IncidentReport[] {
  return incidents;
}

/** Restore contest engine state from a persisted snapshot. */
export function restoreContestEngine(persisted: {
  name: string;
  status: ContestStatus;
  round: 1 | 2;
  durationSeconds: number;
  remainingSeconds: number;
  isLocked: boolean;
  qualifierCount: number;
  qualifiers: string[];
  activePassage: Passage | null;
  roundStartedAt: number | null;
  attempts: Array<[string, AttemptResult]>;
  incidents: IncidentReport[];
}) {
  // Stop any running timer
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  state.name = persisted.name;
  state.status = persisted.status;
  state.round = persisted.round;
  state.durationSeconds = persisted.durationSeconds;
  state.remainingSeconds = persisted.remainingSeconds;
  state.isLocked = persisted.isLocked;
  state.qualifierCount = persisted.qualifierCount;
  state.qualifiers = [...persisted.qualifiers];
  state.activePassage = persisted.activePassage;
  state.roundStartedAt = persisted.roundStartedAt;

  // Restore attempts
  attempts.clear();
  for (const [key, value] of persisted.attempts) {
    attempts.set(key, value);
  }

  // Restore incidents
  incidents.length = 0;
  incidents.push(...persisted.incidents);

  // If a round was actively running when the crash happened, do NOT
  // restart the timer — the host should manually re-start the round.
  if (state.status === "ROUND_1" || state.status === "ROUND_2") {
    const wasRound = state.round;
    state.status = wasRound === 1 ? "ROUND_1_COMPLETE" : "ROUND_2_COMPLETE";
    addAuditLog("SYSTEM", "CRASH_RECOVERY", `ROUND_${wasRound}`,
      `Server recovered from crash. Round ${wasRound} was in progress (${state.remainingSeconds}s remaining). ` +
      `Status set to COMPLETE — Host should restart the round if needed.`);
  } else {
    addAuditLog("SYSTEM", "CRASH_RECOVERY", "CONTEST", `Server restored from snapshot. Status: ${state.status}`);
  }
}
