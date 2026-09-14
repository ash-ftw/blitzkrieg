import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  ingestedEmails: [],
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

const ALLOWED_ADMIN_EMAILS = new Set([
  "max@host.com",
  "lec@host.com",
  "kimi@host.com"
]);

function isAdminEmail(emailStr: string): boolean {
  const lower = emailStr.trim().toLowerCase();
  return ALLOWED_ADMIN_EMAILS.has(lower) || (lower.includes("@") && lower.endsWith("@host.com"));
}

function LoginScreen({ onLogin }: { onLogin: (session: SessionState) => void }) {
  const [mode, setMode] = useState<"host" | "participant">("participant");
  const [hostEmail, setHostEmail] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function transitionToHost() {
    setMode("host");
    setHostEmail("");
    setPassword("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (mode === "participant") {
      const trimmedEmail = email.trim();
      const trimmedName = name.trim();

      // If an admin email was entered in either field, immediately transition to host authentication
      if (isAdminEmail(trimmedEmail) || isAdminEmail(trimmedName)) {
        transitionToHost();
        return;
      }

      if (!trimmedName) {
        setError("Please enter your full name.");
        return;
      }
      if (!trimmedEmail) {
        setError("Please enter your registered email.");
        return;
      }
    } else {
      const trimmedHost = hostEmail.trim();
      if (!trimmedHost) {
        setError("Please enter host email.");
        return;
      }
      if (!password) {
        setError("Please enter host password.");
        return;
      }
    }

    setIsSubmitting(true);

    const body: Record<string, string> = mode === "host"
      ? { email: hostEmail.trim(), password }
      : { email: email.trim(), name: name.trim() };

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      setIsSubmitting(false);

      if (!response.ok) {
        if (mode === "participant" && (data.message?.includes("Host accounts") || data.message?.includes("host access"))) {
          transitionToHost();
          return;
        }
        setError(data.message ?? "Login failed");
        return;
      }

      const session = data as LoginResponse;
      localStorage.setItem(authStorageKey, JSON.stringify(session));
      onLogin(session);
    } catch {
      setIsSubmitting(false);
      setError("Network error connecting to authentication service.");
    }
  }

  return (
    <main className="auth-shell">
      <form className="login-panel" onSubmit={handleSubmit} noValidate>
        <div>
          <p className="eyebrow">{mode === "host" ? "Host Access" : "Blitzkrieg Access"}</p>
          <h1>{mode === "host" ? "Host Control Console" : "Competition Login"}</h1>
        </div>

        {mode === "host" ? (
          <>
            <label>
              Host Email
              <input
                value={hostEmail}
                onChange={(e) => setHostEmail(e.target.value)}
                type="email"
                placeholder="Enter host email (e.g. max@host.com)"
                autoComplete="email"
                required
                autoFocus
              />
            </label>
            <label>
              Password
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="Enter host password"
                autoComplete="current-password"
                required
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Your Full Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lewis Hamilton"
                autoComplete="name"
                required
              />
            </label>
            <label>
              Registered Email
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={(e) => {
                  if (isAdminEmail(e.target.value)) {
                    transitionToHost();
                  }
                }}
                type="email"
                placeholder="you@college.edu"
                autoComplete="email"
                required
              />
            </label>
          </>
        )}

        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="button button-primary" disabled={isSubmitting}>
          {isSubmitting ? "Authenticating..." : (mode === "host" ? "Enter Host Console" : "Enter Contest & Allot PC")}
        </button>
        {mode === "participant" ? (
          <p className="hint">Workstation will be allotted automatically upon login. Enter your registered email.</p>
        ) : (
          <p className="hint">Authorized host accounts: max@host.com, lec@host.com, kimi@host.com</p>
        )}
      </form>

      {mode === "host" && (
        <button
          type="button"
          className="subtle-mode-toggle"
          onClick={() => {
            setMode("participant");
            setEmail("");
            setName("");
            setError(null);
          }}
        >
          ← Return to Participant Login
        </button>
      )}
    </main>
  );
}

// ─── Host Dashboard ─────────────────────────────────────────────────

