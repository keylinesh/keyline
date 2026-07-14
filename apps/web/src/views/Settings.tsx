/**
 * Settings (#43, #71) — account/profile, workspace, and billing.
 *
 * Profile: display name (PATCH /v1/members/:id, self). Workspace: rename
 * (admin). Billing: current plan + upgrade to Team via Paddle's overlay
 * checkout; the webhook (#73) flips the plan, and we poll the workspace
 * until it lands.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { explainError, request } from "../api.js";
import { isAdmin, type WebSession } from "../session.js";
import { getWorkspace, renameWorkspace, type Workspace } from "../resources.js";
import { listMembers, type Member } from "../members.js";
import { ensurePaddle, getBillingConfig, openTeamCheckout, type BillingConfig } from "../billing.js";

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

      {workspace && (
        <BillingCard
          session={session}
          workspace={workspace}
          email={self?.email ?? null}
          admin={admin}
          onPlanChange={setWorkspace}
        />
      )}
    </div>
  );
}

function BillingCard({
  session,
  workspace,
  email,
  admin,
  onPlanChange,
}: {
  session: WebSession;
  workspace: Workspace;
  email: string | null;
  admin: boolean;
  onPlanChange: (ws: Workspace) => void;
}) {
  const [config, setConfig] = useState<BillingConfig | null | "unavailable">(null);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (workspace.plan === "solo" && admin) {
      getBillingConfig(session)
        .then((c) => alive.current && setConfig(c))
        .catch(() => alive.current && setConfig("unavailable"));
    }
    return () => {
      alive.current = false;
    };
  }, [session, workspace.plan, admin]);

  // After Paddle reports checkout.completed, the webhook flips the plan
  // server-side. Poll until it lands (usually seconds).
  const awaitUpgrade = useCallback(async () => {
    setActivating(true);
    for (let i = 0; i < 30 && alive.current; i++) {
      try {
        const ws = await getWorkspace(session);
        if (ws.plan === "team") {
          if (alive.current) {
            onPlanChange(ws);
            setActivating(false);
          }
          return;
        }
      } catch {
        // transient; keep polling
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (alive.current) {
      setActivating(false);
      setError("Payment received, still activating. Refresh in a minute.");
    }
  }, [session, onPlanChange]);

  const upgrade = useCallback(async () => {
    if (config === null || config === "unavailable") return;
    setError(null);
    try {
      const paddle = await ensurePaddle(config, (name) => {
        if (name === "checkout.completed") void awaitUpgrade();
      });
      openTeamCheckout(paddle, config, { workspaceId: session.workspaceId, email });
    } catch (err) {
      setError(explainError(err));
    }
  }, [config, session.workspaceId, email, awaitUpgrade]);

  const team = workspace.plan === "team";
  return (
    <div className="res-card">
      <h3 className="card-title">Billing</h3>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="kv">
        <span className="k">plan</span>
        <span>
          <span className="status-pill active">{team ? "Team · $19/mo" : "Solo · $0"}</span>
        </span>
      </div>
      {team ? (
        <p className="hint" style={{ marginTop: 10 }}>
          Up to 10 members, unlimited environments, full audit history. Cancel and card changes
          arrive with the customer portal.
        </p>
      ) : activating ? (
        <p className="notice" role="status" style={{ marginTop: 10 }}>
          Payment received. Activating your Team plan…
        </p>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 10 }}>
            Team is $19 flat for up to 10 members: unlimited environments, per-environment access,
            full audit history. 14-day free trial.
          </p>
          {admin ? (
            config === "unavailable" ? (
              <p className="hint">Billing isn't configured in this environment.</p>
            ) : (
              <button className="btn primary" style={{ marginTop: 10 }} disabled={config === null} onClick={() => void upgrade()}>
                Upgrade to Team
              </button>
            )
          ) : (
            <p className="hint">Ask an owner or admin to upgrade.</p>
          )}
        </>
      )}
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
