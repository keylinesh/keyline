/**
 * Audit chain anchoring (#61) — witness chain heads outside our database.
 *
 * Daily, every workspace's audit head (seq + hash) is published to a public
 * git repository (keyline-anchors) keyed by sha256(workspaceId) — the public
 * learns nothing, but any later rewrite of history diverges from the witness.
 * verify() then checks the live chain against the newest local anchor: the
 * event at the anchored seq must still carry the anchored hash.
 */

import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { AuditRepo } from "./audit.js";

export interface AuditAnchor {
  workspaceId: string;
  seq: number;
  headHash: string;
  witnessUrl: string | null;
  anchoredAt: Date;
}

export interface AnchorRepo {
  insert(anchor: Omit<AuditAnchor, "anchoredAt"> & { anchoredAt?: Date }): Promise<void>;
  latestForWorkspace(workspaceId: string): Promise<AuditAnchor | null>;
}

export class InMemoryAnchorRepo implements AnchorRepo {
  private readonly byWorkspace = new Map<string, AuditAnchor[]>();

  async insert(anchor: Omit<AuditAnchor, "anchoredAt"> & { anchoredAt?: Date }): Promise<void> {
    const list = this.byWorkspace.get(anchor.workspaceId) ?? [];
    list.push({ ...anchor, anchoredAt: anchor.anchoredAt ?? new Date() });
    this.byWorkspace.set(anchor.workspaceId, list);
  }
  async latestForWorkspace(workspaceId: string): Promise<AuditAnchor | null> {
    const list = this.byWorkspace.get(workspaceId) ?? [];
    return list[list.length - 1] ?? null;
  }
}

export class PgAnchorRepo implements AnchorRepo {
  constructor(private readonly pool: Pool) {}

  async insert(anchor: Omit<AuditAnchor, "anchoredAt">): Promise<void> {
    await this.pool.query(
      `insert into audit_anchors (workspace_id, seq, head_hash, witness_url)
       values ($1, $2, $3, $4)`,
      [anchor.workspaceId, anchor.seq, anchor.headHash, anchor.witnessUrl],
    );
  }
  async latestForWorkspace(workspaceId: string): Promise<AuditAnchor | null> {
    const { rows } = await this.pool.query<{
      workspace_id: string; seq: number; head_hash: string; witness_url: string | null; anchored_at: Date;
    }>(
      `select workspace_id, seq, head_hash, witness_url, anchored_at
       from audit_anchors where workspace_id = $1
       order by anchored_at desc limit 1`,
      [workspaceId],
    );
    const r = rows[0];
    return r
      ? { workspaceId: r.workspace_id, seq: r.seq, headHash: r.head_hash, witnessUrl: r.witness_url, anchoredAt: r.anchored_at }
      : null;
  }
}

/** Where anchors get witnessed. The real one commits to a public GitLab repo. */
export interface AnchorWitness {
  publish(fileName: string, content: string): Promise<string>;
}

export class GitLabWitness implements AnchorWitness {
  constructor(
    private readonly projectId: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async publish(fileName: string, content: string): Promise<string> {
    const encoded = encodeURIComponent(`anchors/${fileName}`);
    const base = `https://gitlab.com/api/v4/projects/${this.projectId}/repository/files/${encoded}`;
    const body = JSON.stringify({
      branch: "main",
      content,
      commit_message: `anchor ${fileName}`,
    });
    const headers = { "PRIVATE-TOKEN": this.token, "content-type": "application/json" };

    let res = await this.fetchImpl(base, { method: "POST", headers, body });
    if (res.status === 400) {
      // Same day re-run: the file exists; update it instead.
      res = await this.fetchImpl(base, { method: "PUT", headers, body });
    }
    if (!res.ok) throw new Error(`witness publish failed (${res.status})`);
    return `https://gitlab.com/-/project/${this.projectId}/-/blob/main/anchors/${fileName}`;
  }
}

export const hashedWorkspaceKey = (workspaceId: string): string =>
  createHash("sha256").update(workspaceId).digest("hex");

export interface AnchorRunReport {
  workspaces: number;
  witnessUrl: string | null;
}

export class AnchorService {
  constructor(
    private readonly audit: AuditRepo,
    private readonly anchors: AnchorRepo,
    private readonly witness: AnchorWitness | null,
  ) {}

  async run(now: Date = new Date()): Promise<AnchorRunReport> {
    const heads = await this.audit.heads();
    if (heads.length === 0) return { workspaces: 0, witnessUrl: null };

    let witnessUrl: string | null = null;
    if (this.witness) {
      const payload = {
        generatedAt: now.toISOString(),
        // sha256(workspaceId) → head: the public learns nothing, we can prove everything.
        anchors: Object.fromEntries(
          heads.map((h) => [hashedWorkspaceKey(h.workspaceId), { seq: h.seq, hash: h.hash }]),
        ),
      };
      const fileName = `${now.toISOString().slice(0, 10)}.json`;
      witnessUrl = await this.witness.publish(fileName, JSON.stringify(payload, null, 2) + "\n");
    }

    for (const head of heads) {
      await this.anchors.insert({
        workspaceId: head.workspaceId,
        seq: head.seq,
        headHash: head.hash,
        witnessUrl,
      });
    }
    return { workspaces: heads.length, witnessUrl };
  }
}
