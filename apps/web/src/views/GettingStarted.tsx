/**
 * Guided onboarding (#43) — shown on the Projects section while the workspace
 * is empty. Step one is already done by construction: signing in to the
 * dashboard requires the CLI (ADR-0003).
 */

import { useEffect, useState } from "react";
import type { WebSession } from "../session.js";
import { listMembers } from "../members.js";
import { CopyButton } from "./CopyButton.js";

export function GettingStarted({ session }: { session: WebSession }) {
  const [teamDone, setTeamDone] = useState(false);

  useEffect(() => {
    listMembers(session)
      .then((members) => setTeamDone(members.length > 1))
      .catch(() => {});
  }, [session]);

  return (
    <div className="res-card onboarding">
      <h3 className="card-title">Get started</h3>
      <ol className="steps-list">
        <Step done label="Install the CLI and sign in" hint="done — that's how you got here" />
        <Step
          done={false}
          label="Link a project"
          command="cd your-app && keyline link"
          hint="binds the folder; the project shows up here"
        />
        <Step done={false} label="Push your first .env" command="keyline push" hint="encrypted on your machine before upload" />
        <Step
          done={teamDone}
          label="Invite your team"
          command="keyline members invite dev@yourco.com"
          hint="or use the Members tab"
        />
      </ol>
      <p className="hint" style={{ marginTop: 16 }}>
        Prefer a human? <a className="founder-link" href="mailto:support@keyline.sh?subject=Founder%20onboarding%20%2815%20min%29&body=Hi%20Resi%2C%0A%0AI%27d%20like%20the%2015-minute%20setup%20call%20for%20my%20team.%0A%0ATeam%20size%3A%0AStack%3A%0AA%20few%20time%20slots%20that%20work%20for%20me%3A%0A">Book 15 minutes with the founder</a> and
        I&apos;ll set it up with your team, live.
      </p>
    </div>
  );
}

function Step({ done, label, command, hint }: { done: boolean; label: string; command?: string; hint?: string }) {
  return (
    <li className={done ? "step-item done" : "step-item"}>
      <span className="tick" aria-hidden>
        {done ? "✓" : "○"}
      </span>
      <div>
        <b>{label}</b>
        {command && (
          <span className="cmd-row">
            <code className="cmd">$ {command}</code>
            <CopyButton text={command} />
          </span>
        )}
        {hint && <span className="hint step-hint">{hint}</span>}
      </div>
    </li>
  );
}
