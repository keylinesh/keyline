/**
 * Settings (#43) — account/profile, workspace, and the billing entry point.
 *
 * Profile: display name (PATCH /v1/members/:id, self). Workspace: rename
 * (admin). Billing: the current plan and where the upgrade will live once
 * M5 wires Paddle — an honest placeholder, not a dead button pretending.
 */

import { useCallback, useEffect, useState } from "react";
import { explainError, request } from "../api.js";
import { isAdmin, type WebSession } from "../session.js";
import { getWorkspace, renameWorkspace, type Workspace } from "../resources.js";
import { listMembers, type Member } from "../members.js";

export function Settings({ session }: { session: WebSession }) {
  const [self, setSelf] = useState<Member | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const admin = isAdmin(session);

  useEffect(() => {
    (async () => {
      try {
        const [members, ws] = await Promise.all([listMembers(session), getWorkspace(session)]);
        setWorkspace(ws);
        setSelf(members.find((m) => m.id === session.memberId) ?? null);
      } catch (err) {
        setError(explainError(err));
      }
    })();
  }, [session]);

  const act = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(explainError(err));
    }
  }, []);

  if (!self && !workspace && !error) {
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
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="res-card">
        <h3 className="card-title">Account</h3>
        {self ? (
          <>
            <div className="kv">
              <span className="k">email</span>
              <span>{self.email}</span>
            </div>
            <div className="kv">
              <span className="k">role</span>
              <span className={`status-pill ${self.role}`}>{self.role}</span>
            </div>
            <div className="kv">
              <span className="k">display name</span>
              <DisplayNameEditor
                current={self.displayName}
                onSave={(name) =>
                  act(async () => {
                    const updated = await request<Member>("PATCH", `/v1/members/${self.id}`, {
                      token: session.token,
                      body: { displayName: name },
                    });
                    setSelf(updated);
                    setNotice("Saved.");
                  })
                }
              />
            </div>
          </>
        ) : (
          <p className="hint">Sign out and back in to manage your profile (older session).</p>
        )}
      </div>

      <div className="res-card">
        <h3 className="card-title">Workspace</h3>
        <div className="kv">
          <span className="k">name</span>
          {admin && workspace ? (
            <WorkspaceRename
              current={workspace.name}
              onSave={(name) =>
                act(async () => {
                  setWorkspace(await renameWorkspace(session, name));
                  setNotice("Workspace renamed.");
                })
              }
            />
          ) : (
            <span>{workspace?.name ?? "…"}</span>
          )}
        </div>
        <div className="kv">
          <span className="k">id</span>
          <span className="mono faint">{session.workspaceId}</span>
        </div>
      </div>

      <div className="res-card">
        <h3 className="card-title">Billing</h3>
        <div className="kv">
          <span className="k">plan</span>
          <span>
            <span className="status-pill active">Solo · $0</span>
          </span>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Team is $19 flat for up to 10 members: unlimited environments, per-environment access,
          full audit history. Upgrading arrives with billing (M5) — this is where it will live.
        </p>
      </div>
    </div>
  );
}

function DisplayNameEditor({ current, onSave }: { current: string | null; onSave: (name: string) => void }) {
  const [name, setName] = useState(current ?? "");
  return (
    <form
      className="inline-create small"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name.trim());
      }}
    >
      <input value={name} aria-label="display name" placeholder="your name" onChange={(e) => setName(e.target.value)} />
      <button className="btn" type="submit">
        save
      </button>
    </form>
  );
}

function WorkspaceRename({ current, onSave }: { current: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(current);
  return (
    <form
      className="inline-create small"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && name.trim() !== current) onSave(name.trim());
      }}
    >
      <input value={name} aria-label="workspace name" onChange={(e) => setName(e.target.value)} />
      <button className="btn" type="submit">
        rename
      </button>
    </form>
  );
}
