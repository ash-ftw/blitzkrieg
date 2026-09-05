import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { Server } from "socket.io";
import type { AttemptSubmissionRequest, LoginRequest, Role, ViolationType } from "@blitzkrieg/shared";
import { getAuditLogs, getLogsRaw, restoreLogs } from "./auditLog.js";
import { AuthError, clearAllSessions, getSession, listParticipants, login, logout, type Session } from "./auth.js";
import { buildSnapshot } from "./contestSnapshot.js";
import {
  calculateQualifiers,
  disqualifyStation,
  exportCsvResults,
  finalizeContest,
  getAttemptsRaw,
  getContestStateRaw,
  getIncidentsRaw,
  markReady,
  onStateChange,
  onTimerTick,
  recordViolation,
  resetContestState,
  restartRound,
  restoreContestEngine,
  resetSingleStation,
  setCompetitionName,
  startRound,
  submitAttempt,
  toggleLock,
  transferParticipant
} from "./contestEngine.js";
import {
  clearAllStations,
  getNextStationNumber,
  getStationsRaw,
  listStations,
  recordHeartbeat,
  restoreStationsFromSnapshot,
  StationError,
  type StationHeartbeatRequest
} from "./stations.js";
import {
  addParticipants,
  closeRoom,
  createRoom,
  destroyRoom,
  getRoomRaw,
  getRoomSnapshot,
  openRoom,
  removeParticipant,
  restoreRoom,
  RoomError
} from "./room.js";
import { registerPersistenceCallbacks, restoreFromDisk, startAutoSave, type PersistedSnapshot } from "./persistence.js";

const port = Number(process.env.PORT ?? 4000);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const corsOrigin = process.env.NODE_ENV === "production" ? clientOrigin.split(",") : true;

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: corsOrigin,
  credentials: true
});

const io = new Server(app.server, {
  cors: {
    origin: corsOrigin,
    credentials: true
  }
});

// ─── Persistence: register collect/restore callbacks ────────────────
registerPersistenceCallbacks(
  // Collect: snapshot all in-memory state into a serializable object
  (): PersistedSnapshot => {
    const contestState = getContestStateRaw();
    const stationsRaw = getStationsRaw();
    const attemptsRaw = getAttemptsRaw();
    const incidentsRaw = getIncidentsRaw();
    const logsRaw = getLogsRaw();

    return {
      savedAt: new Date().toISOString(),
      contest: {
        name: contestState.name,
        status: contestState.status,
        round: contestState.round,
        durationSeconds: contestState.durationSeconds,
        remainingSeconds: contestState.remainingSeconds,
        isLocked: contestState.isLocked,
        qualifierCount: contestState.qualifierCount,
        qualifiers: [...contestState.qualifiers],
        activePassage: contestState.activePassage,
        roundStartedAt: contestState.roundStartedAt
      },
      stations: Array.from(stationsRaw.values()).map((s) => ({
        stationCode: s.stationCode,
        hostname: s.hostname,
        status: s.status,
        email: s.email,
        activeSession: s.activeSession,
        lastHeartbeatAt: s.lastHeartbeatAt?.toISOString() ?? null,
        wpm: s.wpm,
        accuracy: s.accuracy,
        score: s.score
      })),
      nextStationNumber: getNextStationNumber(),
      attempts: Array.from(attemptsRaw.entries()),
      incidents: [...incidentsRaw],
      auditLogs: [...logsRaw],
      room: getRoomRaw()
    };
  },
  // Restore: replay persisted snapshot into all modules
  (snapshot: PersistedSnapshot) => {
    restoreStationsFromSnapshot(snapshot.stations, snapshot.nextStationNumber);
    restoreLogs(snapshot.auditLogs);
    if (snapshot.room) {
      restoreRoom(snapshot.room);
    }
    restoreContestEngine({
      ...snapshot.contest,
      attempts: snapshot.attempts,
      incidents: snapshot.incidents
    });
  }
);

// Restore from last saved snapshot (if any) before the server starts
restoreFromDisk();

// Broadcast full snapshot whenever state materially changes
onStateChange(() => {
  io.emit("contest:state", buildSnapshot());
});

// Lightweight tick: only send timer + status every second during active rounds
onTimerTick((remainingSeconds, status) => {
  io.emit("contest:tick", { remainingSeconds, status });
});

// Start periodic auto-save to disk
startAutoSave();

// ─── Health ─────────────────────────────────────────────────────────

app.get("/health", async () => ({
  ok: true,
  service: "blitzkrieg-backend"
}));

// ─── Auth routes ────────────────────────────────────────────────────

