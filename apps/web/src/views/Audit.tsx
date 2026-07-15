/**
 * Audit viewer (#42) — who touched what, filterable, exportable, with the
 * chain-verification status up front. Admin-only (the API enforces it; plain
 * members get the explanation instead of a broken page).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, explainError } from "../api.js";
import { isAdmin, type WebSession } from "../session.js";
import {
  distinctActions,
  download,
  fetchAudit,
  filterEvents,
  toCSV,
  verifyChain,
  type AuditEvent,
  type AuditFilter,
  type VerifyResult,
} from "../audit.js";
import { listMembers, envCatalog, type EnvOption } from "../members.js";

const SHOW_LIMIT = 200;

export function Audit({ session }: { session: WebSession }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [emailById, setEmailById] = useState<Map<string, string>>(new Map());
  const [envs, setEnvs] = useState<EnvOption[]>([]);
  const [filter, setFilter] = useState<AuditFilter>({});
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!isAdmin(session)) {
      setDenied(true);
      return;
    }
    (async () => {
      try {
        const [list, v, members, catalog] = await Promise.all([
          fetchAudit(session),
          verifyChain(session),
          listMembers(session),
          envCatalog(session),
        ]);
        setEvents(list.slice().reverse()); // newest first
        setVerify(v);
        setEmailById(new Map(members.map((m) => [m.id, m.email])));
        setEnvs(catalog);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) setDenied(true);
        else setError(explainError(err));
      }
    })();
  }, [session]);

  const filtered = useMemo(() => (events ? filterEvents(events, filter) : []), [events, filter]);
  const actions = useMemo(() => (events ? distinctActions(events) : []), [events]);
  const envLabel = useMemo(() => new Map(envs.map((e) => [e.id, e.label])), [envs]);

  const exportAs = useCallback(
    (kind: "csv" | "json") => {
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === "csv") download(`keyline-audit-${stamp}.csv`, toCSV(filtered, emailById), "text/csv");
      else download(`keyline-audit-${stamp}.json`, JSON.stringify(filtered, null, 2), "application/json");
    },
    [filtered, emailById],
  );

  if (denied) {
    return <div className="placeholder">The audit log is admin-only. Ask a workspace admin.</div>;
  }
  if (error) return <p className="error" role="alert">{error}</p>;
  if (events === null) {
    return (
      <div aria-hidden>
        <div className="skel" />
        <div className="skel" />
      </div>
    );
  }

  return (
    <div>
      <div className="audit-bar">
        {verify && (
          <span className={verify.ok ? "verify-badge ok" : "verify-badge broken"} role="status">
            {verify.ok ? `chain intact · ${verify.count} events` : `CHAIN BROKEN at #${verify.brokenSeq}: ${verify.reason}`}
          </span>
        )}
        <div className="audit-filters">
          <select
            aria-label="filter environment"
            value={filter.environmentId ?? ""}
            onChange={(e) => setFilter((f) => ({ ...f, environmentId: e.target.value || undefined }))}
          >
            <option value="">all environments</option>
            {envs.map((env) => (
              <option key={env.id} value={env.id}>
                {env.label}
              </option>
            ))}
          </select>
          <select
            aria-label="filter member"
            value={filter.actorMemberId ?? ""}
            onChange={(e) => setFilter((f) => ({ ...f, actorMemberId: e.target.value || undefined }))}
          >
            <option value="">all members</option>
            {[...emailById.entries()].map(([id, email]) => (
              <option key={id} value={id}>
                {email}
              </option>
            ))}
          </select>
          <select
            aria-label="filter action"
            value={filter.action ?? ""}
            onChange={(e) => setFilter((f) => ({ ...f, action: e.target.value || undefined }))}
          >
            <option value="">all actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button className="mini" onClick={() => exportAs("csv")}>
            export CSV
          </button>
          <button className="mini" onClick={() => exportAs("json")}>
            export JSON
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="placeholder">No events match.</div>
      ) : (
        <div className="table-scroll">
        <table className="audit-table">
          <thead>
            <tr>
              <th>time</th>
              <th>actor</th>
              <th>action</th>
              <th>outcome</th>
              <th>target</th>
              <th>detail</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, SHOW_LIMIT).map((e) => (
              <tr key={e.seq}>
                <td className="mono time">{e.createdAt.replace("T", " ").slice(0, 19)}</td>
                <td>{e.actorMemberId ? (emailById.get(e.actorMemberId) ?? e.actorMemberId.slice(0, 8)) : "system"}</td>
                <td className="mono">{e.action}</td>
                <td>
                  <span className={`status-pill ${e.outcome === "allowed" ? "active" : "revoked"}`}>{e.outcome}</span>
                </td>
                <td className="mono target">
                  {e.targetType === "environment"
                    ? (envLabel.get(e.targetId ?? "") ?? "environment")
                    : (e.targetType ?? "")}
                </td>
                <td className="mono detail">
                  {e.metadata && Object.keys(e.metadata).length > 0 ? JSON.stringify(e.metadata) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {filtered.length > SHOW_LIMIT && (
        <p className="hint" style={{ marginTop: 12 }}>
          showing {SHOW_LIMIT} of {filtered.length} — narrow the filters or export for the rest
        </p>
      )}
    </div>
  );
}
