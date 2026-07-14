/**
 * Members (#41) — invite, scope per environment, revoke in one click.
 *
 * Status comes from the member's devices: invited (none yet), active, or
 * revoked. Granting here sets the environment ROLE; the wrapped workspace KEY
 * can only be issued from a CLI that holds it (`keyline members grant`), so
 * active members without a key get an honest hint instead of silent breakage.
 */

import { useCallback, useEffect, useState } from "react";
import { explainError } from "../api.js";
import { isAdmin, type WebSession } from "../session.js";
import { CopyButton } from "./CopyButton.js";
import {
  envCatalog,
  grantAccess,
  grantsByMember,
  hasKey,
  invite,
  regenerateJoinCode,
  listMembers,
  memberDevices,
  revokeAccess,
  revokeMember,
  statusOf,
  type EnvOption,
  type Grant,
  type Member,
  type MemberStatus,
} from "../members.js";

interface MemberRow extends Member {
  status?: MemberStatus;
  keyed?: boolean;
  grants: Grant[];
}

export function Members({ session }: { session: WebSession }) {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [envs, setEnvs] = useState<EnvOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState<{ email: string; code: string } | null>(null);
  const admin = isAdmin(session);

  const reload = useCallback(async () => {
    try {
      const members = await listMembers(session);
      if (!admin) {
        setRows(members.map((m) => ({ ...m, grants: [] })));
        return;
      }
      const catalog = await envCatalog(session);
      setEnvs(catalog);
      const [grants, devices] = await Promise.all([
        grantsByMember(session, catalog),
        Promise.all(members.map((m) => memberDevices(session, m.id))),
      ]);
      setRows(
        members.map((m, i) => ({
          ...m,
          status: statusOf(devices[i]!),
          keyed: hasKey(devices[i]!),
          grants: grants.get(m.id) ?? [],
        })),
      );
    } catch (err) {
      setError(explainError(err));
    }
  }, [session, admin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      setNotice(null);
      try {
        await fn();
        await reload();
      } catch (err) {
        setError(explainError(err));
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
      {notice && <p className="notice" role="status">{notice}</p>}
      {admin && (
        <InviteForm
          onInvite={(email, role) =>
            act(async () => {
              const invited = await invite(session, email, role);
              setJoinCode({ email: invited.email, code: invited.joinCode });
            })
          }
        />
      )}
      {joinCode && (
        <p className="notice" role="status">
          Send {joinCode.email} this one-time command (valid 7 days):{" "}
          <code className="mono">keyline join {joinCode.code}</code>{" "}
          <CopyButton text={`keyline join ${joinCode.code}`} label={`copy join command for ${joinCode.email}`} />
        </p>
      )}
      {rows?.map((m) => (
        <div className="res-card" key={m.id}>
          <div className="res-head">
            <div>
              <b>{m.email}</b>
              {m.id === session.memberId && <span className="you-tag">you</span>}
              <span className={`status-pill ${m.role}`}>{m.role}</span>
              {m.status && <span className={`status-pill ${m.status}`}>{m.status}</span>}
              {admin && m.status === "invited" && (
                <button
                  className="mini"
                  onClick={() =>
                    void act(async () => {
                      const fresh = await regenerateJoinCode(session, m.id);
                      setJoinCode({ email: m.email, code: fresh.joinCode });
                    })
                  }
                >
                  join code
                </button>
              )}
              {m.status === "active" && !m.keyed && (
                <span className="key-hint" title="Grant from a CLI to issue the workspace key">
                  no key yet
                  <CopyButton
                    text={`keyline members grant ${m.email}`}
                    label={`copy grant command for ${m.email}`}
                  />
                </span>
              )}
            </div>
            {admin && m.id !== session.memberId && m.status !== "revoked" && (
              <button
                className="mini danger"
                onClick={() => {
                  if (window.confirm(`Immediately revoke ${m.email}'s access? Their sessions end and their keys are deleted.`)) {
                    void act(async () => {
                      const counts = await revokeMember(session, m.id);
                      setNotice(
                        `Revoked ${m.email}: ${counts.tokensRevoked} sessions ended, ${counts.devicesRevoked} devices cut off. Rotate the secrets that matter.`,
                      );
                    });
                  }
                }}
              >
                revoke
              </button>
            )}
          </div>
          {admin && (
            <div className="env-row">
              {m.grants.map((g) => (
                <span className="env-chip" key={g.env.id}>
                  {g.env.label}: {g.role}
                  <button
                    className="chip-x"
                    aria-label={`remove grant ${g.env.label} for ${m.email}`}
                    onClick={() => void act(() => revokeAccess(session, g.env.id, m.id))}
                  >
                    ×
                  </button>
                </span>
              ))}
              {m.status !== "revoked" && envs.length > 0 && (
                <GrantEditor email={m.email} envs={envs} onGrant={(envId, role) => act(() => grantAccess(session, envId, m.id, role))} />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function InviteForm({ onInvite }: { onInvite: (email: string, role: "member" | "admin") => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  return (
    <form
      className="inline-create"
      style={{ marginBottom: 20 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!email.trim()) return;
        onInvite(email, role);
        setEmail("");
      }}
    >
      <input
        value={email}
        placeholder="teammate@company.com"
        aria-label="invite email"
        onChange={(e) => setEmail(e.target.value)}
      />
      <select aria-label="invite role" value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
        <option value="member">member</option>
        <option value="admin">admin</option>
      </select>
      <button className="btn primary" type="submit">
        Invite
      </button>
    </form>
  );
}

function GrantEditor({
  email,
  envs,
  onGrant,
}: {
  email: string;
  envs: EnvOption[];
  onGrant: (envId: string, role: Grant["role"]) => void;
}) {
  const [envId, setEnvId] = useState("");
  const [role, setRole] = useState<Grant["role"]>("read");
  return (
    <form
      className="inline-create small"
      onSubmit={(e) => {
        e.preventDefault();
        if (!envId) return;
        onGrant(envId, role);
        setEnvId("");
      }}
    >
      <select aria-label={`grant environment for ${email}`} value={envId} onChange={(e) => setEnvId(e.target.value)}>
        <option value="">env…</option>
        {envs.map((env) => (
          <option key={env.id} value={env.id}>
            {env.label}
          </option>
        ))}
      </select>
      <select aria-label={`grant role for ${email}`} value={role} onChange={(e) => setRole(e.target.value as Grant["role"])}>
        <option value="read">read</option>
        <option value="write">write</option>
        <option value="admin">admin</option>
      </select>
      <button className="btn" type="submit">
        + grant
      </button>
    </form>
  );
}
