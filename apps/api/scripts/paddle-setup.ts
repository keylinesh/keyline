/**
 * Ensure the Paddle catalog exists (M5 #70). Idempotent: safe to re-run.
 *
 * Run with:  PADDLE_API_KEY=... [PADDLE_ENV=sandbox|live] pnpm --filter @keyline/api paddle:setup
 *
 * Prints the product/price ids. Put the price id in the environment as
 * PADDLE_TEAM_PRICE_ID (local .env + Vercel) — checkout (#71) and webhooks
 * (#73) read it from there.
 */

import { ensureTeamCatalog } from "../src/billing/catalog.js";
import { PaddleApi, paddleConfigFromEnv } from "../src/billing/paddle.js";

const config = paddleConfigFromEnv();
if (!config) {
  console.error("PADDLE_API_KEY is not set.");
  process.exit(1);
}

const mode = config.baseUrl.includes("sandbox") ? "sandbox" : "LIVE";
const result = await ensureTeamCatalog(new PaddleApi(config));

console.log(`paddle (${mode}):`);
console.log(`  product ${result.productId} ${result.created.product ? "(created)" : "(exists)"}`);
console.log(`  price   ${result.priceId} ${result.created.price ? "(created)" : "(exists)"}`);
console.log(`\nSet PADDLE_TEAM_PRICE_ID=${result.priceId}`);
