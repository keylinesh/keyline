/**
 * Reconcile Paddle against the database (M5 #77) and print the result — the
 * internal admin view of every customer's subscription + plan.
 *
 * Run with:  PADDLE_API_KEY=... DATABASE_URL=... pnpm --filter @keyline/api paddle:reconcile
 *
 * The same logic runs daily in production via Vercel cron
 * (GET /v1/billing/reconcile with the CRON_SECRET bearer).
 */

import { Pool } from "pg";
import { AuditService } from "../src/domain/audit.js";
import { PgAuditRepo, PgWorkspaceRepo } from "../src/domain/pg-repo.js";
import { connectionConfig } from "../src/db/connection.js";
import { appDatabaseUrl } from "../src/db/database-url.js";
import { PaddleApi, paddleConfigFromEnv } from "../src/billing/paddle.js";
import { ReconciliationService } from "../src/billing/reconcile.js";
import { PgSubscriptionRepo } from "../src/billing/subscriptions.js";

const paddleConfig = paddleConfigFromEnv();
if (!paddleConfig) {
  console.error("PADDLE_API_KEY is not set.");
  process.exit(1);
}
const dbUrl = appDatabaseUrl();
if (!dbUrl) {
  console.error("No database URL (DATABASE_URL / DATABASE_URL_UNPOOLED).");
  process.exit(1);
}

const pool = new Pool(connectionConfig(dbUrl));
const service = new ReconciliationService(
  new PaddleApi(paddleConfig),
  new PgSubscriptionRepo(pool),
  new PgWorkspaceRepo(pool),
  new AuditService(new PgAuditRepo(pool)),
);

const report = await service.run();
const mode = paddleConfig.baseUrl.includes("sandbox") ? "sandbox" : "LIVE";
console.log(`paddle (${mode}) reconciliation: checked ${report.checked}, healed ${report.healed}, orphans ${report.orphans}\n`);
for (const e of report.entries) {
  console.log(
    `${e.workspaceId}  ${e.subscriptionId}  paddle:${e.paddleStatus}  db:${e.storedStatus ?? "-"}  plan:${e.workspacePlan ?? "-"}  ${e.action}`,
  );
}
await pool.end();
process.exit(report.orphans > 0 ? 2 : 0);
