/**
 * Tamper-evident audit log (#24).
 *
 * Events are append-only and hash-chained per workspace:
 *   hash(n) = SHA-256( canonical(event fields of n) ‖ hash(n-1) )
 * with hash(0) = GENESIS. Changing, reordering, or deleting any event makes a
 * recomputed hash diverge from the stored one, which verifyChain() detects.
 *
 * Hashing is deterministic: fields are serialized in a fixed order with a stable
 * (key-sorted) stringifier, so append-time and verify-time hashes always match.
 */

import { createHash } from "node:crypto";

export type AuditOutcome = "allowed" | "denied";

export interface AuditEvent {
  id: string;
  workspaceId: string;
  seq: number;
  actorMemberId: string | null;
  actorDeviceId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: AuditOutcome;
  metadata: Record<string, unknown>;
  createdAt: Date;
  prevHash: string;
  hash: string;
}

export interface AppendAuditInput {
  workspaceId: string;
  actorMemberId?: string | null;
  actorDeviceId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  outcome: AuditOutcome;
  metadata?: Record<string, unknown>;
}

export const GENESIS_HASH = "0".repeat(64);

/** Deterministic JSON: object keys sorted recursively. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** The content that gets hashed for one event (everything but id and hash). */
export interface HashableEvent {
  seq: number;
  workspaceId: string;
  actorMemberId: string | null;
  actorDeviceId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: AuditOutcome;
  metadata: Record<string, unknown>;
  createdAt: Date;
  prevHash: string;
}

export function computeEventHash(e: HashableEvent): string {
  const canonical = stableStringify([
    e.seq,
    e.workspaceId,
    e.actorMemberId,
    e.actorDeviceId,
    e.action,
    e.targetType,
    e.targetId,
    e.outcome,
    e.metadata,
    e.createdAt.toISOString(),
    e.prevHash,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export type VerifyResult =
  | { ok: true; count: number }
  | { ok: false; brokenSeq: number; reason: string };

/** Recompute the chain over events (must be ordered by seq asc) and report the first break. */
export function verifyChain(events: AuditEvent[]): VerifyResult {
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const e of events) {
    if (e.seq !== expectedSeq) {
      return { ok: false, brokenSeq: e.seq, reason: `expected seq ${expectedSeq}, got ${e.seq}` };
    }
    if (e.prevHash !== prev) {
      return { ok: false, brokenSeq: e.seq, reason: "prev_hash does not match the prior event" };
    }
    if (computeEventHash(e) !== e.hash) {
      return { ok: false, brokenSeq: e.seq, reason: "event hash does not match its contents" };
    }
    prev = e.hash;
    expectedSeq++;
  }
  return { ok: true, count: events.length };
}

export interface AuditRepo {
  /** Append the next event atomically (assigns seq, prev_hash, hash). */
  append(input: AppendAuditInput): Promise<AuditEvent>;
  /** All events for a workspace, ordered by seq ascending. */
  list(workspaceId: string): Promise<AuditEvent[]>;
  /** Every workspace's chain head, for anchoring (#61). */
  heads(): Promise<Array<{ workspaceId: string; seq: number; hash: string }>>;
}

export interface AnchorCheck {
  seq: number;
  anchoredAt: string;
  witnessUrl: string | null;
  /** The live chain still contains the anchored head, unchanged. */
  matches: boolean;
}

/** How verify() looks up the newest anchor without importing the anchor module. */
export interface AnchorLookup {
  latestForWorkspace(workspaceId: string): Promise<{
    seq: number;
    headHash: string;
    witnessUrl: string | null;
    anchoredAt: Date;
  } | null>;
}

/** Thin orchestration over the repo: record events and verify the chain. */
export class AuditService {
  constructor(
    private readonly repo: AuditRepo,
    private readonly anchors?: AnchorLookup,
  ) {}

  record(input: AppendAuditInput): Promise<AuditEvent> {
    return this.repo.append(input);
  }

  async verify(workspaceId: string): Promise<VerifyResult & { anchor?: AnchorCheck }> {
    const events = await this.repo.list(workspaceId);
    const result = verifyChain(events);
    const anchor = await this.anchors?.latestForWorkspace(workspaceId);
    if (!anchor) return result;
    // The event at the anchored seq must still carry the publicly witnessed
    // hash; a shorter chain means history was truncated after anchoring.
    const at = events[anchor.seq - 1];
    return {
      ...result,
      anchor: {
        seq: anchor.seq,
        anchoredAt: anchor.anchoredAt.toISOString(),
        witnessUrl: anchor.witnessUrl,
        matches: at?.hash === anchor.headHash,
      },
    };
  }

  list(workspaceId: string): Promise<AuditEvent[]> {
    return this.repo.list(workspaceId);
  }
}
