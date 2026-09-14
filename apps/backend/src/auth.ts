/**
 * auth.ts
 *
 * Authentication for the dynamic room-based system.
 * - Host: logs in with username + password (hardcoded admin)
 * - Participant: logs in with email + room PIN (dynamic)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthUser, LoginRequest, LoginResponse, Role } from "@blitzkrieg/shared";
import {
  getRoom,
  hasAlreadyJoined,
  isEmailWhitelisted,
  recordParticipantJoin,
  validateRoomPin
} from "./room.js";
import { assignNextStation, findStationByEmail } from "./stations.js";

// ─── Host credentials ───────────────────────────────────────────────

export const ALLOWED_HOST_EMAILS = new Set([
  "max@host.com",
  "lec@host.com",
  "kimi@host.com"
]);

const HOST_PASSWORD_HASH = hashPassword("host123");

// ─── Sessions ───────────────────────────────────────────────────────

export interface Session {
  token: string;
  user: AuthUser;
  expiresAt: Date;
}

export interface ParticipantSummary {
  email: string;
  stationCode: string;
  hasActiveSession: boolean;
}

const sessionDurationMs = 2 * 60 * 60 * 1000; // 2 hours

const sessions = new Map<string, Session>();
/** Map of email → session token (to prevent duplicate logins). */
const participantSessionTokens = new Map<string, string>();

const HOST_SESSIONS_FILE = resolve(process.cwd(), "host-sessions.json");

function loadPersistedHostSessions() {
  try {
    if (existsSync(HOST_SESSIONS_FILE)) {
      const raw = readFileSync(HOST_SESSIONS_FILE, "utf-8");
      const list: Array<{ token: string; user: AuthUser; expiresAt: string }> = JSON.parse(raw);
      const now = Date.now();
      for (const item of list) {
        const expiresAt = new Date(item.expiresAt);
        if (expiresAt.getTime() > now) {
          sessions.set(item.token, {
            token: item.token,
            user: item.user,
            expiresAt
          });
        }
      }
    }
  } catch (err) {
    console.error("[auth] Failed to load persisted host sessions:", err);
  }
}

function persistHostSessions() {
  try {
    const hostList: Array<{ token: string; user: AuthUser; expiresAt: string }> = [];
    const now = Date.now();
    for (const s of sessions.values()) {
      if (s.user.role === "HOST" && s.expiresAt.getTime() > now) {
        hostList.push({
          token: s.token,
          user: s.user,
          expiresAt: s.expiresAt.toISOString()
        });
      }
    }
    writeFileSync(HOST_SESSIONS_FILE, JSON.stringify(hostList, null, 2), "utf-8");
  } catch (err) {
    console.error("[auth] Failed to persist host sessions:", err);
  }
}

// Load host sessions on startup
loadPersistedHostSessions();

// ─── Login ──────────────────────────────────────────────────────────

export function login(request: LoginRequest): LoginResponse {
  pruneExpiredSessions();

  // ─ Host login (username/email + password) ─
  if (request.password !== undefined || request.username) {
    const identifier = request.username ?? request.email ?? "";
    return loginAsHost(identifier, request.password ?? "");
  }

  // ─ Participant login (email + name) ─
  if (request.email) {
    return loginAsParticipant(request.email, request.name);
  }

  throw new AuthError("Provide host credentials or participant email to log in", 400);
}

function loginAsHost(identifier: string, password: string): LoginResponse {
  const normalised = identifier.trim().toLowerCase();

  if (!ALLOWED_HOST_EMAILS.has(normalised)) {
    throw new AuthError("Access denied: Only max@host.com, lec@host.com, and kimi@host.com have host access.", 403);
  }

  if (!verifyPassword(password, HOST_PASSWORD_HASH)) {
    throw new AuthError("Invalid host password", 401);
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + sessionDurationMs);
  const hostNames: Record<string, string> = {
    "max@host.com": "Max Verstappen",
    "lec@host.com": "Charles Leclerc",
    "kimi@host.com": "Kimi Antonelli"
  };

  const authUser: AuthUser = {
    id: `host-${normalised}`,
    username: normalised,
    name: hostNames[normalised] ?? normalised,
    role: "HOST",
    email: normalised,
    stationCode: null
  };

  sessions.set(token, { token, user: authUser, expiresAt });
  persistHostSessions();

  return { token, user: authUser, expiresAt: expiresAt.toISOString() };
}

