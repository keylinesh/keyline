/**
 * keyline API — entrypoint stub.
 *
 * The real API (auth, push/pull ciphertext, RBAC, tamper-evident audit log,
 * Stripe webhooks) is built across milestones M2 and M5. This stub starts an
 * HTTP server with a health check so the deploy pipeline has something to run.
 *
 * INVARIANT: the server must never receive or store plaintext secrets or the
 * workspace master key — only ciphertext, wrapped keys, metadata, audit events.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3000);

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "keyline-api" }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, () => {
  console.log(`keyline-api listening on :${PORT} (stub — see milestones M2/M5)`);
});
