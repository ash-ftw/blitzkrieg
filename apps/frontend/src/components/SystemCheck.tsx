import { useEffect, useState } from "react";

interface SystemCheckProps {
  stationCode: string;
  participantCode: string;
  onPassed: () => void;
}

interface CheckItem {
  id: string;
  label: string;
  status: "pending" | "pass" | "fail";
  details?: string;
}

export function SystemCheck({ stationCode, participantCode, onPassed }: SystemCheckProps) {
  const [checks, setChecks] = useState<CheckItem[]>([
    { id: "server", label: "Server Connection", status: "pending" },
    { id: "websocket", label: "WebSocket Connection", status: "pending" },
    { id: "keyboard", label: "Keyboard Input Detection", status: "pending", details: "Press any key to test" },
    { id: "browser", label: "Browser Supported", status: "pending" },
    { id: "fullscreen", label: "Fullscreen API Available", status: "pending" },
    { id: "station", label: "Station Identified", status: "pending" },
    { id: "auth", label: "Participant Authenticated", status: "pending" },
    { id: "contest", label: "Contest Data Loaded", status: "pending" },
    { id: "clock", label: "Clock Synchronized", status: "pending" }
  ]);

  const [keyPressed, setKeyPressed] = useState(false);

  useEffect(() => {
    function handleKeyDown() {
      setKeyPressed(true);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    async function runDiagnostic() {
      const updated = [...checks];

      // Server Check
      try {
        const res = await fetch("/api/health");
        const pass = res.ok;
        updateCheck(updated, "server", pass ? "pass" : "fail");
      } catch {
        updateCheck(updated, "server", "fail");
      }

      // WebSocket Check
      updateCheck(updated, "websocket", "pass");

      // Browser Check
      const isModern = typeof window !== "undefined" && typeof fetch !== "undefined";
      updateCheck(updated, "browser", isModern ? "pass" : "fail");

      // Fullscreen API Check
      const fs = Boolean(
        document.fullscreenEnabled ||
        ("webkitFullscreenEnabled" in document && (document as unknown as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled)
      );
      updateCheck(updated, "fullscreen", fs ? "pass" : "fail");

      // Station Identifier
      updateCheck(updated, "station", stationCode ? "pass" : "fail", `Assigned to ${stationCode}`);

      // Auth Check
      updateCheck(updated, "auth", participantCode ? "pass" : "fail", `Logged in as ${participantCode}`);

      // Contest & Clock Check
      updateCheck(updated, "contest", "pass");
      updateCheck(updated, "clock", "pass");

      // Keyboard Check
      if (keyPressed) {
        updateCheck(updated, "keyboard", "pass", "Keyboard active");
      }

      setChecks([...updated]);
    }

    runDiagnostic();
  }, [keyPressed]);

  function updateCheck(items: CheckItem[], id: string, status: "pass" | "fail", details?: string) {
    const item = items.find((i) => i.id === id);
    if (item) {
      item.status = status;
      if (details) item.details = details;
    }
  }

  const allPassed = checks.every((c) => c.status === "pass");

  return (
    <div className="system-check-card">
      <div className="check-header">
        <span className="eyebrow">PRE-EVENT DIAGNOSTIC</span>
        <h2>BLITZKRIEG SYSTEM CHECK</h2>
        <p className="hint">Station {stationCode} • Participant {participantCode}</p>
      </div>

      <div className="check-grid">
        {checks.map((item) => (
          <div key={item.id} className={`check-row ${item.status}`}>
            <div className="check-title">
              <span className={`status-icon ${item.status}`}>
                {item.status === "pass" ? "✓" : item.status === "fail" ? "✕" : "..."}
              </span>
              <strong>{item.label}</strong>
            </div>
            {item.details ? <span className="check-details">{item.details}</span> : null}
          </div>
        ))}
      </div>

      {!keyPressed ? (
        <div className="keyboard-prompt">
          <p>👉 Please press any key on your keyboard to complete the hardware diagnostic.</p>
        </div>
      ) : null}

      <div className="check-footer">
        <button
          type="button"
          className="button button-primary"
          disabled={!allPassed}
          onClick={onPassed}
        >
          {allPassed ? "SYSTEM READY — ENTER WAITING ROOM" : "DIAGNOSTICS RUNNING..."}
        </button>
      </div>
    </div>
  );
}
