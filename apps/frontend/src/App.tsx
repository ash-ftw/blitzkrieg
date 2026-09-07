import { FormEvent, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import type { AuditLogEntry, AuthUser, ContestSnapshot, IncidentReport, LoginResponse, RoomSnapshot, StationSnapshot, StationStatus } from "@blitzkrieg/shared";
import { SystemCheck } from "./components/SystemCheck";
import { TypingEngine } from "./components/TypingEngine";

const socketUrl = import.meta.env.VITE_SOCKET_URL ?? `${window.location.protocol}//${window.location.hostname}:4000`;
const authStorageKey = "blitzkrieg.session";

const fallbackSnapshot: ContestSnapshot = {
  name: "Blitzkrieg Competition",
  status: "SETUP",
  round: 1,
  durationSeconds: 60,
  remainingSeconds: 60,
  isLocked: false,
  qualifierCount: 20,
  qualifiers: [],
  activePassage: null,
  connectedStations: 0,
  readyStations: 0,
  typingStations: 0,
  submittedStations: 0,
  disqualifiedStations: 0,
  offlineStations: 0,
  incidents: [],
  auditLogs: [],
  stations: [],
  room: null
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

    // Lightweight timer tick — update only the countdown without replacing the full snapshot
    socket.on("contest:tick", (tick: { remainingSeconds: number; status: string }) => {
      setSnapshot((prev) => ({
        ...prev,
        remainingSeconds: tick.remainingSeconds,
        status: tick.status as ContestSnapshot["status"]
      }));
    });

    return () => {
      socket.disconnect();
    };
  }, [session?.token]);

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }

  if (session.user.role === "PARTICIPANT") {
    return <ParticipantView session={session} snapshot={snapshot} onLogout={() => logout(session.token, setSession)} />;
  }

  return <HostDashboard session={session} snapshot={snapshot} onLogout={() => logout(session.token, setSession)} />;
}

// ─── Login Screen ───────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (session: SessionState) => void }) {
  const [mode, setMode] = useState<"host" | "participant">("participant");
  const [username, setUsername] = useState("host");
  const [password, setPassword] = useState("host123");
  const [email, setEmail] = useState("");
  const [roomPin, setRoomPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const body: Record<string, string> = mode === "host"
      ? { username, password }
      : { email: email.trim(), roomPin: roomPin.trim() };

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
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
          <h1>{mode === "host" ? "Host Control Console" : "Competition Login"}</h1>
        </div>

        {mode === "host" ? (
          <>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </label>
            <label>
              Password
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" />
            </label>
          </>
        ) : (
          <>
            <label>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@college.edu" autoComplete="email" />
            </label>
            <label>
              Room PIN
              <input value={roomPin} onChange={(e) => setRoomPin(e.target.value)} placeholder="6-digit PIN from host" maxLength={6} inputMode="numeric" autoComplete="off" />
            </label>
          </>
        )}

        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="button button-primary" disabled={isSubmitting}>
          {isSubmitting ? "Authenticating..." : "Enter Platform"}
        </button>
        {mode === "participant" ? (
          <p className="hint">Enter the email registered by the host and the Room PIN displayed on the board.</p>
        ) : (
          <p className="hint">Host credentials required.</p>
        )}
      </form>

      <button
        type="button"
        className="subtle-mode-toggle"
        onClick={() => setMode(mode === "participant" ? "host" : "participant")}
      >
        {mode === "participant" ? "Admin Access" : "Return to Participant Login"}
      </button>
    </main>
  );
}

// ─── Host Dashboard ─────────────────────────────────────────────────

