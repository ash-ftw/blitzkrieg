/**
 * room.ts
 *
 * Manages the competition room lifecycle: creation, participant whitelist,
 * PIN generation, and join tracking.
 */

import { randomInt } from "node:crypto";
import type { JoinedParticipant, RoomSnapshot } from "@blitzkrieg/shared";

interface RoomState {
  roomPin: string;
  competitionName: string;
  /** Normalised (lowercase, trimmed) emails that are allowed to join. */
  whitelistedEmails: Set<string>;
  /** Participants who have actually logged in, in order. */
  joinedParticipants: JoinedParticipant[];
  /** Whether the room is still accepting joins. */
  isOpen: boolean;
}

let room: RoomState | null = null;

// ─── Public API ─────────────────────────────────────────────────────

/** Create a new competition room. Returns the generated PIN. */
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

/** Get the current room state, or null if no room exists. */
export function getRoom(): RoomState | null {
  return room;
}

/** Get the room snapshot for broadcasting. */
export function getRoomSnapshot(): RoomSnapshot | null {
  if (!room) return null;

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
  if (!room) throw new RoomError("No active room", 400);

  const normalised = emails.map(normaliseEmail).filter(Boolean);
  for (const email of normalised) {
    room.whitelistedEmails.add(email);
  }
}

/** Remove an email from the whitelist (only before they join). */
export function removeParticipant(email: string) {
  if (!room) throw new RoomError("No active room", 400);

  const normalised = normaliseEmail(email);
  const alreadyJoined = room.joinedParticipants.some((p) => p.email === normalised);
  if (alreadyJoined) {
    throw new RoomError("Cannot remove a participant who has already joined", 409);
  }

  room.whitelistedEmails.delete(normalised);
}

/** Check if an email is in the whitelist. */
export function isEmailWhitelisted(email: string): boolean {
  if (!room) return false;
  return room.whitelistedEmails.has(normaliseEmail(email));
}

/** Check if the PIN matches. */
export function validateRoomPin(pin: string): boolean {
  if (!room) return false;
  return room.roomPin === pin.trim();
}

/** Check if an email has already joined. */
export function hasAlreadyJoined(email: string): boolean {
  if (!room) return false;
  return room.joinedParticipants.some((p) => p.email === normaliseEmail(email));
}

/** Record that a participant has joined (called after successful login). */
export function recordParticipantJoin(email: string, stationCode: string) {
  if (!room) return;

  room.joinedParticipants.push({
    email: normaliseEmail(email),
    stationCode,
    joinedAt: new Date().toISOString()
  });
}

/** Close the room (no more joins accepted). */
export function closeRoom() {
  if (room) room.isOpen = false;
}

/** Open the room (allow joins again). */
export function openRoom() {
  if (room) room.isOpen = true;
}

/** Fully reset the room. */
export function destroyRoom() {
  room = null;
}

// ─── Persistence helpers ────────────────────────────────────────────

export interface PersistedRoomState {
  roomPin: string;
  competitionName: string;
  whitelistedEmails: string[];
  joinedParticipants: JoinedParticipant[];
  isOpen: boolean;
}

export function getRoomRaw(): PersistedRoomState | null {
  if (!room) return null;
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
    roomPin: persisted.roomPin,
    competitionName: persisted.competitionName,
    whitelistedEmails: new Set(persisted.whitelistedEmails),
    joinedParticipants: [...persisted.joinedParticipants],
    isOpen: persisted.isOpen
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
