/**
 * Authenticated shell: sidebar (brand, section nav, workspace + role + sign
 * out) and the page area. Sections plug in per issue: #40 projects, #41
 * members, #42 audit, #43 settings.
 */

import { useEffect, useState } from "react";
import { ApiError, request } from "../api.js";
import type { WebSession } from "../session.js";
import { Projects } from "./Projects.js";
import { Members } from "./Members.js";
import { Audit } from "./Audit.js";
import { Settings } from "./Settings.js";
import { ThemeToggle } from "./ThemeToggle.js";

interface Workspace {
  id: string;
  name: string;
}

const ICONS = {
  Projects: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </svg>
  ),
  Members: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20c.8-3.4 3.3-5 6.2-5s5.4 1.6 6.2 5" />
      <path d="M16 5.4a3.4 3.4 0 0 1 0 5.9M18.4 15.3c1.6.7 2.6 2.1 3 4.2" />
    </svg>
  ),
  Audit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16M4 12h16M4 19h10" />
      <circle cx="19" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  Settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
    </svg>
  ),
} as const;

const SECTIONS = [
  { name: "Projects", lead: "Projects and environments in this workspace." },
  { name: "Members", lead: "Who has access, and to what." },
  { name: "Audit", lead: "Every read, write, and denied attempt." },
  { name: "Settings", lead: "Workspace and account settings." },
] as const;

type SectionName = (typeof SECTIONS)[number]["name"];

/** Sections deep-link via the hash: /app/#members opens Members. */
function sectionFromHash(): SectionName {
  const hash = window.location.hash.slice(1).toLowerCase();
  return SECTIONS.find((s) => s.name.toLowerCase() === hash)?.name ?? "Projects";
}

export function Shell({ session, onSignOut }: { session: WebSession; onSignOut: () => void }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionName>(sectionFromHash);

  useEffect(() => {
    request<Workspace>("GET", `/v1/workspaces/${session.workspaceId}`, { token: session.token })
      .then(setWorkspace)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) onSignOut(); // token expired
        else setError("Couldn't load the workspace.");
      });
  }, [session, onSignOut]);

  useEffect(() => {
    document.title = `${section} · Keyline`;
  }, [section]);

  const active = SECTIONS.find((s) => s.name === section)!;

  return (
    <div className="layout">
      <aside className="sidebar">
        <span className="brand">
          <span className="mk">k_</span> Keyline
        </span>
        <nav className="side-nav">
          {SECTIONS.map(({ name }) => (
            <a
              key={name}
              href={`#${name.toLowerCase()}`}
              className={section === name ? "active" : ""}
              onClick={() => setSection(name)}
            >
              <span className="glyph">{ICONS[name]}</span>
              <span className="nav-label">{name}</span>
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="ws-name">{workspace ? workspace.name : "…"}</div>
          {session.role && <span className="role-pill">{session.role}</span>}
          <div className="side-foot-row">
            <button className="btn" onClick={onSignOut}>
              Sign out
            </button>
            <ThemeToggle />
          </div>
          <nav className="legal-links" aria-label="Legal">
            <a href="/security">Security</a>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            <a href="/refunds">Refunds</a>
          </nav>
        </div>
      </aside>
      <div className="content">
        <main className="page">
          <div className="page-head">
            <div>
              <h2>{active.name}</h2>
              <p className="lead">{active.lead}</p>
            </div>
          </div>
          {error ? (
            <p className="error">{error}</p>
          ) : section === "Projects" ? (
            <Projects session={session} />
          ) : section === "Members" ? (
            <Members session={session} />
          ) : section === "Audit" ? (
            <Audit session={session} />
          ) : (
            <Settings session={session} />
          )}
        </main>
      </div>
    </div>
  );
}
