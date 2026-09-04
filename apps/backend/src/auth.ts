import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthUser, LoginRequest, LoginResponse, Role } from "@blitzkrieg/shared";

interface SeedUser {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  participantCode: string | null;
  stationCode: string | null;
}

export interface Session {
  token: string;
  user: AuthUser;
  expiresAt: Date;
}

export interface ParticipantSummary {
  id: string;
  username: string;
  participantCode: string;
  stationCode: string;
  hasActiveSession: boolean;
}

const sessionDurationMs = 2 * 60 * 60 * 1000;

const users: SeedUser[] = [
  createSeedUser({
    id: "host-1",
    username: "host",
    password: "host123",
    role: "HOST",
    participantCode: null,
    stationCode: null
  }),
  ...Array.from({ length: 50 }, (_, index) => {
    const number = index + 1;

    return createSeedUser({
      id: `participant-${number}`,
      username: `bzk${String(number).padStart(3, "0")}`,
      password: "typing123",
      role: "PARTICIPANT",
      participantCode: `BZK${String(number).padStart(3, "0")}`,
      stationCode: `PC-${String(number).padStart(2, "0")}`
    });
  })
];

const sessions = new Map<string, Session>();
const participantSessionTokens = new Map<string, string>();

export function login(request: LoginRequest): LoginResponse {
  pruneExpiredSessions();

  const username = request.username?.trim() ?? "";
  const user = users.find((candidate) => candidate.username.toLowerCase() === username.toLowerCase());

  if (!user || !verifyPassword(request.password ?? "", user.passwordHash)) {
    throw new AuthError("Invalid username or password", 401);
  }

  if (user.role === "PARTICIPANT") {
    const submittedStation = request.stationCode?.trim().toUpperCase();

    if (!submittedStation) {
      throw new AuthError("Station code is required for participant login", 400);
    }

    if (submittedStation !== user.stationCode) {
      throw new AuthError("Participant is not assigned to this station", 403);
    }

    const activeToken = participantSessionTokens.get(user.id);
    if (activeToken && sessions.has(activeToken)) {
      throw new AuthError("Participant already has an active session", 409);
    }
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + sessionDurationMs);
  const authUser: AuthUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    participantCode: user.participantCode,
    stationCode: user.stationCode
  };

  sessions.set(token, {
    token,
    user: authUser,
    expiresAt
  });

  if (user.role === "PARTICIPANT") {
    participantSessionTokens.set(user.id, token);
  }

  return {
    token,
    user: authUser,
    expiresAt: expiresAt.toISOString()
  };
}

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

  if (session?.user.role === "PARTICIPANT") {
    participantSessionTokens.delete(session.user.id);
  }
}

export function listParticipants(): ParticipantSummary[] {
  pruneExpiredSessions();

  return users
    .filter((user): user is SeedUser & { participantCode: string; stationCode: string } => user.role === "PARTICIPANT")
    .map((user) => ({
      id: user.id,
      username: user.username,
      participantCode: user.participantCode,
      stationCode: user.stationCode,
      hasActiveSession: Boolean(participantSessionTokens.get(user.id))
    }));
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

function createSeedUser(user: Omit<SeedUser, "passwordHash"> & { password: string }): SeedUser {
  return {
    id: user.id,
    username: user.username,
    passwordHash: hashPassword(user.password),
    role: user.role,
    participantCode: user.participantCode,
    stationCode: user.stationCode
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

      if (session.user.role === "PARTICIPANT") {
        participantSessionTokens.delete(session.user.id);
      }
    }
  }
}
