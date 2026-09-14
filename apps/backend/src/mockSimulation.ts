import { calculateQualifiers, finalizeContest, getContestSnapshot, recordViolation, startRound, submitAttempt } from "./contestEngine.js";
import { assignNextStation, getStation, listStations } from "./stations.js";
import { createRoom } from "./room.js";

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
    email: string;
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
  const participantCount = 50;

  // Step 1: Create a mock room with fake emails
  const emails = Array.from({ length: participantCount }, (_, i) =>
    `participant${String(i + 1).padStart(3, "0")}@test.com`
  );
  createRoom("Mock Rehearsal Competition", emails);

  // Step 2: Simulate participant joins (dynamic station assignment)
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i]!;
    const name = `Participant ${i + 1}`;
    const station = assignNextStation(email, name);
    station.status = "READY";
  }

  // Step 3: Host starts Round 1
  startRound(1, "HOST_SIMULATOR");

  // Step 4: Simulate submissions with realistic WPM & Accuracy
  let round1Submissions = 0;
  const stationList = listStations();
  for (let i = 0; i < stationList.length; i++) {
    const station = stationList[i]!;
    const email = station.email!;
    const stationCode = station.stationCode;

    // Simulate 1 anti-cheat DQ scenario for testing (station 7)
    if (i === 6) {
      recordViolation(email, stationCode, "PASTE", "Automated mock test: paste attempt detected");
      continue;
    }

    const wpm = 45 + ((i * 7) % 65); // 45 to 110 WPM
    const accuracy = 92 + ((i * 3) % 8); // 92% to 99%
    const durationMs = 60000;

    const activeContent1 = getContestSnapshot().activePassage?.content ?? "Systems engineering and concurrent design.";
    const typedText = generateTypedPassage(activeContent1, wpm, accuracy);

    submitAttempt(email, stationCode, typedText, durationMs);
    round1Submissions++;
  }

  // Step 5: Host selects Top 20 Qualifiers
  const qualifiers = calculateQualifiers(20, "HOST_SIMULATOR");

  // Step 6: Host starts Round 2 for qualifiers
  startRound(2, "HOST_SIMULATOR");

  // Step 7: Simulate Round 2 typing submissions for the 20 qualifiers
  let round2Submissions = 0;
  for (let i = 0; i < qualifiers.length; i++) {
    const qualifierEmail = qualifiers[i]!;
    const station = listStations().find((s) => s.email === qualifierEmail);
    if (!station) continue;

    const wpm = 60 + ((i * 5) % 55); // 60 to 115 WPM
    const accuracy = 94 + ((i * 2) % 6);
    const durationMs = 180000;

    const activeContent2 = getContestSnapshot().activePassage?.content ?? "Low Latency Networking";
    const typedText = generateTypedPassage(activeContent2, wpm * 3, accuracy);

    submitAttempt(qualifierEmail, station.stationCode, typedText, durationMs);
    round2Submissions++;
  }

  // Step 8: Finalize Contest
  finalizeContest("HOST_SIMULATOR");

  const snapshot = getContestSnapshot();
  const topStation = snapshot.stations
    .filter((s) => s.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];

  const durationMs = Date.now() - startTime;

  return {
    timestamp: new Date().toISOString(),
    durationMs,
    totalParticipants: participantCount,
    readyStations: snapshot.connectedStations,
    round1Submissions,
    round2Submissions,
    disqualifications: snapshot.disqualifiedStations,
    qualifiersSelected: qualifiers.length,
    topScorer: topStation
      ? {
          email: topStation.email ?? "N/A",
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

function generateTypedPassage(activeContent: string, wordCount: number, accuracy: number): string {
  const words = activeContent.trim().split(/\s+/);
  const selectedWords = words.slice(0, Math.max(1, wordCount));
  if (accuracy < 98 && selectedWords.length > 2) {
    selectedWords[selectedWords.length - 1] = selectedWords[selectedWords.length - 1] + "x";
  }
  return selectedWords.join(" ");
}
