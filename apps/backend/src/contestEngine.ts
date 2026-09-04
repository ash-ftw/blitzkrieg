import type { AttemptResult, ContestSnapshot, ContestStatus, IncidentReport, Passage, StationStatus, ViolationType } from "@blitzkrieg/shared";
import { addAuditLog, getAuditLogs } from "./auditLog.js";
import { getRandomPassage } from "./passages.js";
import { listStations, getStation, assignStation, resetStationsToCleanState } from "./stations.js";

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
  name: "Blitzkrieg - College LAN Championship",
  status: "READY",
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

export function onStateChange(callback: () => void) {
  stateChangeCallback = callback;
}

function notifyStateChange() {
  if (stateChangeCallback) {
    stateChangeCallback();
  }
}

export function startRound(round: 1 | 2, actor: string = "HOST") {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  state.round = round;
  state.status = round === 1 ? "ROUND_1" : "ROUND_2";
  state.durationSeconds = round === 1 ? 60 : 180;
  state.remainingSeconds = state.durationSeconds;
  state.activePassage = getRandomPassage(round);
  state.roundStartedAt = Date.now();

  addAuditLog(actor, "START_ROUND", `ROUND_${round}`, `Started Round ${round} (${state.durationSeconds}s) with passage "${state.activePassage.title}"`);

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
      if (station.assignedParticipant && state.qualifiers.includes(station.assignedParticipant)) {
        station.status = "TYPING";
      }
    }
  }

  // Countdown timer
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

      // Mark remaining TYPING stations as SUBMITTED (auto-submit on timer end)
      for (const sSnapshot of listStations()) {
        const s = getStation(sSnapshot.stationCode);
        if (s && s.status === "TYPING") {
          s.status = "SUBMITTED";
        }
      }
    }
    notifyStateChange();
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
      } else if (station.assignedParticipant && state.qualifiers.includes(station.assignedParticipant)) {
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
    }
    notifyStateChange();
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

  if (station.assignedParticipant) {
    attempts.delete(`${station.assignedParticipant}-${state.round}`);
  }

  addAuditLog(actor, "RESET_STATION_ATTEMPT", stationCode, `Reset station attempt for ${station.assignedParticipant ?? stationCode}`);
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
  const stations = listStations()
    .filter((s) => s.participantCode && s.score !== null && s.status !== "DISQUALIFIED")
    .sort((a, b) => {
      if ((b.score ?? 0) !== (a.score ?? 0)) {
        return (b.score ?? 0) - (a.score ?? 0);
      }
      if ((b.accuracy ?? 0) !== (a.accuracy ?? 0)) {
        return (b.accuracy ?? 0) - (a.accuracy ?? 0);
      }
      return (b.wpm ?? 0) - (a.wpm ?? 0);
    });

  state.qualifiers = stations.slice(0, count).map((s) => s.participantCode!);
  state.status = "QUALIFICATION";

  addAuditLog(actor, "CALCULATE_QUALIFIERS", `TOP_${count}`, `Selected ${state.qualifiers.length} qualifiers for Round 2.`);
  notifyStateChange();
  return state.qualifiers;
}

export function submitAttempt(
  participantCode: string,
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
    participantCode,
    stationCode,
    round: state.round,
    wpm: netWpm,
    accuracy,
    score,
    totalErrors,
    submittedAt: new Date().toISOString()
  };

  attempts.set(`${participantCode}-${state.round}`, attemptResult);

  // Update station record
  const station = getStation(stationCode);
  if (station) {
    station.status = "SUBMITTED";
    station.wpm = netWpm;
    station.accuracy = accuracy;
    station.score = score;
  }

  addAuditLog(participantCode, "SUBMIT_ATTEMPT", stationCode, `Submitted Round ${state.round}: ${netWpm} WPM, ${accuracy}% Accuracy, Score ${score}`);
  notifyStateChange();
  return attemptResult;
}

export function recordViolation(
  participantCode: string,
  stationCode: string,
  type: ViolationType,
  details: string
) {
  const incident: IncidentReport = {
    id: `inc-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    participantCode,
    stationCode,
    type,
    timestamp: new Date().toLocaleTimeString(),
    details
  };

  incidents.unshift(incident);
  if (incidents.length > 30) {
    incidents.pop();
  }

  addAuditLog(participantCode, "VIOLATION_TRIGGERED", stationCode, `${type}: ${details}`);

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
    recordViolation(station.assignedParticipant ?? "UNKNOWN", stationCode, "RESTART_ATTEMPT", reason);
  }
}

export function transferParticipant(fromStationCode: string, toStationCode: string, actor: string = "HOST") {
  const fromStation = getStation(fromStationCode);
  if (!fromStation || !fromStation.assignedParticipant) {
    throw new Error("Source station has no assigned participant");
  }

  const participantCode = fromStation.assignedParticipant;
  assignStation(fromStationCode, null);
  assignStation(toStationCode, participantCode);

  addAuditLog(actor, "TRANSFER_STATION", `${fromStationCode} -> ${toStationCode}`, `Transferred ${participantCode} due to technical fault.`);
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

  state.status = "READY";
  state.round = 1;
  state.durationSeconds = 60;
  state.remainingSeconds = 60;
  state.isLocked = false;
  state.qualifiers = [];
  state.activePassage = null;
  state.roundStartedAt = null;

  incidents.length = 0;
  attempts.clear();

  resetStationsToCleanState();

  addAuditLog(actor, "RESET_CONTEST", "COMPETITION", "Reset contest and all station scores to clean ready state.");
  notifyStateChange();
}

export function exportCsvResults(): string {

  const stations = listStations()
    .filter((s) => s.participantCode)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const headers = ["Rank", "Participant Code", "Station Code", "Status", "WPM", "Accuracy (%)", "Final Score"];
  const rows = stations.map((s, index) => [
    index + 1,
    s.participantCode,
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
    auditLogs: getAuditLogs()
  };
}
