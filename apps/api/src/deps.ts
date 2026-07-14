/**
 * Dependency wiring (composition).
 *
 * memoryDeps() — all in-memory; for local dev without a database and for tests.
 * pgDeps(pool) — Postgres-backed; for staging/production.
 */

import type { Pool } from "pg";
import { DeviceLoginService } from "./auth/device-login.js";
import { TokenService } from "./auth/tokens.js";
import { AuditService } from "./domain/audit.js";
import { AnchorService, GitLabWitness, InMemoryAnchorRepo, PgAnchorRepo } from "./domain/anchors.js";
import { EntitlementsService } from "./domain/entitlements.js";
import { InMemoryJoinCodeRepo, JoinService, PgJoinCodeRepo } from "./domain/join-codes.js";
import { WebSessionService } from "./domain/web-sessions.js";
import { InMemoryBillingEventRepo, PgBillingEventRepo } from "./billing/events.js";
import { billingPublicConfigFromEnv, PaddleApi, paddleConfigFromEnv } from "./billing/paddle.js";
import { BillingPortalService } from "./billing/portal.js";
import { ReconciliationService } from "./billing/reconcile.js";
import { InMemorySubscriptionRepo, PgSubscriptionRepo } from "./billing/subscriptions.js";
import { BillingWebhookService } from "./billing/webhook.js";
import { RevokeService } from "./services/revoke.js";
import {
  InMemoryChallengeRepo,
  InMemoryDeviceRepo,
  InMemoryTokenRepo,
} from "./auth/memory-repo.js";
import { PgChallengeRepo, PgDeviceRepo, PgTokenRepo } from "./auth/pg-repo.js";
import {
  InMemoryAuditRepo,
  InMemoryBundleRepo,
  InMemoryEnvironmentAccessRepo,
  InMemoryEnvironmentRepo,
  InMemoryMemberRepo,
  InMemoryProjectRepo,
  InMemoryWebSessionRepo,
  InMemoryWorkspaceRepo,
  InMemoryWrappedKeyRepo,
} from "./domain/memory-repo.js";
import {
  PgAuditRepo,
  PgBundleRepo,
  PgEnvironmentAccessRepo,
  PgEnvironmentRepo,
  PgMemberRepo,
  PgProjectRepo,
  PgWebSessionRepo,
  PgWorkspaceRepo,
  PgWrappedKeyRepo,
} from "./domain/pg-repo.js";
import type { AppDeps } from "./http/app.js";

export function memoryDeps(): AppDeps {
  const tokens = new TokenService(new InMemoryTokenRepo());
  const devices = new InMemoryDeviceRepo();
  const wrappedKeys = new InMemoryWrappedKeyRepo();
  const login = new DeviceLoginService(devices, new InMemoryChallengeRepo(), tokens);
  const workspaces = new InMemoryWorkspaceRepo();
  const projects = new InMemoryProjectRepo();
  const environments = new InMemoryEnvironmentRepo();
  const members = new InMemoryMemberRepo();
  const auditRepo = new InMemoryAuditRepo();
  const anchorRepo = new InMemoryAnchorRepo();
  const audit = new AuditService(auditRepo, anchorRepo);
  const subscriptions = new InMemorySubscriptionRepo();
  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;
  return {
    tokens,
    login,
    workspaces,
    projects,
    environments,
    bundles: new InMemoryBundleRepo(),
    wrappedKeys,
    members,
    access: new InMemoryEnvironmentAccessRepo(),
    audit,
    devices,
    revoke: new RevokeService(devices, wrappedKeys, tokens),
    webSessions: new WebSessionService(new InMemoryWebSessionRepo(), tokens),
    entitlements: new EntitlementsService(workspaces, projects, environments, members),
    join: new JoinService(new InMemoryJoinCodeRepo(), members, workspaces, login, audit),
    billingWebhook: webhookSecret
      ? new BillingWebhookService(webhookSecret, new InMemoryBillingEventRepo(), workspaces, audit, subscriptions)
      : null,
    billingConfig: billingPublicConfigFromEnv(),
    subscriptions,
    billingPortal: (() => {
      const cfg = paddleConfigFromEnv();
      return cfg ? new BillingPortalService(new PaddleApi(cfg), subscriptions) : null;
    })(),
    billingReconcile: (() => {
      const cfg = paddleConfigFromEnv();
      return cfg
        ? new ReconciliationService(new PaddleApi(cfg), subscriptions, workspaces, audit)
        : null;
    })(),
    auditAnchors: new AnchorService(
      auditRepo,
      anchorRepo,
      process.env.ANCHOR_GITLAB_TOKEN && process.env.ANCHOR_REPO_PROJECT_ID
        ? new GitLabWitness(process.env.ANCHOR_REPO_PROJECT_ID, process.env.ANCHOR_GITLAB_TOKEN)
        : null,
    ),
    cronSecret: process.env.CRON_SECRET ?? null,
  };
}

export function pgDeps(pool: Pool): AppDeps {
  const tokens = new TokenService(new PgTokenRepo(pool));
  const devices = new PgDeviceRepo(pool);
  const wrappedKeys = new PgWrappedKeyRepo(pool);
  const login = new DeviceLoginService(devices, new PgChallengeRepo(pool), tokens);
  const workspaces = new PgWorkspaceRepo(pool);
  const projects = new PgProjectRepo(pool);
  const environments = new PgEnvironmentRepo(pool);
  const members = new PgMemberRepo(pool);
  const auditRepo = new PgAuditRepo(pool);
  const anchorRepo = new PgAnchorRepo(pool);
  const audit = new AuditService(auditRepo, anchorRepo);
  const subscriptions = new PgSubscriptionRepo(pool);
  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;
  return {
    tokens,
    login,
    workspaces,
    projects,
    environments,
    bundles: new PgBundleRepo(pool),
    wrappedKeys,
    members,
    access: new PgEnvironmentAccessRepo(pool),
    audit,
    devices,
    revoke: new RevokeService(devices, wrappedKeys, tokens),
    webSessions: new WebSessionService(new PgWebSessionRepo(pool), tokens),
    entitlements: new EntitlementsService(workspaces, projects, environments, members),
    join: new JoinService(new PgJoinCodeRepo(pool), members, workspaces, login, audit),
    billingWebhook: webhookSecret
      ? new BillingWebhookService(webhookSecret, new PgBillingEventRepo(pool), workspaces, audit, subscriptions)
      : null,
    billingConfig: billingPublicConfigFromEnv(),
    subscriptions,
    billingPortal: (() => {
      const cfg = paddleConfigFromEnv();
      return cfg ? new BillingPortalService(new PaddleApi(cfg), subscriptions) : null;
    })(),
    billingReconcile: (() => {
      const cfg = paddleConfigFromEnv();
      return cfg
        ? new ReconciliationService(new PaddleApi(cfg), subscriptions, workspaces, audit)
        : null;
    })(),
    auditAnchors: new AnchorService(
      auditRepo,
      anchorRepo,
      process.env.ANCHOR_GITLAB_TOKEN && process.env.ANCHOR_REPO_PROJECT_ID
        ? new GitLabWitness(process.env.ANCHOR_REPO_PROJECT_ID, process.env.ANCHOR_GITLAB_TOKEN)
        : null,
    ),
    cronSecret: process.env.CRON_SECRET ?? null,
  };
}