function HostDashboard({ session, snapshot, onLogout }: { session: SessionState; snapshot: ContestSnapshot; onLogout: () => void }) {
  const [managingStation, setManagingStation] = useState<StationSnapshot | null>(null);
  const [startWarningRound, setStartWarningRound] = useState<1 | 2 | null>(null);
  const [unreadyCount, setUnreadyCount] = useState(0);
  const [showIngestionModal, setShowIngestionModal] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);

  const isRound2Phase =
    snapshot.round === 2 ||
    snapshot.status === "STARTING_ROUND_2" ||
    snapshot.status === "ROUND_2" ||
    snapshot.status === "ROUND_2_COMPLETE" ||
    snapshot.status === "QUALIFICATION";

  const leaders = useMemo(
    () => {
      const flaggedSet = new Set(snapshot.flaggedEmails ?? []);
      let list = snapshot.stations.filter((s) => {
        if (!s.email || s.score === null || s.score === undefined) return false;
        if (s.status === "DISQUALIFIED") return false;
        if (flaggedSet.has(s.email)) return false;
        return true;
      });

      // In Round 2 phase or when finalized, exclude participants who did not qualify for Round 2
      if (snapshot.round === 2 || snapshot.status === "ROUND_2_COMPLETE" || snapshot.status === "FINALIZED") {
        if (snapshot.qualifiers && snapshot.qualifiers.length > 0) {
          list = list.filter((s) => snapshot.qualifiers.includes(s.email ?? ""));
        }
      }

      return list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10);
    },
    [snapshot.stations, snapshot.round, snapshot.status, snapshot.qualifiers, snapshot.flaggedEmails]
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
          <button
            type="button"
            className="button button-secondary button-ingest"
            onClick={() => setShowIngestionModal(true)}
            title="Ingest participant emails and manage PC allotment"
          >
            📧 Ingest Emails ({snapshot.ingestedEmails?.length ?? 0})
          </button>

          <button type="button" className="button button-secondary" onClick={handleToggleLock}>
            {snapshot.isLocked ? "Unlock" : "Lock Contest"}
          </button>

          {snapshot.status === "ROUND_1_COMPLETE" ? (
            <button type="button" className="button button-secondary" onClick={handleCalculateQualifiers}>
              Select Qualifiers ({snapshot.qualifierCount})
            </button>
          ) : null}

          {snapshot.status === "ROUND_2_COMPLETE" ? (
            <button type="button" className="button button-primary" onClick={() => setShowFinalizeModal(true)}>
              🏆 Finalize Results
            </button>
          ) : snapshot.status === "FINALIZED" ? (
            <button type="button" className="button button-primary" onClick={() => setShowFinalizeModal(true)}>
              🏆 View Final Standings
            </button>
          ) : snapshot.status === "QUALIFICATION" || snapshot.status === "ROUND_1_COMPLETE" ? (
            <button type="button" className="button button-primary" onClick={() => handleStartRound(2)}>
              Start Round 2
            </button>
          ) : (
            <button type="button" className="button button-primary" onClick={() => handleStartRound(1)}>
              Start Round 1
            </button>
          )}

          {isRound2Phase ? (
            <>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => handleRestartRound(2)}
                title="Allow all qualified participants to retake Round 2 with a fresh passage"
              >
                🔄 Restart Round 2
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => handleRestartRound(1)}
                title="Allow all participants to retake Round 1 with a fresh passage"
              >
                Restart Round 1
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => handleRestartRound(1)}
              title="Allow all participants to retake Round 1 with a fresh passage"
            >
              🔄 Restart Round 1
            </button>
          )}

          <button type="button" className="button button-secondary" onClick={handleResetContest} title="Reset everything to clean SETUP state">
            Reset State
          </button>

          <button type="button" className="button button-secondary" onClick={handleTransferStation} title="Transfer participant to backup station">
            Transfer Station
          </button>

          <button type="button" className="button button-secondary" onClick={handleExportCsv} title="Export CSV rankings">
            Export CSV
          </button>

          <button type="button" className="button button-secondary" onClick={handleSimulateRehearsal} title="Run mock competition simulation">
            Rehearsal
          </button>

          <button type="button" className="icon-button" onClick={onLogout} title={`Logout ${session.user.username}`}>
            Exit
          </button>
        </div>
      </section>

      {snapshot.status === "FINALIZED" ? (
        <div className="finalized-banner">
          <div className="finalized-banner-content">
            <strong>🏆 Competition Finalized & Standings Frozen</strong>
            <span>Official rankings are frozen. Disqualified participants from Round 1 have been excluded from the results.</span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="button button-primary" onClick={() => setShowFinalizeModal(true)}>
              🏆 View Official Podium & Results
            </button>
            <button type="button" className="button button-secondary" onClick={handleExportCsv}>
              📥 Export Official CSV
            </button>
          </div>
        </div>
      ) : null}

      {(!snapshot.ingestedEmails || snapshot.ingestedEmails.length === 0) ? (
        <div className="ingest-banner">
          <div className="ingest-banner-content">
            <strong>⚡ Participant Email Ingestion Required</strong>
            <span>Add participant emails to allow contestants to log in. Workstations (PC-01, PC-02...) are automatically allotted upon login.</span>
          </div>
          <button
            type="button"
            className="button button-primary"
            onClick={() => setShowIngestionModal(true)}
          >
            Ingest Emails
          </button>
        </div>
      ) : null}

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
                <div><strong>Assigned Participant:</strong> {managingStation.name ? `${managingStation.name} (${managingStation.email})` : (managingStation.email ?? "Unassigned")}</div>
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
                    <div className="leader-info">
                      <strong className="leader-name">{st.name || st.email}</strong>
                      <span className="leader-meta">
                        <span className="station-code-inline">{st.stationCode}</span>
                        {st.name ? <span className="leader-email">{st.email}</span> : null}
                        <span>{st.wpm} WPM ({st.accuracy}%)</span>
                      </span>
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
                snapshot.incidents.slice(0, 4).map((inc: IncidentReport) => {
                  const station = snapshot.stations.find((s) => s.stationCode === inc.stationCode);
                  return (
                    <div className="incident" key={inc.id}>
                      <div>
                        <span className="incident-badge">{inc.type}</span>
                        <strong>{station?.name ? `${station.name} (${inc.stationCode})` : `${inc.email} (${inc.stationCode})`}</strong>
                      </div>
                      <span>{inc.details} • {inc.timestamp}</span>
                    </div>
                  );
                })
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

          <section>
            <p className="eyebrow">Participant Ingestion & Stations</p>
            <div className="room-info-card">
              <div><strong>Ingested Emails:</strong> {snapshot.ingestedEmails?.length ?? 0}</div>
              <div><strong>Active Workstations:</strong> {snapshot.stations.filter((s) => s.email).length}</div>
              <div><strong>Allotment Mode:</strong> Auto-allotted on Login</div>
            </div>
            <button
              type="button"
              className="button button-secondary"
              style={{ width: "100%", marginTop: "0.6rem" }}
              onClick={() => setShowIngestionModal(true)}
            >
              Manage Email Ingestion
            </button>
          </section>
        </aside>
      </section>

      <EmailIngestionModal
        token={session.token}
        isOpen={showIngestionModal}
        onClose={() => setShowIngestionModal(false)}
        stations={snapshot.stations}
      />

      {showFinalizeModal ? (
        <FinalizeResultsModal
          snapshot={snapshot}
          onFinalize={handleFinalizeContest}
          onExportCsv={handleExportCsv}
          onClose={() => setShowFinalizeModal(false)}
        />
      ) : null}
    </main>
  );
}

