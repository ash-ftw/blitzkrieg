import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { Server } from "socket.io";
import type { AttemptSubmissionRequest, LoginRequest, Role, ViolationType } from "@blitzkrieg/shared";
import { getAuditLogs } from "./auditLog.js";
import { AuthError, getSession, listParticipants, login, logout, type Session } from "./auth.js";
import { buildSnapshot } from "./contestSnapshot.js";
import {
  calculateQualifiers,
  disqualifyStation,
  exportCsvResults,
  finalizeContest,
  onStateChange,
  recordViolation,
  restartRound,
  resetSingleStation,
  startRound,
  submitAttempt,
  toggleLock,
  transferParticipant
} from "./contestEngine.js";
import { assignStation, listStations, recordHeartbeat, StationError, type StationAssignmentRequest, type StationHeartbeatRequest } from "./stations.js";

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

// Broadcast whenever state updates in contestEngine
onStateChange(() => {
  io.emit("contest:state", buildSnapshot());
});

app.get("/health", async () => ({
  ok: true,
  service: "blitzkrieg-backend"
}));

app.post<{ Body: LoginRequest }>("/auth/login", async (request, reply) => {
  try {
    return login(request.body);
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

app.post<{ Body: StationAssignmentRequest; Params: { stationCode: string } }>("/stations/:stationCode/assign", async (request, reply) => {
  const session = authorize(request, reply, ["HOST"]);

  if (!session) {
    return reply;
  }

  try {
    const station = assignStation(request.params.stationCode, request.body.participantCode);
    io.emit("contest:state", buildSnapshot());

    return { station };
  } catch (error) {
    return sendKnownError(error, reply);
  }
});

app.post<{ Body: StationHeartbeatRequest; Params: { stationCode: string } }>("/stations/:stationCode/heartbeat", async (request, reply) => {
  const session = authorize(request, reply, ["HOST", "PARTICIPANT"]);

  if (!session) {
    return reply;
  }

  try {
    const station = recordHeartbeat(request.params.stationCode, {
      participantCode: session.user.participantCode ?? request.body.participantCode,
      sessionToken: readBearerToken(request.headers.authorization)
    });
    io.emit("contest:state", buildSnapshot());

    return { station };
  } catch (error) {
    return sendKnownError(error, reply);
  }
});

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

  const { resetContestState } = await import("./contestEngine.js");
  resetContestState(session.user.username);
  io.emit("contest:state", buildSnapshot());
  return { ok: true };
});



app.post<{ Body: AttemptSubmissionRequest }>("/contest/submit", async (request, reply) => {
  const session = authorize(request, reply, ["PARTICIPANT"]);

  if (!session) {
    return reply;
  }

  if (!session.user.participantCode || !session.user.stationCode) {
    return reply.code(400).send({ message: "Participant must be assigned to a station." });
  }

  try {
    const result = submitAttempt(
      session.user.participantCode,
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

  const participantCode = session.user.participantCode ?? "HOST";
  const stationCode = session.user.stationCode ?? "HOST-CONSOL";

  const incident = recordViolation(
    participantCode,
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
  if (error instanceof AuthError || error instanceof StationError) {
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
