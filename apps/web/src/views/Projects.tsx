/**
 * Projects & environments (#40) — the resource hierarchy, metadata only.
 * Admins create/rename/delete; members see a read-only view. API authorization
 * is the source of truth: any 403 that slips through surfaces as a banner.
 */

import { useCallback, useEffect, useState } from "react";
import { explainError } from "../api.js";
import { isAdmin, type WebSession } from "../session.js";
import { CopyButton } from "./CopyButton.js";
import { GettingStarted } from "./GettingStarted.js";
import {
  createEnvironment,
  createProject,
  deleteEnvironment,
  deleteProject,
  listEnvironments,
  listProjects,
  renameProject,
  type Environment,
  type Project,
} from "../resources.js";

interface ProjectRow extends Project {
  environments: Environment[];
}

const explain = explainError;

export function Projects({ session }: { session: WebSession }) {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const admin = isAdmin(session);

  const reload = useCallback(async () => {
    try {
      const projects = await listProjects(session);
      const withEnvs = await Promise.all(
        projects.map(async (p) => ({ ...p, environments: await listEnvironments(session, p.id) })),
      );
      setRows(withEnvs);
    } catch (err) {
      setError(explain(err));
    }
  }, [session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
        await reload();
      } catch (err) {
        setError(explain(err));
      }
    },
    [reload],
  );

  if (rows === null && !error) {
    return (
      <div aria-hidden>
        <div className="skel" />
        <div className="skel" />
      </div>
    );
  }

  return (
    <div>
      {error && <p className="error" role="alert">{error}</p>}
      {admin && (
        <div style={{ marginBottom: 20 }}>
          <InlineCreate
            placeholder="new project name"
            label="New project"
            onCreate={(name) => act(() => createProject(session, name))}
          />
        </div>
      )}
      {rows && rows.length === 0 && (admin ? (
        <GettingStarted session={session} />
      ) : (
        <div className="placeholder">No projects yet. Ask an admin to create one.</div>
      ))}
      {rows?.map((project) => (
        <div className="res-card" key={project.id}>
          <div className="res-head">
            <div>
              <b>{project.name}</b> <span className="mono slug">{project.slug}</span>{" "}
              <CopyButton text={`keyline link ${project.slug}`} label={`copy link command for ${project.slug}`} />
            </div>
            {admin && (
              <div className="res-actions">
                <button
                  className="mini"
                  onClick={() => {
                    const name = window.prompt("Rename project", project.name);
                    if (name?.trim()) void act(() => renameProject(session, project.id, name));
                  }}
                >
                  rename
                </button>
                <button
                  className="mini danger"
                  data-tip="Deletes the project, its environments, and pushed ciphertext."
                  onClick={() => {
                    if (window.confirm(`Delete project "${project.name}" and its environments? Pushed ciphertext is deleted too.`)) {
                      void act(() => deleteProject(session, project.id));
                    }
                  }}
                >
                  delete
                </button>
              </div>
            )}
          </div>
          <div className="env-row">
            {project.environments.map((env) => (
              <span className="env-chip" key={env.id}>
                {env.name}
                {admin && (
                  <button
                    className="chip-x"
                    data-tip="Deletes this environment and its secrets"
                    aria-label={`delete environment ${env.name}`}
                    onClick={() => {
                      if (window.confirm(`Delete environment "${env.name}" of ${project.name}?`)) {
                        void act(() => deleteEnvironment(session, env.id));
                      }
                    }}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {admin && (
              <InlineCreate
                small
                placeholder="env name"
                label="+ env"
                onCreate={(name) => act(() => createEnvironment(session, project.id, name))}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function InlineCreate({
  label,
  placeholder,
  onCreate,
  small,
}: {
  label: string;
  placeholder: string;
  onCreate: (name: string) => void;
  small?: boolean;
}) {
  const [name, setName] = useState("");
  return (
    <form
      className={small ? "inline-create small" : "inline-create"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onCreate(name);
        setName("");
      }}
    >
      <input
        value={name}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setName(e.target.value)}
      />
      <button className={small ? "btn" : "btn primary"} type="submit">
        {label}
      </button>
    </form>
  );
}
