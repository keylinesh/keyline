import { useCallback, useState } from "react";
import { clearSession, loadSession, saveSession, type WebSession } from "./session.js";
import { SignIn } from "./views/SignIn.js";
import { Shell } from "./views/Shell.js";

export function App() {
  const [session, setSession] = useState<WebSession | null>(() => loadSession());

  const handleSignedIn = useCallback((next: WebSession) => {
    saveSession(next);
    setSession(next);
  }, []);

  const handleSignOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  return session ? (
    <Shell session={session} onSignOut={handleSignOut} />
  ) : (
    <SignIn onSignedIn={handleSignedIn} />
  );
}