function loginAsParticipant(email: string, name?: string): LoginResponse {
  const normalised = email.trim().toLowerCase();

  if (ALLOWED_HOST_EMAILS.has(normalised)) {
    throw new AuthError("Host accounts cannot log in as contest participants. Switch to Host Login.", 403);
  }

  // Validate email is ingested / whitelisted
  if (!isEmailWhitelisted(normalised)) {
    throw new AuthError("Your email is not registered for this competition. Please contact the host.", 403);
  }

  // Check for duplicate session
  const existingToken = participantSessionTokens.get(normalised);
  if (existingToken && sessions.has(existingToken)) {
    throw new AuthError("This email already has an active session. Contact the host if this is an error.", 409);
  }

  const participantName = name?.trim() || null;

  // Check if already joined (has a station assigned)
  if (hasAlreadyJoined(normalised)) {
    const existingStation = findStationByEmail(normalised);
    if (existingStation) {
      if (participantName && !existingStation.name) {
        existingStation.name = participantName;
      }
      recordParticipantJoin(normalised, existingStation.stationCode, participantName ?? existingStation.name);
      return createParticipantSession(normalised, existingStation.stationCode, existingStation.name ?? participantName);
    }
  }

  // Assign a new station dynamically (PC-01, PC-02, etc.)
  const station = assignNextStation(normalised, participantName);
  recordParticipantJoin(normalised, station.stationCode, participantName);

  return createParticipantSession(normalised, station.stationCode, participantName);
}

function createParticipantSession(email: string, stationCode: string, name?: string | null): LoginResponse {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + sessionDurationMs);
  const authUser: AuthUser = {
    id: `participant-${email}`,
    username: name || email,
    name: name || null,
    role: "PARTICIPANT",
    email,
    stationCode
  };

  sessions.set(token, { token, user: authUser, expiresAt });
  participantSessionTokens.set(email, token);

  return { token, user: authUser, expiresAt: expiresAt.toISOString() };
}

// ─── Session management ─────────────────────────────────────────────

export function getSession(token: string | undefined): Session | null {
  pruneExpiredSessions();

  if (!token) {
    return null;
  }

  let session = sessions.get(token) ?? null;
  if (!session) {
    // Attempt re-loading host sessions from disk in case of reload
    loadPersistedHostSessions();
    session = sessions.get(token) ?? null;
  }

  return session;
}

export function logout(token: string | undefined) {
  if (!token) {
    return;
  }

  const session = sessions.get(token);
  sessions.delete(token);

  if (session?.user.role === "HOST") {
    persistHostSessions();
  }

  if (session?.user.role === "PARTICIPANT" && session.user.email) {
    participantSessionTokens.delete(session.user.email);
  }
}

/** Force-logout a participant by email (used by host). */
export function forceLogoutByEmail(email: string) {
  const normalised = email.trim().toLowerCase();
  const token = participantSessionTokens.get(normalised);
  if (token) {
    sessions.delete(token);
    participantSessionTokens.delete(normalised);
  }
}

export function listParticipants(): ParticipantSummary[] {
  pruneExpiredSessions();

  const room = getRoom();
  if (!room) return [];

  return room.joinedParticipants.map((jp) => ({
    email: jp.email,
    stationCode: jp.stationCode,
    hasActiveSession: Boolean(participantSessionTokens.get(jp.email) && sessions.has(participantSessionTokens.get(jp.email)!))
  }));
}

/** Clear all participant sessions (used on contest reset). Preserves host sessions. */
export function clearAllSessions() {
  for (const [token, session] of Array.from(sessions.entries())) {
    if (session.user.role !== "HOST") {
      sessions.delete(token);
    }
  }
  participantSessionTokens.clear();
  persistHostSessions();
}

// ─── Error class ────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

// ─── Internal helpers ───────────────────────────────────────────────

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");

  return `${salt}:${hash}`;
}

function verifyPassword(password: string, passwordHash: string) {
  const [salt, hash] = passwordHash.split(":");

  if (!salt || !hash) {
    return false;
  }

  const submitted = Buffer.from(scryptSync(password, salt, 64).toString("hex"));
  const expected = Buffer.from(hash);

  return submitted.length === expected.length && timingSafeEqual(submitted, expected);
}

function pruneExpiredSessions() {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt.getTime() <= now) {
      sessions.delete(token);

      if (session.user.role === "PARTICIPANT" && session.user.email) {
        participantSessionTokens.delete(session.user.email);
      }
    }
  }
}
