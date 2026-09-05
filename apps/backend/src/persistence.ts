/**
 * persistence.ts
 *
 * Periodically saves the full contest state to a JSON file on disk so that
 * a process crash does not wipe scores, qualifiers, or station assignments.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import type { AttemptResult, AuditLogEntry, IncidentReport, Passage, ContestStatus, StationStatus } from "@blitzkrieg/shared";
import type { PersistedRoomState } from "./room.js";

// ─── Snapshot shape persisted to disk ───────────────────────────────

export interface PersistedContestState {
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
}

export interface PersistedStationRecord {
  stationCode: string;
  hostname: string;
  status: StationStatus;
  email: string | null;
  activeSession: string | null;
  lastHeartbeatAt: string | null; // ISO string
  wpm: number | null;
  accuracy: number | null;
  score: number | null;
}

export interface PersistedSnapshot {
  savedAt: string; // ISO timestamp
  contest: PersistedContestState;
  stations: PersistedStationRecord[];
  nextStationNumber: number;
  attempts: Array<[string, AttemptResult]>;
  incidents: IncidentReport[];
  auditLogs: AuditLogEntry[];
  room: PersistedRoomState | null;
}

// ─── Configuration ──────────────────────────────────────────────────

const SNAPSHOT_PATH = resolve(process.cwd(), "blitzkrieg-snapshot.json");
const AUTO_SAVE_INTERVAL_MS = 5_000; // save every 5 seconds

let autoSaveTimer: NodeJS.Timeout | null = null;

// ─── Callbacks (injected by index.ts to avoid circular deps) ────────

let collectFn: (() => PersistedSnapshot) | null = null;
let restoreFn: ((snapshot: PersistedSnapshot) => void) | null = null;

export function registerPersistenceCallbacks(
  collect: () => PersistedSnapshot,
  restore: (snapshot: PersistedSnapshot) => void
) {
  collectFn = collect;
  restoreFn = restore;
}

// ─── Public API ─────────────────────────────────────────────────────

/** Save current state to disk immediately. */
export function saveToDisk(): boolean {
  if (!collectFn) return false;

  try {
    const snapshot = collectFn();
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
    return true;
  } catch (error) {
    console.error("[persistence] Failed to save snapshot:", error);
    return false;
  }
}

/** Restore state from last saved snapshot file (if it exists). Returns true if restored. */
export function restoreFromDisk(): boolean {
  if (!restoreFn) return false;

  if (!existsSync(SNAPSHOT_PATH)) {
    console.log("[persistence] No snapshot file found — starting fresh.");
    return false;
  }

  try {
    const raw = readFileSync(SNAPSHOT_PATH, "utf-8");
    const snapshot: PersistedSnapshot = JSON.parse(raw);
    restoreFn(snapshot);
    console.log(`[persistence] Restored contest state from ${snapshot.savedAt}`);
    return true;
  } catch (error) {
    console.error("[persistence] Failed to restore snapshot (starting fresh):", error);
    return false;
  }
}

/** Start the periodic auto-save timer. */
export function startAutoSave() {
  if (autoSaveTimer) return;

  autoSaveTimer = setInterval(() => {
    saveToDisk();
  }, AUTO_SAVE_INTERVAL_MS);

  // Also save immediately on process signals
  const gracefulShutdown = () => {
    saveToDisk();
    process.exit(0);
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);

  console.log(`[persistence] Auto-save enabled every ${AUTO_SAVE_INTERVAL_MS / 1000}s → ${SNAPSHOT_PATH}`);
}

/** Stop the auto-save timer. */
export function stopAutoSave() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = null;
  }
}
