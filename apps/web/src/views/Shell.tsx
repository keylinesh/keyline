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

interface Workspace {
  id: string;
  name: string;
}

const SECTIONS = [
  { name: "Projects", glyph: "⊞", lead: "Projects and environments in this workspace." },
  { name: "Members", glyph: "⊕", lead: "Who has access, and to what." },
  { name: "Audit", glyph: "≡", lead: "Every read, write, and denied attempt." },
  { name: "Settings", glyph: "⌘", lead: "Workspace and account settings." },
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
          {SECTIONS.map(({ name, glyph }) => (
            <a
              key={name}
              href={`#${name.toLowerCase()}`}
              className={section === name ? "active" : ""}
              onClick={() => setSection(name)}
            >
              <span className="glyph">{glyph}</span>
              {name}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="ws-name">{workspace ? workspace.name : "…"}</div>
          {session.role && <span className="role-pill">{session.role}</span>}
          <button className="btn" onClick={onSignOut}>
            Sign out
          </button>
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
          ) : (
            <div className="placeholder">
              {section === "Audit" && "The audit viewer lands with #42."}
              {section === "Settings" && "Settings and onboarding land with #43."}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
