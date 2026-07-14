/**
 * Sign-in (ADR-0003): show a one-time code, wait for `keyline web <code>`.
 */

import { useEffect, useRef, useState } from "react";
import { startSignIn, waitForApproval, type StartResponse, type WebSession } from "../session.js";

export function SignIn({ onSignedIn }: { onSignedIn: (session: WebSession) => void }) {
  const [start, setStart] = useState<StartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    setError(null);
    setStart(null);

    (async () => {
      try {
        const started = await startSignIn();
        if (!active.current) return;
        setStart(started);
        const session = await waitForApproval(started.sessionId);
        if (!active.current) return;
        if (session) onSignedIn(session);
        else setError("That code expired. Get a fresh one.");
      } catch {
        if (active.current) setError("Can't reach the keyline API. Try again in a moment.");
      }
    })();

    return () => {
      active.current = false;
    };
  }, [attempt, onSignedIn]);

  return (
    <div className="center-page">
      <div className="card">
        <div className="brand" style={{ marginBottom: 18 }}>
          <span className="mk">k_</span> Keyline
        </div>
        <h1>Sign in</h1>
        <p className="sub">
          The dashboard signs in through the CLI. No passwords. In your terminal, run:
        </p>
        <div className="code-box">
          <span className="pr">$</span> keyline web <b>{start ? start.code : "····-····"}</b>
        </div>
        <p className="hint">
          This approves the browser from a device you already trust. The dashboard shows metadata
          only. Secret values stay in the CLI.
        </p>
        <details className="signin-help">
          <summary>Command not found?</summary>
          <p className="hint">Install the CLI, create your account, then run the command above:</p>
          <div className="code-box small">
            <span className="pr">$</span> npm i -g @keylinesh/cli
          </div>
          <div className="code-box small">
            <span className="pr">$</span> keyline login
          </div>
          <p className="hint">
            Login is two questions on first run. Codes expire after 10 minutes. Refresh the page
            for a fresh one.
          </p>
        </details>
        {error ? (
          <>
            <p className="error">{error}</p>
            <button className="btn" onClick={() => setAttempt((n) => n + 1)}>
              Get a new code
            </button>
          </>
        ) : (
          <p className="waiting">
            waiting for approval <span className="dot">●</span>
          </p>
        )}
      </div>
      <nav className="legal-links" aria-label="Legal">
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/refunds">Refunds</a>
      </nav>
    </div>
  );
}
