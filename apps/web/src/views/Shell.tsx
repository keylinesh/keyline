/**
 * Authenticated shell: top bar with the workspace name and the section nav.
 * The sections themselves land in #40 (resources), #41 (members), #42 (audit),
 * #43 (settings) — this is the #39 skeleton they plug into.
 */

import { useEffect, useState } from "react";
import { ApiError, request } from "../api.js";
import type { WebSession } from "../session.js";
import { Projects } from "./Projects.js";

interface Workspace {
  id: string;
  name: string;
}

const SECTIONS = ["Projects", "Members", "Audit", "Settings"] as const;

export function Shell({ session, onSignOut }: { session: WebSession; onSignOut: () => void }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<(typeof SECTIONS)[number]>("Projects");

  useEffect(() => {
    request<Workspace>("GET", `/v1/workspaces/${session.workspaceId}`, { token: session.token })
      .then(setWorkspace)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) onSignOut(); // token expired
        else setError("Couldn't load the workspace.");
      });
  }, [session, onSignOut]);

  return (
    <div>
      <header className="topbar">
        <span className="brand">
          <span className="mk">k_</span> Keyline
        </span>
        <nav>
          {SECTIONS.map((name) => (
            <a
              key={name}
              href={`#${name.toLowerCase()}`}
              className={section === name ? "active" : ""}
              onClick={(e) => {
                e.preventDefault();
                setSection(name);
              }}
            >
              {name}
            </a>
          ))}
        </nav>
        <div>
          <span className="ws">{workspace ? workspace.name : "…"}</span>
          <button className="btn" style={{ marginTop: 0 }} onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="main">
        <h2>{section}</h2>
        <p className="lead">
          {section === "Projects" && "Projects and environments in this workspace."}
          {section === "Members" && "Who has access, and to what."}
          {section === "Audit" && "Every read, write, and denied attempt."}
          {section === "Settings" && "Workspace and account settings."}
        </p>
        {error ? (
          <p className="error">{error}</p>
        ) : section === "Projects" ? (
          <Projects session={session} />
        ) : (
          <div className="placeholder">
            {section === "Members" && "Member management lands with #41."}
            {section === "Audit" && "The audit viewer lands with #42."}
            {section === "Settings" && "Settings and onboarding land with #43."}
          </div>
        )}
      </main>
    </div>
  );
}
