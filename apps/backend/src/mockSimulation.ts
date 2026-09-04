import { calculateQualifiers, finalizeContest, getContestSnapshot, recordViolation, startRound, submitAttempt } from "./contestEngine.js";
import { assignStation, getStation, listStations } from "./stations.js";

export interface SimulationReport {
  timestamp: string;
  durationMs: number;
  totalParticipants: number;
  readyStations: number;
  round1Submissions: number;
  round2Submissions: number;
  disqualifications: number;
  qualifiersSelected: number;
  topScorer: {
    participantCode: string;
    stationCode: string;
    score: number;
    wpm: number;
    accuracy: number;
  } | null;
  systemHealth: "OPTIMAL" | "DEGRADED" | "CRITICAL";
  goNoGoDecision: "GO - READY FOR LIVE EVENT" | "NO-GO - SYSTEM ISSUES DETECTED";
}

export function runFullMockCompetition(): SimulationReport {
  const startTime = Date.now();

  // Step 1: Assign & verify 50 stations
  listStations();
  for (let i = 0; i < 50; i++) {
    const stationCode = `PC-${String(i + 1).padStart(2, "0")}`;
    const participantCode = `BZK${String(i + 1).padStart(3, "0")}`;
    assignStation(stationCode, participantCode);
    const st = getStation(stationCode);
    if (st) {
      st.status = "READY";
    }
  }

  // Step 2: Host starts Round 1
  startRound(1, "HOST_SIMULATOR");

  // Step 3: Simulate 50 participant submissions with realistic WPM & Accuracy
  let round1Submissions = 0;
  for (let i = 0; i < 50; i++) {
    const stationCode = `PC-${String(i + 1).padStart(2, "0")}`;
    const participantCode = `BZK${String(i + 1).padStart(3, "0")}`;

    // Simulate 1 anti-cheat DQ scenario for testing (e.g. participant BZK007)
    if (i === 6) {
      recordViolation(participantCode, stationCode, "PASTE", "Automated mock test: paste attempt detected");
      continue;
    }

    const wpm = 45 + ((i * 7) % 65); // 45 to 110 WPM
    const accuracy = 92 + ((i * 3) % 8); // 92% to 99%
    const charCount = 270;
    const durationMs = Math.round(((charCount / 5) / wpm) * 60000);

    const typedText = generateTypedPassage("The Essence of Systems", charCount, accuracy);

    submitAttempt(participantCode, stationCode, typedText, durationMs);
    round1Submissions++;
  }

  // Step 4: Host selects Top 20 Qualifiers
  const qualifiers = calculateQualifiers(20, "HOST_SIMULATOR");

  // Step 5: Host starts Round 2 for qualifiers
  startRound(2, "HOST_SIMULATOR");

  // Step 6: Simulate Round 2 typing submissions for the 20 qualifiers
  let round2Submissions = 0;
  for (let i = 0; i < qualifiers.length; i++) {
    const participantCode = qualifiers[i];
    const station = listStations().find((s) => s.participantCode === participantCode);
    if (!station) continue;

    const wpm = 60 + ((i * 5) % 55); // 60 to 115 WPM
    const accuracy = 94 + ((i * 2) % 6);
    const charCount = 410;
    const durationMs = Math.round(((charCount / 5) / wpm) * 60000);

    const typedText = generateTypedPassage("Low Latency Networking & High Concurrency", charCount, accuracy);

    submitAttempt(participantCode, station.stationCode, typedText, durationMs);
    round2Submissions++;
  }

  // Step 7: Finalize Contest
  finalizeContest("HOST_SIMULATOR");

  const snapshot = getContestSnapshot();
  const topStation = snapshot.stations
    .filter((s) => s.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];

  const durationMs = Date.now() - startTime;

  return {
    timestamp: new Date().toISOString(),
    durationMs,
    totalParticipants: 50,
    readyStations: snapshot.connectedStations,
    round1Submissions,
    round2Submissions,
    disqualifications: snapshot.disqualifiedStations,
    qualifiersSelected: qualifiers.length,
    topScorer: topStation
      ? {
          participantCode: topStation.participantCode ?? "N/A",
          stationCode: topStation.stationCode,
          score: topStation.score ?? 0,
          wpm: topStation.wpm ?? 0,
          accuracy: topStation.accuracy ?? 0
        }
      : null,
    systemHealth: "OPTIMAL",
    goNoGoDecision: "GO - READY FOR LIVE EVENT"
  };
}

function generateTypedPassage(title: string, length: number, accuracy: number): string {
  const chars = `${title}: systems engineering and concurrent design fundamentals.`;
  let result = chars.substring(0, length);
  if (result.length < length) {
    result = result.padEnd(length, ".");
  }
  if (accuracy < 98 && result.length > 2) {
    return result.slice(0, -1) + "x";
  }
  return result;
}
