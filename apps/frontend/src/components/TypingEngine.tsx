import { useEffect, useRef, useState } from "react";
import type { Passage, ViolationType } from "@blitzkrieg/shared";

interface TypingEngineProps {
  passage: Passage;
  token: string;
  remainingSeconds: number;
  durationSeconds: number;
  onSubmitted: () => void;
}

export function TypingEngine({ passage, token, remainingSeconds, durationSeconds, onSubmitted }: TypingEngineProps) {
  const [typedText, setTypedText] = useState("");
  const [startTime, setStartTime] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [localSeconds, setLocalSeconds] = useState(remainingSeconds);
  const [violationAlert, setViolationAlert] = useState<string | null>(null);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const typedTextRef = useRef(typedText);
  const startTimeRef = useRef(startTime);
  const isSubmittedRef = useRef(isSubmitted);
  const isSubmittingRef = useRef(isSubmitting);

  useEffect(() => {
    typedTextRef.current = typedText;
  }, [typedText]);

  useEffect(() => {
    startTimeRef.current = startTime;
  }, [startTime]);

  useEffect(() => {
    isSubmittedRef.current = isSubmitted;
  }, [isSubmitted]);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  // Guaranteed submission on unmount (when timer ends and backend unmounts this component)
  useEffect(() => {
    return () => {
      if (!isSubmittedRef.current && !isSubmittingRef.current && typedTextRef.current.length > 0) {
        const elapsedMs = startTimeRef.current ? Date.now() - startTimeRef.current : durationSeconds * 1000;
        fetch("/api/contest/submit", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            typedText: typedTextRef.current,
            durationMs: elapsedMs
          }),
          keepalive: true
        }).catch(() => undefined);
      }
    };
  }, [token, durationSeconds]);

  const targetText = passage.content;

  // Keep input focused automatically
  useEffect(() => {
    inputRef.current?.focus();
    const interval = setInterval(() => {
      if (!isSubmitted && !isSubmitting) {
        inputRef.current?.focus();
      }
    }, 800);
    return () => clearInterval(interval);
  }, [isSubmitted, isSubmitting]);

  // Sync remaining seconds from props
  useEffect(() => {
    setLocalSeconds(remainingSeconds);
  }, [remainingSeconds]);

  // Smooth local 1-second countdown ticker
  useEffect(() => {
    if (localSeconds <= 0) {
      if (!isSubmitted && !isSubmitting && typedText.length > 0) {
        submitAttempt();
      }
      return;
    }

    const ticker = setInterval(() => {
      setLocalSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(ticker);
  }, [localSeconds, isSubmitted, isSubmitting, typedText.length]);

  function logViolation(type: ViolationType, details: string) {
    setViolationAlert(`🚨 Anti-Cheat Flag: ${details}`);
    fetch("/api/contest/violation", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ type, details })
    }).catch(() => undefined);
  }

  // Anti-cheat window blur & visibility detection
  // Disabled temporarily per host request
  /*
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden) {
        logViolation("TAB_SWITCH", "Participant switched tab or minimized window");
      }
    }

    function handleBlur() {
      logViolation("WINDOW_BLUR", "Participant unfocused typing window");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
    };
  }, [token]);
  */

  async function submitAttempt() {
    if (isSubmitting || isSubmitted) return;
    setIsSubmitting(true);

    const elapsedMs = startTime ? Date.now() - startTime : durationSeconds * 1000;

    try {
      await fetch("/api/contest/submit", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          typedText,
          durationMs: elapsedMs
        })
      });
      setIsSubmitted(true);
      onSubmitted();
    } catch (err) {
      console.error("Submission failed", err);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleInputChange(text: string) {
    if (isSubmitted || isSubmitting) return;

    if (!startTime) {
      setStartTime(Date.now());
    }

    // Block paste or sudden bulk inserts > 3 characters at once
    if (text.length - typedText.length > 3) {
      logViolation("PASTE", "Bulk paste or macro input detected");
      return;
    }

    setTypedText(text);

    // Auto submit if typed complete passage
    if (text.length >= targetText.length) {
      submitAttempt();
    }
  }

  function handleClipboardAction(actionType: ViolationType, details: string, e: React.SyntheticEvent) {
    e.preventDefault();
    logViolation(actionType, details);
  }

  // Calculate live stats
  let correctCount = 0;
  let errorCount = 0;
  for (let i = 0; i < typedText.length; i++) {
    if (i < targetText.length && typedText[i] === targetText[i]) {
      correctCount++;
    } else {
      errorCount++;
    }
  }

  const elapsedMinutes = startTime ? Math.max((Date.now() - startTime) / 1000 / 60, 0.05) : 0.05;
  const liveWpm = Math.round((typedText.length / 5) / elapsedMinutes);
  const liveAccuracy = typedText.length > 0 ? ((correctCount / typedText.length) * 100).toFixed(1) : "100.0";
  const progressPercent = Math.min(100, Math.round((typedText.length / targetText.length) * 100));

  if (isSubmitted) {
    return (
      <div className="waiting-card">
        <strong>Attempt Submitted Successfully!</strong>
        <span>Recorded Performance: <strong>{liveWpm} WPM</strong> @ <strong>{liveAccuracy}% Accuracy</strong> ({errorCount} Errors). Stand by for official Host results.</span>
      </div>
    );
  }

  return (
    <div className="typing-engine-card">
      {violationAlert ? (
        <div className="anti-cheat-alert" style={{ background: "rgba(224, 60, 60, 0.2)", border: "1px solid var(--danger)", color: "#ff8888", padding: "0.6rem 1rem", borderRadius: "6px", fontSize: "0.85rem", fontWeight: "bold" }}>
          {violationAlert}
        </div>
      ) : null}

      <div className="passage-header">
        <div>
          <span className="eyebrow">{passage.difficulty} PASSAGE</span>
          <h2>
            {passage.title}
            {capsLockOn ? (
              <span style={{ marginLeft: "1rem", fontSize: "0.85rem", color: "var(--warning)", background: "rgba(245, 158, 11, 0.2)", padding: "0.2rem 0.5rem", borderRadius: "4px", verticalAlign: "middle" }}>
                ⚠️ Caps Lock ON
              </span>
            ) : null}
          </h2>
        </div>
        <div className="live-metrics">
          <div className="stat">
            <span>TIMER</span>
            <strong>{String(Math.floor(localSeconds / 60)).padStart(2, "0")}:{String(localSeconds % 60).padStart(2, "0")}</strong>
          </div>
          <div className="stat">
            <span>SPEED</span>
            <strong>{liveWpm} <small>WPM</small></strong>
          </div>
          <div className="stat">
            <span>ACCURACY</span>
            <strong>{liveAccuracy}%</strong>
          </div>
          <div className="stat">
            <span>ERRORS</span>
            <strong className={errorCount > 0 ? "error-text" : ""}>{errorCount}</strong>
          </div>
        </div>
      </div>

      <div className="progress-bar-container">
        <div className="progress-bar" style={{ width: `${progressPercent}%` }} />
      </div>

      {/* Interactive Display Passage */}
      <div
        className="passage-display"
        onClick={() => inputRef.current?.focus()}
        onCopy={(e) => handleClipboardAction("COPY", "Copy shortcut attempted", e)}
        onPaste={(e) => handleClipboardAction("PASTE", "Paste shortcut attempted", e)}
        onCut={(e) => handleClipboardAction("PASTE", "Cut shortcut attempted", e)}
        onContextMenu={(e) => handleClipboardAction("PASTE", "Right-click context menu attempted", e)}
      >
        {targetText.split("").map((char, index) => {
          let charClass = "char-pending";
          if (index < typedText.length) {
            charClass = typedText[index] === char ? "char-correct" : "char-incorrect";
          }
          const isCursor = index === typedText.length;

          return (
            <span key={index} className={`char ${charClass} ${isCursor ? "char-cursor" : ""}`}>
              {char}
            </span>
          );
        })}
      </div>

      {/* Hidden input element capturing full key events */}
      <input
        ref={inputRef}
        type="text"
        className="hidden-typing-input"
        value={typedText}
        onChange={(e) => handleInputChange(e.target.value)}
        onKeyDown={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
        onKeyUp={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
        onCopy={(e) => handleClipboardAction("COPY", "Copy shortcut attempted", e)}
        onPaste={(e) => handleClipboardAction("PASTE", "Paste shortcut attempted", e)}
        onCut={(e) => handleClipboardAction("PASTE", "Cut shortcut attempted", e)}
        onContextMenu={(e) => handleClipboardAction("PASTE", "Right-click context menu attempted", e)}
        disabled={isSubmitting || localSeconds <= 0}
        autoFocus
      />

      <div className="typing-footer">
        <p className="hint">Keep typing. Backspace is enabled. Do not switch tabs or windows.</p>
        <button
          type="button"
          className="button button-primary"
          onClick={submitAttempt}
          disabled={isSubmitting || typedText.length === 0}
        >
          {isSubmitting ? "Submitting..." : "Submit Attempt"}
        </button>
      </div>
    </div>
  );
}