app.post<{ Body: LoginRequest }>("/auth/login", async (request, reply) => {
  try {
    const result = login(request.body);

    // Notify all clients that a new participant joined (for the waiting room)
    io.emit("contest:state", buildSnapshot());

    return result;
  } catch (error) {
    return sendKnownError(error, reply);
  }
});

app.get("/auth/me", async (request, reply) => {
  const session = authenticate(request, reply);

  if (!session) {
    return reply;
  }

  return {
    user: session.user,
    expiresAt: session.expiresAt.toISOString()
  };
});

app.post("/auth/logout", async (request) => {
  logout(readBearerToken(request.headers.authorization));

  return {
    ok: true
  };
});

// ─── Room routes ────────────────────────────────────────────────────

app.post<{ Body: { competitionName: string; emails: string[] } }>("/room/create", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);
  if (!session) return reply;

  try {
    const room = createRoom(request.body.competitionName, request.body.emails);
    setCompetitionName(request.body.competitionName);
    markReady(session.user.username);
    io.emit("contest:state", buildSnapshot());

    return { room };
  } catch (error) {
    return sendKnownError(error, reply);
  }
});

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

app.get("/history/qualifiers", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);
  if (!session) return reply;

  try {
    const files = readdirSync(process.cwd()).filter(f => f.startsWith("qualifiers-history-") && f.endsWith(".json"));
    const histories = files.map(f => {
      const data = JSON.parse(readFileSync(resolve(process.cwd(), f), "utf-8"));
      return { filename: f, timestamp: data.timestamp, competitionName: data.competitionName, count: data.qualifiers.length };
    }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return { histories };
  } catch (error) {
    return { histories: [] };
  }
});

app.post<{ Body: { filename: string } }>("/room/create-from-history", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);
  if (!session) return reply;

  try {
    const filepath = resolve(process.cwd(), request.body.filename);
    const data = JSON.parse(readFileSync(filepath, "utf-8"));
    const emails = data.qualifiers.map((q: any) => q.email);

    // Completely reset the contest and all stations before creating the new room
    resetContestState();
    clearAllStations();
    
    // Create new room with these emails for Round 2
    const room = createRoom(data.competitionName + " - Round 2", emails);
    setCompetitionName(data.competitionName + " - Round 2");
    
    // We start directly in QUALIFICATION status so we can jump to Round 2
    // But since it's a new room, we can just start it at READY and have the host jump to Round 2
    markReady(session.user.username);
    
    io.emit("contest:state", buildSnapshot());
    return { room };
  } catch (error) {
    return sendKnownError(error, reply);
  }
});

app.post<{ Body: { emails: string[] } }>("/room/add-participants", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);
  if (!session) return reply;

  try {
    addParticipants(request.body.emails);
    io.emit("contest:state", buildSnapshot());
    return { ok: true, room: getRoomSnapshot() };
  } catch (error) {
    return sendKnownError(error, reply);
  }
});

app.delete<{ Params: { email: string } }>("/room/participant/:email", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);
  if (!session) return reply;

  try {
    removeParticipant(decodeURIComponent(request.params.email));
    io.emit("contest:state", buildSnapshot());
    return { ok: true };
  } catch (error) {
    return sendKnownError(error, reply);
  }
});

app.get("/room", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);
  if (!session) return reply;

  return { room: getRoomSnapshot() };
});

app.post("/room/close", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);
  if (!session) return reply;

  closeRoom();
  io.emit("contest:state", buildSnapshot());
  return { ok: true };
});

app.post("/room/open", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);
  if (!session) return reply;

  openRoom();
  io.emit("contest:state", buildSnapshot());
  return { ok: true };
});

// ─── Participant routes ─────────────────────────────────────────────

app.get("/participants", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  return {
    participants: listParticipants()
  };
});

app.get("/stations", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  return {
    stations: listStations()
  };
});

app.post<{ Body: StationHeartbeatRequest; Params: { stationCode: string } }>("/stations/:stationCode/heartbeat", async (request, reply) => {
  const session = authorize(request, reply, ["HOST", "PARTICIPANT"]);

  if (!session) {
    return reply;
  }

  try {
    const station = recordHeartbeat(request.params.stationCode, {
      email: session.user.email ?? request.body.email,
      sessionToken: readBearerToken(request.headers.authorization)
    });
    io.emit("contest:state", buildSnapshot());

    return { station };
  } catch (error) {
    return sendKnownError(error, reply);
  }
});

// ─── Contest routes ─────────────────────────────────────────────────

app.get("/contest/current", async (request, reply) => {
  const session = authorize(request, reply, ["HOST", "PARTICIPANT"]);

  if (!session) {
    return reply;
  }

  return buildSnapshot();
});

