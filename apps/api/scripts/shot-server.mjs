/**
 * Screenshot server (dev-only): the built dashboard + an in-memory API in one
 * process, with /e2e/:theme seeding a signed-in session into localStorage.
 * Run from the repo root:  node apps/api/scripts/shot-server.mjs
 */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { buildApp, memoryDeps } from "../dist/server.js";

const PORT = 4750;
const deps = memoryDeps();
const api = buildApp(deps);

const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: Buffer.from("0123456789abcdef").toString("base64") });
await deps.workspaces.update(ws.id, { plan: "team" });
const owner = await deps.members.create({ workspaceId: ws.id, email: "founder@acme.dev", role: "owner" });
const dev = await deps.members.create({ workspaceId: ws.id, email: "sam@acme.dev", role: "member" });
await deps.members.create({ workspaceId: ws.id, email: "new.hire@acme.dev", role: "member" });
const device = await deps.login.register({ memberId: owner.id, workspaceId: ws.id, publicKey: "pk-shot", role: "owner" });
await deps.login.register({ memberId: dev.id, workspaceId: ws.id, publicKey: "pk-dev", role: "member" });

const apiProj = await deps.projects.create({ workspaceId: ws.id, name: "api", slug: "api" });
const webProj = await deps.projects.create({ workspaceId: ws.id, name: "web", slug: "web" });
for (const [proj, envs] of [[apiProj, ["prod", "staging"]], [webProj, ["prod"]]]) {
  for (const name of envs) await deps.environments.create({ projectId: proj.id, name });
}
for (const action of ["bundle.push", "bundle.pull", "member.invite", "env.grant"]) {
  await deps.audit.record({
    workspaceId: ws.id, actorMemberId: owner.id, actorDeviceId: device.id,
    action, targetType: "environment", targetId: "prod", outcome: "allowed", metadata: {},
  });
}

const { token, expiresAt } = await deps.tokens.issue({
  deviceId: device.id, memberId: owner.id, scope: { workspaceId: ws.id, role: "owner" },
});

const root = new Hono();
root.route("/api", api);
root.get("/e2e/:theme", (c) => {
  const theme = c.req.param("theme") === "light" ? "light" : "dark";
  const session = JSON.stringify({ token, expiresAt, workspaceId: ws.id, memberId: owner.id, role: "owner" });
  return c.html(`<script>
    localStorage.setItem("keyline.web.session", ${JSON.stringify(session)});
    localStorage.setItem("keyline.theme", "${theme}");
    location.replace("/app/#" + (new URLSearchParams(location.search).get("s") ?? "projects"));
  </script>`);
});
root.get("/e2e/signin/:theme", (c) => {
  const theme = c.req.param("theme") === "light" ? "light" : "dark";
  return c.html(`<script>
    localStorage.removeItem("keyline.web.session");
    localStorage.setItem("keyline.theme", "${theme}");
    location.replace("/app/");
  </script>`);
});
root.use("/app/*", serveStatic({ root: "./apps/web/dist", rewriteRequestPath: (p) => p.replace(/^\/app/, "") || "/" }));
root.get("/app/*", serveStatic({ path: "./apps/web/dist/index.html" }));
root.get("/app", (c) => c.redirect("/app/"));

serve({ fetch: root.fetch, port: PORT }, () => console.log(`shot-server listening on :${PORT}`));
