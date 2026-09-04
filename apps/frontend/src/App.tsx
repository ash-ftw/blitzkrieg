import { FormEvent, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import type { AuditLogEntry, AuthUser, ContestSnapshot, IncidentReport, LoginResponse, StationSnapshot, StationStatus } from "@blitzkrieg/shared";
import { SystemCheck } from "./components/SystemCheck";
import { TypingEngine } from "./components/TypingEngine";

const socketUrl = import.meta.env.VITE_SOCKET_URL ?? `${window.location.protocol}//${window.location.hostname}:4000`;
const authStorageKey = "blitzkrieg.session";

const fallbackSnapshot: ContestSnapshot = {
  name: "Blitzkrieg - Fast Typing",
  status: "READY",
  round: 1,
  durationSeconds: 60,
  remainingSeconds: 60,
  isLocked: false,
  qualifierCount: 20,
  qualifiers: [],
  activePassage: null,
  connectedStations: 50,
  readyStations: 50,
  typingStations: 0,
  submittedStations: 0,
  disqualifiedStations: 0,
  offlineStations: 0,
  incidents: [],
  auditLogs: [],
  stations: Array.from({ length: 50 }, (_, index) => {
    const stationNumber = index + 1;
    return {
      stationCode: `PC-${String(stationNumber).padStart(2, "0")}`,
      participantCode: `BZK${String(stationNumber).padStart(3, "0")}`,
      status: "READY",
      wpm: null,
      accuracy: null,
      score: null,
      lastHeartbeatSecondsAgo: 1
    };
  })
};

const statusLabels: Record<StationStatus, string> = {
  OFFLINE: "Offline",
  AVAILABLE: "Available",
  ASSIGNED: "Assigned",
  READY: "Ready",
  TYPING: "Typing",
  SUBMITTED: "Submitted",
  DISQUALIFIED: "DQ",
  TECHNICAL_ISSUE: "Issue"
};

interface SessionState {
  token: string;
  user: AuthUser;
  expiresAt: string;
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function App() {
  const [session, setSession] = useState<SessionState | null>(() => readStoredSession());
  const [snapshot, setSnapshot] = useState<ContestSnapshot>(fallbackSnapshot);

  useEffect(() => {
    if (!session) return;

    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${session.token}` }
    })
      .then((res) => {
        if (!res.ok) throw new Error("Session expired");
        return res.json();
      })
      .then((data: Omit<SessionState, "token">) => {
        setSession((current) => (current ? { ...current, ...data } : current));
      })
      .catch(() => clearSession(setSession));
  }, [session?.token]);

  useEffect(() => {
    if (!session) return;

    fetch("/api/contest/current", { headers: { Authorization: `Bearer ${session.token}` } })
      .then((res) => res.json())
      .then((data: ContestSnapshot) => setSnapshot(data))
      .catch(() => undefined);

    const socket = io(socketUrl, {
      transports: ["websocket"],
      auth: { token: session.token }
    });
    socket.on("contest:state", (data: ContestSnapshot) => setSnapshot(data));

    return () => {
      socket.disconnect();
    };
  }, [session]);

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }

  if (session.user.role === "PARTICIPANT") {
    return <ParticipantView session={session} snapshot={snapshot} onLogout={() => logout(session.token, setSession)} />;
  }

  return <HostDashboard session={session} snapshot={snapshot} onLogout={() => logout(session.token, setSession)} />;
}

function LoginScreen({ onLogin }: { onLogin: (session: SessionState) => void }) {
  const [username, setUsername] = useState("host");
  const [password, setPassword] = useState("host123");
  const [stationCode, setStationCode] = useState("PC-01");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        stationCode: stationCode.trim() || undefined
      })
    });

    const data = await response.json();
    setIsSubmitting(false);

    if (!response.ok) {
      setError(data.message ?? "Login failed");
      return;
    }

    const session = data as LoginResponse;
    localStorage.setItem(authStorageKey, JSON.stringify(session));
    onLogin(session);
  }

  return (
    <main className="auth-shell">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">Blitzkrieg Access</p>
          <h1>Competition Login</h1>
        </div>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" />
        </label>
        <label>
          Station Code
          <input value={stationCode} onChange={(e) => setStationCode(e.target.value.toUpperCase())} placeholder="PC-01" />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="button button-primary" disabled={isSubmitting}>
          {isSubmitting ? "Authenticating..." : "Enter Platform"}
        </button>
        <p className="hint">Host: host / host123. Participant: bzk001 / typing123 / PC-01.</p>
      </form>
    </main>
  );
}

function HostDashboard({ session, snapshot, onLogout }: { session: SessionState; snapshot: ContestSnapshot; onLogout: () => void }) {
  const [managingStation, setManagingStation] = useState<StationSnapshot | null>(null);

  const leaders = useMemo(
    () =>
      snapshot.stations
        .filter((s) => s.score !== null && s.score !== undefined)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 10),
    [snapshot.stations]
  );

  async function handleStartRound(round: 1 | 2) {
    await fetch("/api/contest/start-round", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ round })
    }).catch(() => undefined);
  }

  async function handleToggleLock() {
    await fetch("/api/contest/lock", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` }
    }).catch(() => undefined);
  }

  async function handleCalculateQualifiers() {
    const count = prompt("Enter number of qualifiers for Round 2:", "20");
    if (!count) return;

    await fetch("/api/contest/calculate-qualifiers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ count: Number(count) })
    }).catch(() => undefined);
  }

  async function handleFinalizeContest() {
    if (!confirm("Are you sure you want to finalize the contest? Results will be officially frozen.")) return;
    await fetch("/api/contest/finalize", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` }
    }).catch(() => undefined);
  }

  async function handleExportCsv() {
    const response = await fetch("/api/contest/export-csv", {
      headers: { Authorization: `Bearer ${session.token}` }
    });
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blitzkrieg-contest-results-${Date.now()}.csv`;
    a.click();
  }

  async function handleTransferStation() {
    const from = prompt("Enter SOURCE station code (e.g. PC-05):");
    if (!from) return;
    const to = prompt("Enter TARGET station code (e.g. PC-18):");
    if (!to) return;

    const res = await fetch("/api/contest/transfer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fromStationCode: from, toStationCode: to })
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.message ?? "Transfer failed");
    }
  }

  async function handleDisqualify(stationCode: string) {
    if (!confirm(`Are you sure you want to disqualify ${stationCode}?`)) return;
    await fetch("/api/contest/disqualify", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ stationCode, reason: "Manual Host Disqualification" })
    }).catch(() => undefined);
  }

  async function handleSimulateRehearsal() {
    if (!confirm("Run complete 50-Station Mock Competition Rehearsal? This will simulate logins, Round 1, qualification, and Round 2.")) return;
    const res = await fetch("/api/contest/simulate-rehearsal", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` }
    });
    const data = await res.json();
    if (data.report) {
      alert(`MOCK REHEARSAL COMPLETE!\nDecision: ${data.report.goNoGoDecision}\nTop Scorer: ${data.report.topScorer?.participantCode} (${data.report.topScorer?.score} pts)\nDisqualifications Tested: ${data.report.disqualifications}`);
    }
  }

  async function handleResetContest() {
    if (!confirm("Reset contest state to clean READY status? This will reset all 50 stations and wipe previous attempt scores.")) return;
    await fetch("/api/contest/reset", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` }
    }).catch(() => undefined);
  }

  async function handleRestartRound(round: 1 | 2) {
    if (!confirm(`Restart Round ${round} for ALL participants? This will assign a fresh passage, reset the timer, and allow everyone to retake the round.`)) return;
    await fetch("/api/contest/restart-round", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ round })
    }).catch(() => undefined);
  }

  return (
    <main className="app-shell">
      <section className="command-bar" aria-label="Host command bar">
        <div>
          <p className="eyebrow">Host Control Console</p>
          <h1>{snapshot.name}</h1>
        </div>
        <div className="round-panel">
          <span>Round {snapshot.round} ({snapshot.status})</span>
          <strong>{formatTime(snapshot.remainingSeconds)}</strong>
        </div>
        <div className="actions">
          <button type="button" className="button button-secondary" onClick={handleToggleLock}>
            {snapshot.isLocked ? "Unlock" : "Lock Contest"}
          </button>

          {snapshot.status === "ROUND_1_COMPLETE" ? (
            <button type="button" className="button button-secondary" onClick={handleCalculateQualifiers}>
              Select Qualifiers ({snapshot.qualifierCount})
            </button>
          ) : null}

          {snapshot.status === "QUALIFICATION" || snapshot.status === "ROUND_1_COMPLETE" ? (
            <button type="button" className="button button-primary" onClick={() => handleStartRound(2)}>
              Start Round 2
            </button>
          ) : (
            <button type="button" className="button button-primary" onClick={() => handleStartRound(1)}>
              Start Round 1
            </button>
          )}

          <button type="button" className="button button-secondary" onClick={() => handleRestartRound(1)} title="Allow all participants to retake Round 1 with a fresh passage">
            Restart Round 1
          </button>

          <button type="button" className="button button-secondary" onClick={handleResetContest} title="Reset all 50 stations to clean READY state">
            Reset State
          </button>

          <button type="button" className="button button-secondary" onClick={handleSimulateRehearsal} title="Run 50-PC load test simulation">
            Run 50-PC Rehearsal
          </button>

          <button type="button" className="button button-secondary" onClick={handleTransferStation} title="Transfer participant to backup station">
            Transfer Station
          </button>

          <button type="button" className="button button-secondary" onClick={handleExportCsv} title="Export CSV rankings">
            Export CSV
          </button>

          {snapshot.status === "ROUND_2_COMPLETE" ? (
            <button type="button" className="button button-primary" onClick={handleFinalizeContest}>
              Finalize Results
            </button>
          ) : null}

          <button type="button" className="icon-button" onClick={onLogout} title={`Logout ${session.user.username}`}>
            Exit
          </button>
        </div>
      </section>

      <section className="metrics-grid" aria-label="Contest metrics">
        <Metric label="Connected" value={snapshot.connectedStations} />
        <Metric label="Ready" value={snapshot.readyStations} />
        <Metric label="Typing" value={snapshot.typingStations} />
        <Metric label="Submitted" value={snapshot.submittedStations} />
        <Metric label="DQ" value={snapshot.disqualifiedStations} />
        <Metric label="Offline" value={snapshot.offlineStations} muted />
      </section>

      <section className="workspace">
        <div className="station-board">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Lab Station Matrix</p>
              <h2>50 Concurrent Stations Overview</h2>
            </div>
            <StatusLegend />
          </div>
          <div className="station-grid">
            {snapshot.stations.map((station) => (
              <StationTile key={station.stationCode} station={station} onManage={() => setManagingStation(station)} />
            ))}
          </div>
        </div>

        {managingStation ? (
          <div className="modal-overlay" onClick={() => setManagingStation(null)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Station {managingStation.stationCode} Management</h2>
                <button type="button" className="icon-button" onClick={() => setManagingStation(null)}>✕</button>
              </div>

              <div className="modal-details">
                <div><strong>Assigned Participant:</strong> {managingStation.participantCode ?? "Unassigned"}</div>
                <div><strong>Current Status:</strong> {statusLabels[managingStation.status]}</div>
                {managingStation.score !== null ? (
                  <div><strong>Recorded Performance:</strong> {managingStation.score} pts ({managingStation.wpm} WPM @ {managingStation.accuracy}% Acc)</div>
                ) : null}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={async () => {
                    await fetch("/api/contest/reset-station", {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${session.token}`,
                        "Content-Type": "application/json"
                      },
                      body: JSON.stringify({ stationCode: managingStation.stationCode })
                    }).catch(() => undefined);
                    setManagingStation(null);
                  }}
                >
                  🔄 Reset Attempt (Allow Retake)
                </button>

                <button
                  type="button"
                  className="button button-secondary"
                  onClick={async () => {
                    handleDisqualify(managingStation.stationCode);
                    setManagingStation(null);
                  }}
                >
                  ⚠️ Disqualify Station
                </button>

                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    const to = prompt(`Transfer participant ${managingStation.participantCode} from ${managingStation.stationCode} to target station code (e.g. PC-18):`);
                    if (to) {
                      fetch("/api/contest/transfer", {
                        method: "POST",
                        headers: {
                          Authorization: `Bearer ${session.token}`,
                          "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ fromStationCode: managingStation.stationCode, toStationCode: to })
                      }).catch(() => undefined);
                    }
                    setManagingStation(null);
                  }}
                >
                  🔁 Transfer Station
                </button>

                <button type="button" className="button button-secondary" onClick={() => setManagingStation(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <aside className="side-panel" aria-label="Live judging panel">
          <section>
            <p className="eyebrow">Official Leaderboard (WPM × Acc%)</p>
            <div className="leader-list">
              {leaders.length === 0 ? (
                <p className="hint">No completed submissions yet.</p>
              ) : (
                leaders.map((st, index) => (
                  <div className="leader-row" key={st.stationCode}>
                    <span className="rank">{index + 1}</span>
                    <div>
                      <strong>{st.participantCode}</strong>
                      <span>{st.stationCode} • {st.wpm} WPM ({st.accuracy}%)</span>
                    </div>
                    <span className="score">{st.score}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <p className="eyebrow">Anti-Cheat Incident Stream</p>
            <div className="incident-feed">
              {snapshot.incidents.length === 0 ? (
                <p className="hint">No violations recorded.</p>
              ) : (
                snapshot.incidents.slice(0, 4).map((inc: IncidentReport) => (
                  <div className="incident" key={inc.id}>
                    <div>
                      <span className="incident-badge">{inc.type}</span>
                      <strong>{inc.participantCode} ({inc.stationCode})</strong>
                    </div>
                    <span>{inc.details} • {inc.timestamp}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <p className="eyebrow">Event Audit Trail</p>
            <div className="audit-feed">
              {snapshot.auditLogs.slice(0, 4).map((log: AuditLogEntry) => (
                <div key={log.id} className="audit-item">
                  <strong>{log.actor} [{log.action}]</strong>
                  <span>{log.details}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function ParticipantView({ session, snapshot, onLogout }: { session: SessionState; snapshot: ContestSnapshot; onLogout: () => void }) {
  const [systemCheckPassed, setSystemCheckPassed] = useState(false);

  useEffect(() => {
    if (!session.user.stationCode) return;

    const sendHeartbeat = () => {
      fetch(`/api/stations/${session.user.stationCode}/heartbeat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      }).catch(() => undefined);
    };

    sendHeartbeat();
    const intervalId = window.setInterval(sendHeartbeat, 5000);
    return () => window.clearInterval(intervalId);
  }, [session.token, session.user.stationCode]);

  const currentStation = snapshot.stations.find((s) => s.stationCode === session.user.stationCode);
  const isTypingActive = (snapshot.status === "ROUND_1" || snapshot.status === "ROUND_2") && currentStation?.status === "TYPING" && snapshot.activePassage;

  return (
    <main className="participant-shell">
      <section className="participant-panel">
        <div>
          <p className="eyebrow">Participant Station Console</p>
          <h1>{session.user.participantCode} • {session.user.stationCode}</h1>
        </div>

        {!systemCheckPassed ? (
          <SystemCheck
            stationCode={session.user.stationCode ?? "PC-01"}
            participantCode={session.user.participantCode ?? "BZK001"}
            onPassed={() => setSystemCheckPassed(true)}
          />
        ) : (
          <>
            <div className="participant-status-grid">
              <Metric label="Station Status" valueText={currentStation?.status ?? "READY"} />
              <Metric label="Active Phase" valueText={`Round ${snapshot.round}`} />
              <Metric label="Server Timer" valueText={formatTime(snapshot.remainingSeconds)} />
            </div>

            {isTypingActive && snapshot.activePassage ? (
              <TypingEngine
                passage={snapshot.activePassage}
                token={session.token}
                remainingSeconds={snapshot.remainingSeconds}
                durationSeconds={snapshot.durationSeconds}
                onSubmitted={() => undefined}
              />
            ) : (
              <div className="waiting-card">
                {currentStation?.status === "SUBMITTED" ? (
                  <>
                    <strong>Attempt Submitted Successfully!</strong>
                    <span>Score recorded: <strong>{currentStation.score ?? 0} pts</strong> ({currentStation.wpm ?? 0} WPM @ {currentStation.accuracy ?? 100}% Accuracy). Stand by for official Host results.</span>
                  </>
                ) : currentStation?.status === "DISQUALIFIED" ? (
                  <>
                    <strong style={{ color: "var(--danger)" }}>Station Disqualified</strong>
                    <span>An anti-cheat or manual host violation occurred on this computer. Contact the Host if you require assistance.</span>
                  </>
                ) : (
                  <>
                    <strong>Waiting Room — Diagnostic Passed</strong>
                    <span>Your assigned station is locked and verified. The typing passage will load automatically on your screen when the Host begins the round.</span>
                  </>
                )}
              </div>
            )}
          </>
        )}

        <button type="button" className="button button-secondary" onClick={onLogout}>
          Logout Station
        </button>
      </section>
    </main>
  );
}

function Metric({ label, value, valueText, muted = false }: { label: string; value?: number; valueText?: string; muted?: boolean }) {
  return (
    <div className={muted ? "metric muted" : "metric"}>
      <span>{label}</span>
      <strong>{valueText ?? value}</strong>
    </div>
  );
}

function StatusLegend() {
  const statuses: StationStatus[] = ["READY", "TYPING", "SUBMITTED", "DISQUALIFIED", "AVAILABLE", "TECHNICAL_ISSUE", "OFFLINE"];

  return (
    <div className="legend">
      {statuses.map((status) => (
        <span key={status}>
          <i className={`status-dot ${status.toLowerCase()}`} />
          {statusLabels[status]}
        </span>
      ))}
    </div>
  );
}

function StationTile({ station, onManage }: { station: StationSnapshot; onManage: () => void }) {
  return (
    <article className={`station-tile ${station.status.toLowerCase()}`} onClick={onManage} title="Click to reset attempt or disqualify station">
      <div>
        <strong>{station.stationCode}</strong>
        <span>{station.participantCode ?? "Unassigned"}</span>
        {station.score ? <small style={{ color: "var(--crown)", fontSize: "0.7rem" }}>{station.score} pts</small> : null}
      </div>
      <span className="station-status">{statusLabels[station.status]}</span>
    </article>
  );
}

function readStoredSession(): SessionState | null {
  const stored = localStorage.getItem(authStorageKey);
  if (!stored) return null;

  try {
    return JSON.parse(stored) as SessionState;
  } catch {
    localStorage.removeItem(authStorageKey);
    return null;
  }
}

function clearSession(setSession: (session: SessionState | null) => void) {
  localStorage.removeItem(authStorageKey);
  setSession(null);
}

async function logout(token: string, setSession: (session: SessionState | null) => void) {
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  }).catch(() => undefined);

  clearSession(setSession);
}

export default App;
