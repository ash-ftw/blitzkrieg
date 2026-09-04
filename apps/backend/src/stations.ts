import type { StationSnapshot, StationStatus } from "@blitzkrieg/shared";

interface StationRecord {
  stationCode: string;
  hostname: string;
  status: StationStatus;
  assignedParticipant: string | null;
  activeSession: string | null;
  lastHeartbeatAt: Date | null;
  wpm: number | null;
  accuracy: number | null;
  score: number | null;
}

const stations = new Map<string, StationRecord>();

export function resetStationsToCleanState() {
  stations.clear();
  for (let index = 0; index < 50; index++) {
    const stationNumber = index + 1;
    const stationCode = `PC-${String(stationNumber).padStart(2, "0")}`;
    const assignedParticipant = `BZK${String(stationNumber).padStart(3, "0")}`;

    stations.set(stationCode, {
      stationCode,
      hostname: `LAB-${stationCode}`,
      status: "READY",
      assignedParticipant,
      activeSession: null,
      lastHeartbeatAt: new Date(),
      wpm: null,
      accuracy: null,
      score: null
    });
  }
}

// Initialize clean station records on module load
resetStationsToCleanState();

export interface StationAssignmentRequest {
  participantCode: string | null;
}

export interface StationHeartbeatRequest {
  participantCode?: string;
  sessionToken?: string;
}

export function listStations(): StationSnapshot[] {
  return Array.from(stations.values()).map(toSnapshot);
}

export function getStation(stationCode: string) {
  return stations.get(normalizeStationCode(stationCode)) ?? null;
}

export function assignStation(stationCode: string, participantCode: string | null) {
  const station = requireStation(stationCode);
  station.assignedParticipant = participantCode?.trim().toUpperCase() || null;
  station.activeSession = null;
  station.status = station.assignedParticipant ? "READY" : "AVAILABLE";
  station.lastHeartbeatAt = new Date();

  return toSnapshot(station);
}

export function recordHeartbeat(stationCode: string, request: StationHeartbeatRequest = {}) {
  const station = requireStation(stationCode);
  const participantCode = request.participantCode?.trim().toUpperCase();

  if (participantCode && station.assignedParticipant && participantCode !== station.assignedParticipant) {
    throw new StationError("Participant is not assigned to this station", 403);
  }

  station.lastHeartbeatAt = new Date();
  station.activeSession = request.sessionToken ?? station.activeSession;

  if (station.status === "OFFLINE") {
    station.status = station.assignedParticipant ? "READY" : "AVAILABLE";
  }

  return toSnapshot(station);
}

export function assertStationAssignment(stationCode: string, participantCode: string) {
  const station = requireStation(stationCode);

  if (station.assignedParticipant !== participantCode) {
    throw new StationError("Participant is not assigned to this station", 403);
  }
}

export class StationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

function requireStation(stationCode: string) {
  const station = getStation(stationCode);

  if (!station) {
    throw new StationError("Station is not registered", 404);
  }

  return station;
}

function normalizeStationCode(stationCode: string) {
  return stationCode.trim().toUpperCase();
}

function toSnapshot(station: StationRecord): StationSnapshot {
  return {
    stationCode: station.stationCode,
    participantCode: station.assignedParticipant,
    status: station.status,
    wpm: station.wpm,
    accuracy: station.accuracy,
    score: station.score,
    lastHeartbeatSecondsAgo: station.lastHeartbeatAt ? Math.max(0, Math.round((Date.now() - station.lastHeartbeatAt.getTime()) / 1000)) : null
  };
}
