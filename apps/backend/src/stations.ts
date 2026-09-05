/**
 * stations.ts
 *
 * Dynamic station management. Stations are created incrementally as
 * participants join the room — no pre-seeded records.
 */

import type { StationSnapshot, StationStatus } from "@blitzkrieg/shared";

interface StationRecord {
  stationCode: string;
  hostname: string;
  status: StationStatus;
  email: string | null;
  activeSession: string | null;
  lastHeartbeatAt: Date | null;
  wpm: number | null;
  accuracy: number | null;
  score: number | null;
}

const stations = new Map<string, StationRecord>();
let nextStationNumber = 1;

// ─── Dynamic station assignment ─────────────────────────────────────

/**
 * Assign the next available station to a participant.
 * Creates PC-01, PC-02, etc. in the order participants join.
 */
export function assignNextStation(email: string): StationRecord {
  const stationCode = `PC-${String(nextStationNumber).padStart(2, "0")}`;
  nextStationNumber++;

  const record: StationRecord = {
    stationCode,
    hostname: `LAB-${stationCode}`,
    status: "READY",
    email,
    activeSession: null,
    lastHeartbeatAt: new Date(),
    wpm: null,
    accuracy: null,
    score: null
  };

  stations.set(stationCode, record);
  return record;
}

/** Clear all stations and reset the counter. */
export function clearAllStations() {
  stations.clear();
  nextStationNumber = 1;
}

// ─── Query helpers ──────────────────────────────────────────────────

export function listStations(): StationSnapshot[] {
  return Array.from(stations.values()).map(toSnapshot);
}

export function getStation(stationCode: string) {
  return stations.get(normalizeStationCode(stationCode)) ?? null;
}

export function findStationByEmail(email: string): StationRecord | null {
  const normalised = email.trim().toLowerCase();
  for (const station of stations.values()) {
    if (station.email?.toLowerCase() === normalised) {
      return station;
    }
  }
  return null;
}

// ─── Station operations ─────────────────────────────────────────────

export interface StationAssignmentRequest {
  email: string | null;
}

export interface StationHeartbeatRequest {
  email?: string;
  sessionToken?: string;
}

export function assignStation(stationCode: string, email: string | null) {
  const station = requireStation(stationCode);
  station.email = email?.trim().toLowerCase() || null;
  station.activeSession = null;
  station.status = station.email ? "READY" : "AVAILABLE";
  station.lastHeartbeatAt = new Date();

  return toSnapshot(station);
}

export function recordHeartbeat(stationCode: string, request: StationHeartbeatRequest = {}) {
  const station = requireStation(stationCode);
  const email = request.email?.trim().toLowerCase();

  if (email && station.email && email !== station.email) {
    throw new StationError("Participant is not assigned to this station", 403);
  }

  station.lastHeartbeatAt = new Date();
  station.activeSession = request.sessionToken ?? station.activeSession;

  if (station.status === "OFFLINE") {
    station.status = station.email ? "READY" : "AVAILABLE";
  }

  return toSnapshot(station);
}

export function assertStationAssignment(stationCode: string, email: string) {
  const station = requireStation(stationCode);

  if (station.email !== email.trim().toLowerCase()) {
    throw new StationError("Participant is not assigned to this station", 403);
  }
}

// ─── Error class ────────────────────────────────────────────────────

export class StationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

// ─── Internal helpers ───────────────────────────────────────────────

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
    email: station.email,
    status: station.status,
    wpm: station.wpm,
    accuracy: station.accuracy,
    score: station.score,
    lastHeartbeatSecondsAgo: station.lastHeartbeatAt ? Math.max(0, Math.round((Date.now() - station.lastHeartbeatAt.getTime()) / 1000)) : null
  };
}

// ─── Persistence helpers ────────────────────────────────────────────

/** Return the raw stations map for persistence snapshotting. */
export function getStationsRaw(): Map<string, StationRecord> {
  return stations;
}

/** Get the current counter value for persistence. */
export function getNextStationNumber(): number {
  return nextStationNumber;
}

/** Replace all stations from a persisted snapshot. */
export function restoreStationsFromSnapshot(records: Array<{
  stationCode: string;
  hostname: string;
  status: StationStatus;
  email: string | null;
  activeSession: string | null;
  lastHeartbeatAt: string | null;
  wpm: number | null;
  accuracy: number | null;
  score: number | null;
}>, savedNextStationNumber: number) {
  stations.clear();
  for (const record of records) {
    stations.set(record.stationCode, {
      stationCode: record.stationCode,
      hostname: record.hostname,
      status: record.status,
      email: record.email,
      activeSession: record.activeSession,
      lastHeartbeatAt: record.lastHeartbeatAt ? new Date(record.lastHeartbeatAt) : null,
      wpm: record.wpm,
      accuracy: record.accuracy,
      score: record.score
    });
  }
  nextStationNumber = savedNextStationNumber;
}
