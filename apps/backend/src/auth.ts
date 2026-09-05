/**
 * auth.ts
 *
 * Authentication for the dynamic room-based system.
 * - Host: logs in with username + password (hardcoded admin)
 * - Participant: logs in with email + room PIN (dynamic)
 */

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

interface HostUser {
  id: string;
  username: string;
  passwordHash: string;
}

const hostUser: HostUser = createHostUser("host-1", "host", "host123");

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

// ─── Login ──────────────────────────────────────────────────────────

export function login(request: LoginRequest): LoginResponse {
  pruneExpiredSessions();

  // ─ Host login (username + password) ─
  if (request.username) {
    return loginAsHost(request.username, request.password ?? "");
  }

  // ─ Participant login (email + roomPin) ─
  if (request.email) {
    return loginAsParticipant(request.email, request.roomPin ?? "");
  }

  throw new AuthError("Provide username (host) or email (participant) to log in", 400);
}

function loginAsHost(username: string, password: string): LoginResponse {
  if (username.trim().toLowerCase() !== hostUser.username.toLowerCase()) {
    throw new AuthError("Invalid username or password", 401);
  }

  if (!verifyPassword(password, hostUser.passwordHash)) {
    throw new AuthError("Invalid username or password", 401);
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + sessionDurationMs);
  const authUser: AuthUser = {
    id: hostUser.id,
    username: hostUser.username,
    role: "HOST",
    email: null,
    stationCode: null
  };

  sessions.set(token, { token, user: authUser, expiresAt });

  return { token, user: authUser, expiresAt: expiresAt.toISOString() };
}

function loginAsParticipant(email: string, roomPin: string): LoginResponse {
  const normalised = email.trim().toLowerCase();

  // Validate room exists
  const room = getRoom();
  if (!room) {
    throw new AuthError("No active competition room. Please wait for the host to create one.", 400);
  }

  // Validate room is open
  if (!room.isOpen) {
    throw new AuthError("The competition room is closed. No more participants can join.", 403);
  }

  // Validate PIN
  if (!validateRoomPin(roomPin)) {
    throw new AuthError("Invalid room PIN", 401);
  }

  // Validate email is whitelisted
  if (!isEmailWhitelisted(normalised)) {
    throw new AuthError("Your email is not registered for this competition. Contact the host.", 403);
  }

  // Check for duplicate session
  const existingToken = participantSessionTokens.get(normalised);
  if (existingToken && sessions.has(existingToken)) {
    throw new AuthError("This email already has an active session. Contact the host if this is an error.", 409);
  }

  // Check if already joined (has a station assigned)
  if (hasAlreadyJoined(normalised)) {
    // They had a session before but it expired — let them rejoin their existing station
    const existingStation = findStationByEmail(normalised);
    if (existingStation) {
      return createParticipantSession(normalised, existingStation.stationCode);
    }
  }

  // Assign a new station dynamically
  const station = assignNextStation(normalised);
  recordParticipantJoin(normalised, station.stationCode);

  return createParticipantSession(normalised, station.stationCode);
}

function createParticipantSession(email: string, stationCode: string): LoginResponse {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + sessionDurationMs);
  const authUser: AuthUser = {
    id: `participant-${email}`,
    username: email,
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

  return sessions.get(token) ?? null;
}

export function logout(token: string | undefined) {
  if (!token) {
    return;
  }

  const session = sessions.get(token);
  sessions.delete(token);

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

/** Clear all sessions (used on contest reset). */
export function clearAllSessions() {
  sessions.clear();
  participantSessionTokens.clear();
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

function createHostUser(id: string, username: string, password: string): HostUser {
  return {
    id,
    username,
    passwordHash: hashPassword(password)
  };
}

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