app.post<{ Body: { round: 1 | 2 } }>("/contest/start-round", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  const round = request.body?.round ?? 1;
  startRound(round, session.user.username);
  return { ok: true, round };
});

app.post<{ Body: { round: 1 | 2 } }>("/contest/restart-round", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  const round = request.body?.round ?? 1;
  restartRound(round, session.user.username);
  return { ok: true, round };
});

app.post<{ Body: { stationCode: string } }>("/contest/reset-station", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  try {
    resetSingleStation(request.body.stationCode, session.user.username);
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to reset station";
    return reply.code(400).send({ message });
  }
});


app.post("/contest/lock", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  const isLocked = toggleLock(session.user.username);
  return { ok: true, isLocked };
});

app.post<{ Body: { count?: number } }>("/contest/calculate-qualifiers", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  const count = request.body?.count ?? 20;
  const qualifiers = calculateQualifiers(count, session.user.username);
  return { ok: true, qualifiers };
});

app.post("/contest/finalize", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  finalizeContest(session.user.username);
  return { ok: true };
});

app.post<{ Body: { fromStationCode: string; toStationCode: string } }>("/contest/transfer", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  try {
    transferParticipant(request.body.fromStationCode, request.body.toStationCode, session.user.username);
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to transfer participant";
    return reply.code(400).send({ message });
  }
});

app.get("/contest/export-csv", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  const csv = exportCsvResults();
  reply.header("Content-Type", "text/csv");
  reply.header("Content-Disposition", 'attachment; filename="blitzkrieg-results.csv"');
  return csv;
});

app.get("/audit-logs", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  return { logs: getAuditLogs() };
});

app.post("/contest/simulate-rehearsal", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  const { runFullMockCompetition } = await import("./mockSimulation.js");
  const report = runFullMockCompetition();
  io.emit("contest:state", buildSnapshot());
  return { report };
});

app.post("/contest/reset", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  resetContestState(session.user.username);
  clearAllSessions();
  destroyRoom();
  io.emit("contest:state", buildSnapshot());
  return { ok: true };
});



app.post<{ Body: AttemptSubmissionRequest }>("/contest/submit", async (request, reply) => {
  const session = authorize(request, reply, ["PARTICIPANT"]);

  if (!session) {
    return reply;
  }

  if (!session.user.email || !session.user.stationCode) {
    return reply.code(400).send({ message: "Participant must be assigned to a station." });
  }

  try {
    const result = submitAttempt(
      session.user.email,
      session.user.stationCode,
      request.body.typedText ?? "",
      request.body.durationMs ?? 60000
    );

    return { result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to submit attempt";
    return reply.code(400).send({ message });
  }
});

app.post<{ Body: { type: ViolationType; details?: string } }>("/contest/violation", async (request, reply) => {
  const session = authorize(request, reply, ["PARTICIPANT", "HOST"]);

  if (!session) {
    return reply;
  }

  const email = session.user.email ?? "HOST";
  const stationCode = session.user.stationCode ?? "HOST-CONSOLE";

  const incident = recordViolation(
    email,
    stationCode,
    request.body.type,
    request.body.details ?? "Anti-cheat flag triggered"
  );

  return { incident };
});

app.post<{ Body: { stationCode: string; reason?: string } }>("/contest/disqualify", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  disqualifyStation(request.body.stationCode, request.body.reason ?? "Disqualified by Host", session.user.username);
  return { ok: true };
});

io.use((socket, next) => {
  const token = typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : undefined;
  const session = getSession(token);

  if (!session) {
    next(new Error("Authentication required"));
    return;
  }

  socket.data.session = session;
  next();
});

io.on("connection", (socket) => {
  socket.emit("contest:state", buildSnapshot());
});

function authenticate(request: FastifyRequest, reply: FastifyReply): Session | null {
  const session = getSession(readBearerToken(request.headers.authorization));

  if (!session) {
    reply.code(401).send({ message: "Authentication required" });
    return null;
  }

  return session;
}

function authorize(request: FastifyRequest, reply: FastifyReply, allowedRoles: Role[]): Session | null {
  const session = authenticate(request, reply);

  if (!session) {
    return null;
  }

  if (!allowedRoles.includes(session.user.role)) {
    reply.code(403).send({ message: "Insufficient permissions" });
    return null;
  }

  return session;
}

function sendKnownError(error: unknown, reply: FastifyReply) {
  if (error instanceof AuthError || error instanceof StationError || error instanceof RoomError) {
    return reply.code(error.statusCode).send({ message: error.message });
  }

  throw error;
}

function readBearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }

  return authorization.slice("Bearer ".length);
}

await app.listen({ port, host: "0.0.0.0" });
