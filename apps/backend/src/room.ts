/**
 * room.ts
 *
 * Manages the participant whitelist, email ingestion,
 * and dynamic workstation allotments.
 */

import { randomInt } from "node:crypto";
import type { IngestedParticipant, JoinedParticipant, RoomSnapshot } from "@blitzkrieg/shared";

interface RoomState {
  roomPin: string;
  competitionName: string;
  /** Normalised (lowercase, trimmed) emails that are allowed to join. */
  whitelistedEmails: Set<string>;
  /** Participants who have actually logged in, in order. */
  joinedParticipants: JoinedParticipant[];
  /** Whether the contest is still accepting joins. */
  isOpen: boolean;
}

function createDefaultState(): RoomState {
  return {
    roomPin: "000000",
    competitionName: "Blitzkrieg Competition",
    whitelistedEmails: new Set<string>(),
    joinedParticipants: [],
    isOpen: true
  };
}

let room: RoomState = createDefaultState();

// ─── Public API ─────────────────────────────────────────────────────

/** Ingest participant emails into the competition whitelist. */
export function ingestEmails(emails: string[]): { added: number; total: number } {
  let added = 0;
  for (const raw of emails) {
    const normalised = normaliseEmail(raw);
    if (normalised && normalised.includes("@") && !room.whitelistedEmails.has(normalised)) {
      room.whitelistedEmails.add(normalised);
      added++;
    }
  }
  return { added, total: room.whitelistedEmails.size };
}

/** Get list of all ingested emails. */
export function getIngestedEmails(): string[] {
  return Array.from(room.whitelistedEmails);
}

/** Get detailed list of all ingested participants and their allotment/join status. */
export function getIngestedParticipants(): IngestedParticipant[] {
  const joinedMap = new Map<string, JoinedParticipant>();
  for (const jp of room.joinedParticipants) {
    joinedMap.set(jp.email, jp);
  }

  const result: IngestedParticipant[] = [];
  for (const email of room.whitelistedEmails) {
    const joined = joinedMap.get(email);
    result.push({
      email,
      name: joined?.name ?? null,
      stationCode: joined?.stationCode ?? null,
      joined: Boolean(joined),
      joinedAt: joined?.joinedAt ?? null
    });
  }

  return result;
}

/** Create or reset the competition room. */
export function createRoom(competitionName: string, emails: string[]): RoomSnapshot {
  const pin = String(randomInt(100000, 999999));
  const normalised = emails.map(normaliseEmail).filter(Boolean);

  room = {
    roomPin: pin,
    competitionName: competitionName.trim() || "Blitzkrieg Competition",
    whitelistedEmails: new Set(normalised),
    joinedParticipants: [],
    isOpen: true
  };

  return getRoomSnapshot()!;
}

/** Get the current room state. */
export function getRoom(): RoomState {
  return room;
}

/** Get the room snapshot for broadcasting. */
export function getRoomSnapshot(): RoomSnapshot {
  return {
    roomPin: room.roomPin,
    competitionName: room.competitionName,
    totalInvited: room.whitelistedEmails.size,
    joinedParticipants: [...room.joinedParticipants],
    isOpen: room.isOpen
  };
}

/** Add more emails to the whitelist. */
export function addParticipants(emails: string[]) {
  const normalised = emails.map(normaliseEmail).filter(Boolean);
  for (const email of normalised) {
    if (email.includes("@")) {
      room.whitelistedEmails.add(email);
    }
  }
}

/** Remove an email from the whitelist (only before they join). */
export function removeParticipant(email: string) {
  const normalised = normaliseEmail(email);
  const alreadyJoined = room.joinedParticipants.some((p) => p.email === normalised);
  if (alreadyJoined) {
    throw new RoomError("Cannot remove a participant who has already joined", 409);
  }

  room.whitelistedEmails.delete(normalised);
}

/** Check if an email is in the whitelist. */
export function isEmailWhitelisted(email: string): boolean {
  return room.whitelistedEmails.has(normaliseEmail(email));
}

/** Check if the PIN matches (always true if 000000 or matches). */
export function validateRoomPin(pin: string): boolean {
  if (room.roomPin === "000000") return true;
  return room.roomPin === pin.trim();
}

/** Check if an email has already joined. */
export function hasAlreadyJoined(email: string): boolean {
  return room.joinedParticipants.some((p) => p.email === normaliseEmail(email));
}

/** Record that a participant has joined (called after successful login). */
export function recordParticipantJoin(email: string, stationCode: string, name?: string | null) {
  const normalised = normaliseEmail(email);
  const existing = room.joinedParticipants.find((p) => p.email === normalised);
  if (existing) {
    if (name) existing.name = name.trim();
    existing.stationCode = stationCode;
    return;
  }

  room.joinedParticipants.push({
    email: normalised,
    name: name?.trim() || null,
    stationCode,
    joinedAt: new Date().toISOString()
  });
}

/** Close the contest (no more joins accepted). */
export function closeRoom() {
  room.isOpen = false;
}

/** Open the contest (allow joins again). */
export function openRoom() {
  room.isOpen = true;
}

/** Fully reset the room state. */
export function destroyRoom() {
  room = createDefaultState();
}

// ─── Persistence helpers ────────────────────────────────────────────

export interface PersistedRoomState {
  roomPin: string;
  competitionName: string;
  whitelistedEmails: string[];
  joinedParticipants: JoinedParticipant[];
  isOpen: boolean;
}

export function getRoomRaw(): PersistedRoomState {
  return {
    roomPin: room.roomPin,
    competitionName: room.competitionName,
    whitelistedEmails: Array.from(room.whitelistedEmails),
    joinedParticipants: [...room.joinedParticipants],
    isOpen: room.isOpen
  };
}

export function restoreRoom(persisted: PersistedRoomState) {
  room = {
    roomPin: persisted.roomPin ?? "000000",
    competitionName: persisted.competitionName ?? "Blitzkrieg Competition",
    whitelistedEmails: new Set(persisted.whitelistedEmails ?? []),
    joinedParticipants: [...(persisted.joinedParticipants ?? [])],
    isOpen: persisted.isOpen ?? true
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class RoomError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

