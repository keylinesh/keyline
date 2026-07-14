/**
 * Ensure the Paddle webhook destination exists (M5 #73). Idempotent.
 *
 * Run with:  PADDLE_API_KEY=... pnpm --filter @keyline/api paddle:webhook [url]
 *
 * Default URL is production. Prints the endpoint secret — set it as
 * PADDLE_WEBHOOK_SECRET (local .env + Vercel); the webhook route returns 503
 * until it's configured.
 */

import { ensureWebhookDestination } from "../src/billing/notifications.js";
import { PaddleApi, paddleConfigFromEnv } from "../src/billing/paddle.js";

const config = paddleConfigFromEnv();
if (!config) {
  console.error("PADDLE_API_KEY is not set.");
  process.exit(1);
}

const url = process.argv[2] ?? "https://www.keyline.sh/api/v1/billing/webhook";
const mode = config.baseUrl.includes("sandbox") ? "sandbox" : "LIVE";
const result = await ensureWebhookDestination(new PaddleApi(config), url);

console.log(`paddle (${mode}) webhook destination:`);
console.log(`  ${url} ${result.created ? "(created)" : "(exists)"}`);
console.log(`\nSet PADDLE_WEBHOOK_SECRET=${result.secret}`);