function HostDashboard({ session, snapshot, onLogout }: { session: SessionState; snapshot: ContestSnapshot; onLogout: () => void }) {
  const [managingStation, setManagingStation] = useState<StationSnapshot | null>(null);
  const [startWarningRound, setStartWarningRound] = useState<1 | 2 | null>(null);
  const [unreadyCount, setUnreadyCount] = useState(0);
  const showSetup = snapshot.status === "SETUP" || (snapshot.status === "READY" && !snapshot.room);

  const leaders = useMemo(
    () =>
      snapshot.stations
        .filter((s) => s.score !== null && s.score !== undefined)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 10),
    [snapshot.stations]
  );

  async function handleStartRound(round: 1 | 2) {
    const count = snapshot.stations.filter((s) => s.status === "ASSIGNED" || s.status === "AVAILABLE").length;
    if (count > 0) {
      setUnreadyCount(count);
      setStartWarningRound(round);
      return;
    }

    await executeStartRound(round);
  }

  async function executeStartRound(round: 1 | 2) {
    setStartWarningRound(null);
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
    if (!confirm("Run complete Mock Competition Rehearsal? This will simulate logins, Round 1, qualification, and Round 2.")) return;
    const res = await fetch("/api/contest/simulate-rehearsal", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` }
    });
    const data = await res.json();
    if (data.report) {
      alert(`MOCK REHEARSAL COMPLETE!\nDecision: ${data.report.goNoGoDecision}\nTop Scorer: ${data.report.topScorer?.email} (${data.report.topScorer?.score} pts)\nDisqualifications Tested: ${data.report.disqualifications}`);
    }
  }

  async function handleResetContest() {
    if (!confirm("Reset contest state to clean SETUP status? This will wipe all stations, rooms, and previous attempt scores.")) return;
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

  if (showSetup) {
    return (
      <main className="app-shell">
        <section className="command-bar" aria-label="Host command bar">
          <div>
            <p className="eyebrow">Host Control Console</p>
            <h1>Create Competition</h1>
          </div>
          <div />
          <div className="actions">
            <button type="button" className="button button-secondary" onClick={handleSimulateRehearsal} title="Run mock competition simulation">
              Run Rehearsal
            </button>
            <button type="button" className="icon-button" onClick={onLogout} title={`Logout ${session.user.username}`}>
              Exit
            </button>
          </div>
        </section>

        <RoomSetup token={session.token} room={snapshot.room} />
      </main>
    );
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

          <button type="button" className="button button-secondary" onClick={handleResetContest} title="Reset everything to clean SETUP state">
            Reset State
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
              <h2>{snapshot.stations.length} Active Stations</h2>
            </div>
            <StatusLegend />
          </div>
          {(snapshot.status === "QUALIFICATION" || snapshot.status === "STARTING_ROUND_2" || snapshot.status === "ROUND_2" || snapshot.status === "ROUND_2_COMPLETE" || snapshot.status === "FINALIZED") ? (
            <>
              <h3 style={{ marginTop: '1.5rem', marginBottom: '1rem', color: 'var(--crown)' }}>Qualified for Round 2</h3>
              <div className="station-grid">
                {snapshot.stations.filter(s => snapshot.qualifiers?.includes(s.email ?? "")).map((station) => (
                  <StationTile key={station.stationCode} station={station} onManage={() => setManagingStation(station)} />
                ))}
              </div>
              
              <div style={{ margin: '2rem 0', borderBottom: '1px solid var(--iron)' }}></div>

              <h3 style={{ marginBottom: '1rem', color: 'var(--chalk)' }}>Did Not Qualify / Disqualified</h3>
              <div className="station-grid" style={{ opacity: 0.6 }}>
                {snapshot.stations.filter(s => !snapshot.qualifiers?.includes(s.email ?? "")).map((station) => (
                  <StationTile key={station.stationCode} station={station} onManage={() => setManagingStation(station)} />
                ))}
              </div>
            </>
          ) : (
            <div className="station-grid">
              {snapshot.stations.map((station) => (
                <StationTile key={station.stationCode} station={station} onManage={() => setManagingStation(station)} />
              ))}
            </div>
          )}
        </div>

        {managingStation ? (
          <div className="modal-overlay" onClick={() => setManagingStation(null)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Station {managingStation.stationCode} Management</h2>
                <button type="button" className="icon-button" onClick={() => setManagingStation(null)}>✕</button>
              </div>

              <div className="modal-details">
                <div><strong>Assigned Participant:</strong> {managingStation.email ?? "Unassigned"}</div>
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
                  🛑 Disqualify Station
                </button>

                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    const to = prompt(`Transfer participant ${managingStation.email} from ${managingStation.stationCode} to target station code (e.g. PC-18):`);
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

        {startWarningRound !== null ? (
          <div className="modal-overlay" onClick={() => setStartWarningRound(null)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ borderTop: "4px solid var(--warning, #f59e0b)" }}>
              <div className="modal-header">
                <h2 style={{ color: "var(--warning, #f59e0b)" }}>Participants Not Ready</h2>
                <button type="button" className="icon-button" onClick={() => setStartWarningRound(null)}>✕</button>
              </div>

              <div className="modal-details">
                <p>
                  <strong>{unreadyCount} participant(s)</strong> have not completed the system diagnostic check yet.
                </p>
                <p style={{ color: "var(--chalk)", marginTop: "1rem" }}>
                  If you start the round now, these stations will still be forced to start the typing test, but they may experience technical issues.
                </p>
              </div>

              <div className="modal-actions">
                <button type="button" className="button button-primary" onClick={() => executeStartRound(startWarningRound)}>
                  Continue Anyway
                </button>
                <button type="button" className="button button-secondary" onClick={() => setStartWarningRound(null)}>
                  Cancel
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
                      <strong>{st.email}</strong>
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
                      <strong>{inc.email} ({inc.stationCode})</strong>
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

          {snapshot.room ? (
            <section>
              <p className="eyebrow">Room Info</p>
              <div className="room-info-card">
                <div><strong>PIN:</strong> <span className="room-pin-inline">{snapshot.room.roomPin}</span></div>
                <div><strong>Joined:</strong> {snapshot.room.joinedParticipants.length} / {snapshot.room.totalInvited}</div>
                <div><strong>Status:</strong> {snapshot.room.isOpen ? "Open" : "Closed"}</div>
              </div>
            </section>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

// ─── Room Setup ─────────────────────────────────────────────────────

function RoomSetup({ token, room }: { token: string; room: RoomSnapshot | null }) {
  const [competitionName, setCompetitionName] = useState("Blitzkrieg - College LAN Championship");
  const [emailInput, setEmailInput] = useState("");
  const [bulkEmails, setBulkEmails] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [histories, setHistories] = useState<any[]>([]);

  useEffect(() => {
    if (room) return;
    fetch("/api/history/qualifiers", { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setHistories(data.histories ?? []))
      .catch(() => undefined);
  }, [token, room]);

  async function handleLoadHistory(filename: string) {
    setIsCreating(true);
    setAddError(null);
    const res = await fetch("/api/room/create-from-history", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ filename })
    });
    if (!res.ok) {
      const err = await res.json();
      setAddError(err.message ?? "Failed to load history");
    }
    setIsCreating(false);
  }

  async function handleCreateRoom() {
    setIsCreating(true);
    setAddError(null);

    // Parse emails from the bulk textarea
    const emails = bulkEmails
      .split(/[\n,;]+/)
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && e.includes("@"));

    if (emails.length === 0) {
      setAddError("Add at least one valid email address.");
      setIsCreating(false);
      return;
    }

    const res = await fetch("/api/room/create", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ competitionName, emails })
    });

    if (!res.ok) {
      const err = await res.json();
      setAddError(err.message ?? "Failed to create room");
    }

    setIsCreating(false);
  }

  async function handleAddEmail() {
    if (!emailInput.trim() || !emailInput.includes("@")) return;
    setAddError(null);

    const res = await fetch("/api/room/add-participants", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ emails: [emailInput.trim()] })
    });

    if (res.ok) {
      setEmailInput("");
    } else {
      const err = await res.json();
      setAddError(err.message ?? "Failed to add participant");
    }
  }

  async function handleRemoveEmail(email: string) {
    await fetch(`/api/room/participant/${encodeURIComponent(email)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => undefined);
  }

  // ─ Pre-room creation view ─
  if (!room) {
    return (
      <section className="room-setup-panel">
        <div>
          <p className="eyebrow">Step 1 — Setup Competition Room</p>
          <h2>Configure & Add Participants</h2>
        </div>

        <label>
          Competition Name
          <input value={competitionName} onChange={(e) => setCompetitionName(e.target.value)} placeholder="Blitzkrieg - College LAN Championship" />
        </label>

        <label>
          Participant Emails <span className="hint">(one per line, or comma-separated)</span>
          <textarea
            className="email-textarea"
            value={bulkEmails}
            onChange={(e) => setBulkEmails(e.target.value)}
            placeholder={"student1@college.edu\nstudent2@college.edu\nstudent3@college.edu"}
            rows={8}
          />
        </label>

        {addError ? <p className="form-error">{addError}</p> : null}

        <button type="button" className="button button-primary" onClick={handleCreateRoom} disabled={isCreating}>
          {isCreating ? "Creating Room..." : "Create Room & Generate PIN"}
        </button>

        {histories.length > 0 && (
          <div className="history-section" style={{ marginTop: "2rem", paddingTop: "2rem", borderTop: "1px solid var(--iron)" }}>
            <p className="eyebrow">Or Resume from History (Round 2)</p>
            <div className="history-list" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "1rem" }}>
              {histories.map((h: any) => (
                <button key={h.filename} type="button" className="button button-secondary" onClick={() => handleLoadHistory(h.filename)} disabled={isCreating} style={{ textAlign: "left", justifyContent: "flex-start" }}>
                  Load "{h.competitionName}" ({h.count} Qualifiers) - {new Date(h.timestamp).toLocaleString()}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  // ─ Post-room creation: waiting room ─
  const joinedCount = room.joinedParticipants.length;
  const totalCount = room.totalInvited;

  return (
    <section className="room-setup-panel">
      <div>
        <p className="eyebrow">Step 2 — Share PIN & Wait for Participants</p>
        <h2>{room.competitionName}</h2>
      </div>

      <div className="room-pin-display">
        <span className="eyebrow">Room PIN — Share with participants</span>
        <strong>{room.roomPin}</strong>
      </div>

      <div className="join-counter">
        <span className="join-count">{joinedCount}</span>
        <span className="join-total"> / {totalCount} joined</span>
      </div>

      {/* Live add participant */}
      <div className="add-email-row">
        <input
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          placeholder="Add another email..."
          type="email"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddEmail(); } }}
        />
        <button type="button" className="button button-secondary" onClick={handleAddEmail}>Add</button>
      </div>

      {addError ? <p className="form-error">{addError}</p> : null}

      {/* Participant list */}
      <div className="email-list">
        {room.joinedParticipants.map((p) => (
          <div key={p.email} className="email-chip joined">
            <span>{p.email}</span>
            <span className="chip-station">{p.stationCode}</span>
            <span className="chip-status">✓ Joined</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Participant View ───────────────────────────────────────────────

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
  const isCountdownActive = snapshot.status === "STARTING_ROUND_1" || snapshot.status === "STARTING_ROUND_2";
  const [showEndModal, setShowEndModal] = useState(false);

  useEffect(() => {
    if (currentStation?.status === "SUBMITTED") {
      setShowEndModal(true);
    }
  }, [currentStation?.status]);

  return (
    <main className="participant-shell">
      <section className="participant-panel">
        <div>
          <p className="eyebrow">Participant Station Console</p>
          <h1>{session.user.email} • {session.user.stationCode}</h1>
        </div>

        {!systemCheckPassed ? (
          <SystemCheck
            stationCode={session.user.stationCode ?? "PC-01"}
            email={session.user.email ?? "participant"}
            onPassed={() => setSystemCheckPassed(true)}
          />
        ) : (
          <>
            <div className="participant-status-grid">
              <Metric label="Station Status" valueText={currentStation?.status ?? "READY"} />
              <Metric label="Active Phase" valueText={`Round ${snapshot.round}`} />
              <Metric label="Server Timer" valueText={formatTime(snapshot.remainingSeconds)} />
            </div>

            {isCountdownActive ? (
              <div className="countdown-overlay">
                <h1>{snapshot.remainingSeconds}</h1>
                <p>Get Ready!</p>
              </div>
            ) : null}

            {isTypingActive && snapshot.activePassage ? (
              <TypingEngine
                passage={snapshot.activePassage}
                token={session.token}
                remainingSeconds={snapshot.remainingSeconds}
                durationSeconds={snapshot.durationSeconds}
                onSubmitted={() => undefined}
              />
            ) : !isCountdownActive ? (
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
            ) : null}

            {showEndModal ? (
              <div className="modal-overlay">
                <div className="modal-card">
                  <div className="modal-header">
                    <h2>TIME'S UP!</h2>
                    <button type="button" className="icon-button" onClick={() => setShowEndModal(false)}>✕</button>
                  </div>
                  <div className="modal-details">
                    <div style={{ textAlign: "center", padding: "1rem 0" }}>
                      <strong>Your attempt was submitted automatically.</strong>
                      <br />
                      <span style={{ fontSize: "1.2rem", display: "block", marginTop: "1rem" }}>
                        Score: {currentStation?.score ?? 0} pts
                      </span>
                    </div>
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="button button-primary" onClick={() => setShowEndModal(false)}>Return to Waiting Room</button>
                  </div>
                </div>
              </div>
            ) : null}

            {currentStation?.status === "DISQUALIFIED" ? (
              <div className="modal-overlay">
                <div className="modal-card" style={{ borderTop: "4px solid var(--danger)" }}>
                  <div className="modal-header">
                    <h2 style={{ color: "var(--danger)" }}>STATION DISQUALIFIED</h2>
                  </div>
                  <div className="modal-details">
                    <div style={{ textAlign: "center", padding: "1rem 0" }}>
                      <strong>You did not qualify for Round 2, or an anti-cheat violation occurred.</strong>
                      <br />
                      <span style={{ fontSize: "1rem", display: "block", marginTop: "1rem", color: "var(--chalk)" }}>
                        Your station is locked. Contact the Host if you require assistance.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}

        <button type="button" className="button button-secondary" onClick={onLogout}>
          Logout Station
        </button>
      </section>
    </main>
  );
}

// ─── Shared components ──────────────────────────────────────────────

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
      <div className="station-tile-info">
        <strong>{station.stationCode}</strong>
        <span className="station-email" title={station.email ?? "Unassigned"}>{station.email ?? "Unassigned"}</span>
        {station.score ? <small style={{ color: "var(--crown)", fontSize: "0.7rem" }}>{station.score} pts</small> : null}
      </div>
      <span className="station-status">{statusLabels[station.status]}</span>
    </article>
  );
}

// ─── Session helpers ────────────────────────────────────────────────

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