// ─── Email Ingestion & Participant Roster Modal ─────────────────────

function EmailIngestionModal({
  token,
  isOpen,
  onClose,
  stations
}: {
  token: string;
  isOpen: boolean;
  onClose: () => void;
  stations: StationSnapshot[];
}) {
  const [bulkText, setBulkText] = useState("");
  const [singleEmail, setSingleEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [histories, setHistories] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [activeTab, setActiveTab] = useState<"roster" | "ingest">("roster");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetchParticipants();
    fetch("/api/history/qualifiers", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => setHistories(data.histories ?? []))
      .catch(() => undefined);
  }, [isOpen, token]);

  async function fetchParticipants() {
    try {
      const res = await fetch("/api/participants", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setParticipants(data.participants ?? []);
    } catch {
      // ignore
    }
  }

  async function handleIngest(emailsToIngest: string[]) {
    if (emailsToIngest.length === 0) {
      setMessage({ text: "Please enter at least one valid email address.", type: "error" });
      return;
    }
    setIsSubmitting(true);
    setMessage(null);

    try {
      const res = await fetch("/api/participants/ingest", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ emails: emailsToIngest })
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          text: `Successfully ingested ${data.added} new email(s). Total registered: ${data.total}.`,
          type: "success"
        });
        setBulkText("");
        setSingleEmail("");
        fetchParticipants();
        setActiveTab("roster");
      } else {
        if (res.status === 401) {
          setMessage({
            text: "Host session expired or invalidated. Please refresh the page or re-login as Host to continue.",
            type: "error"
          });
          return;
        }
        setMessage({ text: data.message ?? "Failed to ingest emails", type: "error" });
      }
    } catch (err: any) {
      setMessage({ text: err.message ?? "Error ingesting emails", type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleBulkSubmit() {
    const emails = bulkText
      .split(/[\n,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0 && e.includes("@"));
    handleIngest(emails);
  }

  function handleSingleSubmit() {
    const email = singleEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setMessage({ text: "Please enter a valid email address.", type: "error" });
      return;
    }
    handleIngest([email]);
  }

  function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        setBulkText((prev) => (prev ? prev + "\n" + text : text));
      }
    };
    reader.readAsText(file);
  }

  async function handleRemoveEmail(email: string) {
    try {
      const res = await fetch(`/api/participants/${encodeURIComponent(email)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchParticipants();
      } else {
        const data = await res.json();
        alert(data.message ?? "Cannot remove participant");
      }
    } catch {
      // ignore
    }
  }

  async function handleLoadHistory(filename: string) {
    setIsSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/room/create-from-history", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ filename })
      });
      if (res.ok) {
        setMessage({ text: "Round 2 qualifiers loaded successfully into workstation roster.", type: "success" });
        fetchParticipants();
        setActiveTab("roster");
      } else {
        const err = await res.json();
        setMessage({ text: err.message ?? "Failed to load qualifiers from history", type: "error" });
      }
    } catch (err: any) {
      setMessage({ text: err.message ?? "Error loading qualifiers", type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) return null;

  const filteredList = participants.filter((p) =>
    p.email.toLowerCase().includes(filterQuery.toLowerCase()) ||
    (p.name && p.name.toLowerCase().includes(filterQuery.toLowerCase())) ||
    (p.stationCode && p.stationCode.toLowerCase().includes(filterQuery.toLowerCase()))
  );

  const joinedCount = participants.filter((p) => p.joined).length;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card ingestion-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Participant Ingestion Console</p>
            <h2>Workstation Roster & Email Whitelist</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="ingestion-nav-tabs">
          <button
            type="button"
            className={`ingestion-nav-tab ${activeTab === "roster" ? "active" : ""}`}
            onClick={() => setActiveTab("roster")}
          >
            📋 Ingested Whitelist & Roster ({participants.length})
          </button>
          <button
            type="button"
            className={`ingestion-nav-tab ${activeTab === "ingest" ? "active" : ""}`}
            onClick={() => setActiveTab("ingest")}
          >
            📥 Add / Bulk Ingest Emails
          </button>
        </div>

        <div className="modal-details">
          {message ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }} className={`ingest-msg ${message.type === "success" ? "success" : "form-error"}`}>
              <span>{message.text}</span>
              {activeTab === "ingest" && message.type === "success" ? (
                <button
                  type="button"
                  className="button button-secondary"
                  style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                  onClick={() => setActiveTab("roster")}
                >
                  View Roster ({participants.length}) →
                </button>
              ) : null}
            </div>
          ) : null}

          {activeTab === "roster" ? (
            <>
              {/* Summary counters */}
              <div className="ingest-stats-bar">
                <div className="ingest-stat">
                  <span>Ingested Whitelist</span>
                  <strong>{participants.length}</strong>
                </div>
                <div className="ingest-stat">
                  <span>Allotted Workstations</span>
                  <strong style={{ color: "var(--ready)" }}>{joinedCount}</strong>
                </div>
                <div className="ingest-stat">
                  <span>Awaiting Participant Login</span>
                  <strong style={{ color: "var(--steel)" }}>{Math.max(0, participants.length - joinedCount)}</strong>
                </div>
              </div>

              {/* Quick single email add bar */}
              <div className="quick-add-bar">
                <input
                  type="email"
                  placeholder="Quick add single email to whitelist (e.g. student@college.edu)..."
                  value={singleEmail}
                  onChange={(e) => setSingleEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSingleSubmit(); } }}
                />
                <button
                  type="button"
                  className="button button-secondary"
                  style={{ padding: "0.4rem 0.85rem", fontSize: "0.82rem" }}
                  onClick={handleSingleSubmit}
                  disabled={isSubmitting || !singleEmail.trim()}
                >
                  + Add
                </button>
              </div>

              {/* Roster table */}
              <div className="roster-section">
                <div className="roster-header">
                  <h3>Ingested Whitelist & Allotment ({filteredList.length})</h3>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <input
                      type="search"
                      className="roster-search"
                      placeholder="Filter by email, name, PC..."
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                    />
                    <button
                      type="button"
                      className="button button-primary"
                      style={{ fontSize: "0.82rem", padding: "0.4rem 0.85rem" }}
                      onClick={() => setActiveTab("ingest")}
                    >
                      📥 Bulk Ingest
                    </button>
                  </div>
                </div>

                <div className="roster-table-wrap">
                  {filteredList.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--steel)" }}>
                      <p style={{ margin: "0 0 1rem" }}>
                        {participants.length === 0
                          ? "No participant emails ingested yet."
                          : "No matching participants found for your search."}
                      </p>
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => setActiveTab("ingest")}
                      >
                        Ingest Participant Emails Now
                      </button>
                    </div>
                  ) : (
                    <table className="roster-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Email</th>
                          <th>Participant Name</th>
                          <th>Allotted PC</th>
                          <th>Contest Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredList.map((p, idx) => {
                          const st = stations.find((s) => s.email === p.email);
                          return (
                            <tr key={p.email}>
                              <td className="roster-idx">{idx + 1}</td>
                              <td className="roster-email">{p.email}</td>
                              <td className="roster-name">
                                {p.name || st?.name || <span className="muted-text">— Awaiting login —</span>}
                              </td>
                              <td className="roster-station">
                                {p.stationCode || st?.stationCode ? (
                                  <span className="station-code-badge">{p.stationCode || st?.stationCode}</span>
                                ) : (
                                  <span className="muted-text">Auto on login</span>
                                )}
                              </td>
                              <td>
                                {st ? (
                                  <span className={`status-pill ${st.status.toLowerCase()}`}>
                                    {statusLabels[st.status]}
                                  </span>
                                ) : p.joined ? (
                                  <span className="status-pill ready">Joined</span>
                                ) : (
                                  <span className="status-pill pending">Awaiting Login</span>
                                )}
                              </td>
                              <td>
                                {!p.joined ? (
                                  <button
                                    type="button"
                                    className="remove-email-btn"
                                    onClick={() => handleRemoveEmail(p.email)}
                                    title="Remove email from whitelist"
                                  >
                                    ✕
                                  </button>
                                ) : (
                                  <span className="locked-pill" title="Participant has logged in and has station assigned">Assigned</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Ingest Section */}
              <div className="ingest-input-section">
                <label className="section-sublabel">Bulk Ingest Participant Emails</label>
                <p className="hint" style={{ marginTop: "-0.2rem", marginBottom: "0.5rem" }}>
                  Enter participant emails (one per line, comma or space-separated), or import a file.
                </p>
                <textarea
                  className="email-textarea"
                  rows={5}
                  placeholder={"student1@college.edu\nstudent2@college.edu\nstudent3@college.edu"}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                />
                <div className="ingest-actions-row">
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={handleBulkSubmit}
                    disabled={isSubmitting || !bulkText.trim()}
                  >
                    {isSubmitting ? "Ingesting..." : "Ingest Emails"}
                  </button>

                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📁 Import File (.txt / .csv)
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.csv"
                    style={{ display: "none" }}
                    onChange={handleFileUpload}
                  />

                  {histories.length > 0 ? (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => setShowHistory(!showHistory)}
                    >
                      {showHistory ? "Hide History" : `📜 Qualifier History (${histories.length})`}
                    </button>
                  ) : null}
                </div>

                {showHistory && histories.length > 0 ? (
                  <div className="history-loader-box">
                    <p className="eyebrow" style={{ color: "var(--gold)" }}>Load Qualifiers from History (Round 2)</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.5rem" }}>
                      {histories.map((h: any) => (
                        <button
                          key={h.filename}
                          type="button"
                          className="button button-secondary"
                          style={{ textAlign: "left", justifyContent: "flex-start", fontSize: "0.85rem" }}
                          onClick={() => handleLoadHistory(h.filename)}
                          disabled={isSubmitting}
                        >
                          Load "{h.competitionName}" ({h.count} Qualifiers) — {new Date(h.timestamp).toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="single-email-inline">
                  <input
                    type="email"
                    placeholder="Or add single email: student@college.edu"
                    value={singleEmail}
                    onChange={(e) => setSingleEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSingleSubmit(); } }}
                  />
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={handleSingleSubmit}
                    disabled={isSubmitting || !singleEmail.trim()}
                  >
                    Add Email
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-actions">
          {activeTab === "ingest" && participants.length > 0 ? (
            <button type="button" className="button button-secondary" onClick={() => setActiveTab("roster")}>
              View Whitelist Roster ({participants.length})
            </button>
          ) : null}
          <button type="button" className="button button-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
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
  const isRoundActive = snapshot.status === "ROUND_1" || snapshot.status === "ROUND_2";
  const isCountdownActive = snapshot.status === "STARTING_ROUND_1" || snapshot.status === "STARTING_ROUND_2";
  const [submittedRounds, setSubmittedRounds] = useState<number[]>([]);
  const [showEndModal, setShowEndModal] = useState(false);

  // When station is set to TYPING by the server, ensure it's not marked as submitted
  useEffect(() => {
    if (currentStation?.status === "TYPING") {
      setSubmittedRounds((prev) => prev.filter((r) => r !== snapshot.round));
    }
  }, [currentStation?.status, snapshot.round]);

  // Check if participant is qualified for round 2
  const isQualifiedForRound = snapshot.round === 1 ||
    snapshot.qualifiers.length === 0 ||
    Boolean(session.user.email && snapshot.qualifiers.includes(session.user.email));

  const hasSubmittedThisRound =
    submittedRounds.includes(snapshot.round) ||
    (isRoundActive && currentStation?.status === "SUBMITTED");

  const isTypingActive = isRoundActive &&
    isQualifiedForRound &&
    !hasSubmittedThisRound &&
    currentStation?.status === "TYPING" &&
    Boolean(snapshot.activePassage);

  useEffect(() => {
    // Reset end modal when round transitions
    if (isCountdownActive || isRoundActive) {
      setShowEndModal(false);
    }
  }, [isCountdownActive, isRoundActive, snapshot.round]);

  return (
    <main className="participant-shell">
      <section className="participant-panel">
        <div>
          <p className="eyebrow">Participant Workstation Console</p>
          <h1>{session.user.name ? `${session.user.name} (${session.user.email})` : session.user.email} • {session.user.stationCode}</h1>
        </div>

        {!systemCheckPassed ? (
          <SystemCheck
            stationCode={session.user.stationCode ?? "PC-01"}
            email={session.user.name ?? session.user.email ?? "participant"}
            onPassed={() => setSystemCheckPassed(true)}
          />
        ) : (
          <>
            <div className="participant-status-grid">
              <Metric label="Station Status" valueText={isTypingActive ? "TYPING" : (currentStation?.status ?? "READY")} />
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
                key={`${snapshot.round}-${snapshot.activePassage.id}`}
                passage={snapshot.activePassage}
                token={session.token}
                remainingSeconds={snapshot.remainingSeconds}
                durationSeconds={snapshot.durationSeconds}
                onSubmitted={() => {
                  setSubmittedRounds((prev) => [...prev, snapshot.round]);
                  setShowEndModal(true);
                }}
              />
            ) : !isCountdownActive ? (
              <div className="waiting-card">
                {snapshot.status === "FINALIZED" ? (
                  <>
                    <strong style={{ color: "var(--crown)", fontSize: "1.1rem" }}>🏆 Contest Officially Finalized!</strong>
                    <span>
                      The competition has concluded and official results are frozen.
                      {currentStation?.status !== "DISQUALIFIED" && !snapshot.flaggedEmails?.includes(currentStation?.email ?? "") && currentStation?.score !== null && currentStation?.score !== undefined ? (
                        <> Your final Round 2 score: <strong>{currentStation.score} pts</strong> ({currentStation.wpm} WPM @ {currentStation.accuracy}% Accuracy).</>
                      ) : (
                        <span style={{ display: "block", marginTop: "0.5rem", color: "var(--danger)" }}>
                          {currentStation?.status === "DISQUALIFIED" || snapshot.flaggedEmails?.includes(currentStation?.email ?? "")
                            ? "Notice: You were disqualified due to an anti-cheat violation and are excluded from final standings."
                            : "You did not qualify for Round 2."}
                        </span>
                      )}
                    </span>
                  </>
                ) : hasSubmittedThisRound || (!isRoundActive && currentStation?.status === "SUBMITTED") ? (
                  <>
                    <strong>Attempt Submitted Successfully!</strong>
                    <span>Score recorded: <strong>{currentStation?.score ?? 0} pts</strong> ({currentStation?.wpm ?? 0} WPM @ {currentStation?.accuracy ?? 100}% Accuracy). Stand by for official Host results.</span>
                  </>
                ) : currentStation?.status === "DISQUALIFIED" || (!isQualifiedForRound && snapshot.round === 2) ? (
                  <>
                    <strong style={{ color: "var(--danger)" }}>Round 2 Qualification Notice</strong>
                    <span>
                      {currentStation?.status === "DISQUALIFIED"
                        ? "An anti-cheat or manual host violation occurred on this computer. Contact the Host if you require assistance."
                        : "You did not qualify for Round 2. Thank you for competing in Round 1!"}
                    </span>
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
    <article className={`station-tile ${station.status.toLowerCase()}`} onClick={onManage} title="Click to manage workstation">
      <div className="station-tile-info">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>{station.stationCode}</strong>
          {station.score ? <small style={{ color: "var(--crown)", fontSize: "0.75rem", fontWeight: "bold" }}>{station.score} pts</small> : null}
        </div>
        <span className="station-name" title={station.name ?? "Unassigned"}>
          {station.name || (station.email ? "Participant" : "Available PC")}
        </span>
        <span className="station-email" title={station.email ?? "Unassigned"}>{station.email ?? "Awaiting contestant"}</span>
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

// ─── Finalize Results Modal ─────────────────────────────────────────

function FinalizeResultsModal({
  snapshot,
  onFinalize,
  onExportCsv,
  onClose
}: {
  snapshot: ContestSnapshot;
  onFinalize: () => void;
  onExportCsv: () => void;
  onClose: () => void;
}) {
  // Round 2 finalists only: explicitly exclude any participant who was disqualified, flagged by anti-cheat, or failed to qualify
  const finalists = useMemo(() => {
    const flaggedSet = new Set(snapshot.flaggedEmails ?? []);
    return snapshot.stations
      .filter((s) => {
        if (!s.email) return false;
        if (s.status === "DISQUALIFIED" || flaggedSet.has(s.email)) return false;
        // If qualifiers were specified, contestant must be in qualifiers list and not disqualified
        if (snapshot.qualifiers && snapshot.qualifiers.length > 0) {
          return snapshot.qualifiers.includes(s.email);
        }
        return true;
      })
      .sort((a, b) => {
        if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
        if ((b.accuracy ?? 0) !== (a.accuracy ?? 0)) return (b.accuracy ?? 0) - (a.accuracy ?? 0);
        return (b.wpm ?? 0) - (a.wpm ?? 0);
      });
  }, [snapshot.stations, snapshot.qualifiers, snapshot.flaggedEmails]);

  const disqualifiedRound1Count = useMemo(() => {
    const flaggedSet = new Set(snapshot.flaggedEmails ?? []);
    return snapshot.stations.filter((s) => {
      if (!s.email) return false;
      if (s.status === "DISQUALIFIED" || flaggedSet.has(s.email)) return true;
      if (snapshot.qualifiers && snapshot.qualifiers.length > 0) {
        return !snapshot.qualifiers.includes(s.email);
      }
      return false;
    }).length;
  }, [snapshot.stations, snapshot.qualifiers, snapshot.flaggedEmails]);

  const isAlreadyFinalized = snapshot.status === "FINALIZED";
  const top1 = finalists[0];
  const top2 = finalists[1];
  const top3 = finalists[2];

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card wide-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>🏆 {isAlreadyFinalized ? "Official Final Standings" : "Finalize Competition Results"}</h2>
            <p className="eyebrow" style={{ margin: "0.2rem 0 0" }}>
              {isAlreadyFinalized ? "Official Round 2 results verified & frozen" : "Round 2 Official Results Review"}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>✕</button>
        </div>

        <div className="exclusion-notice-pill">
          <span>🛡️</span>
          <span>
            Disqualified & anti-cheat flagged participants ({disqualifiedRound1Count}) have been removed from these official results. Only eligible Round 2 finalists ({finalists.length}) are ranked.
          </span>
        </div>

        {finalists.length >= 1 && (
          <div className="podium-grid">
            {top2 ? (
              <div className="podium-card rank-2">
                <div className="podium-medal">🥈</div>
                <div className="podium-name">{top2.name || top2.email}</div>
                <div className="podium-meta">{top2.stationCode} • {top2.wpm ?? 0} WPM ({top2.accuracy ?? 0}%)</div>
                <div className="podium-score">{top2.score ?? 0} pts</div>
              </div>
            ) : (
              <div className="podium-card" style={{ opacity: 0.3 }}><div className="podium-meta">No Runner-up</div></div>
            )}

            {top1 ? (
              <div className="podium-card rank-1">
                <div className="podium-medal">🥇</div>
                <div className="podium-name">{top1.name || top1.email}</div>
                <div className="podium-meta">{top1.stationCode} • {top1.wpm ?? 0} WPM ({top1.accuracy ?? 0}%)</div>
                <div className="podium-score">{top1.score ?? 0} pts</div>
              </div>
            ) : null}

            {top3 ? (
              <div className="podium-card rank-3">
                <div className="podium-medal">🥉</div>
                <div className="podium-name">{top3.name || top3.email}</div>
                <div className="podium-meta">{top3.stationCode} • {top3.wpm ?? 0} WPM ({top3.accuracy ?? 0}%)</div>
                <div className="podium-score">{top3.score ?? 0} pts</div>
              </div>
            ) : (
              <div className="podium-card" style={{ opacity: 0.3 }}><div className="podium-meta">No 3rd Place</div></div>
            )}
          </div>
        )}

        <div className="results-table-wrap">
          <table className="results-table">
            <thead>
              <tr>
                <th style={{ width: "3.5rem" }}>Rank</th>
                <th>Participant</th>
                <th>Email</th>
                <th>PC Station</th>
                <th>WPM</th>
                <th>Accuracy</th>
                <th>Final Score</th>
              </tr>
            </thead>
            <tbody>
              {finalists.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "2rem", color: "var(--ash)" }}>
                    No eligible submissions recorded for Round 2.
                  </td>
                </tr>
              ) : (
                finalists.map((f, idx) => (
                  <tr key={f.stationCode}>
                    <td>
                      <span className="results-rank-badge">
                        {idx === 0 ? "🥇 #1" : idx === 1 ? "🥈 #2" : idx === 2 ? "🥉 #3" : `#${idx + 1}`}
                      </span>
                    </td>
                    <td><strong style={{ color: "#fff" }}>{f.name || "Participant"}</strong></td>
                    <td style={{ fontFamily: "monospace", color: "var(--steel)" }}>{f.email}</td>
                    <td><span className="station-code-badge">{f.stationCode}</span></td>
                    <td>{f.wpm ?? 0}</td>
                    <td>{f.accuracy ?? 0}%</td>
                    <td><span className="results-score-highlight">{f.score ?? 0} pts</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="modal-actions">
          {!isAlreadyFinalized ? (
            <button
              type="button"
              className="button button-primary"
              onClick={onFinalize}
            >
              🔒 Confirm & Freeze Final Results
            </button>
          ) : null}
          <button type="button" className="button button-secondary" onClick={onExportCsv}>
            📥 Export Official CSV
          </button>
          <button type="button" className="button button-secondary" onClick={onClose}>
            {isAlreadyFinalized ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
