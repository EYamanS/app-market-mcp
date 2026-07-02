// End-to-end smoke test: boots the built server over stdio, lists tools,
// and runs one real search against the live iTunes endpoint.
import { spawn } from "node:child_process";

const child = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map();
let buf = "";

child.stdout.on("data", (d) => {
  buf += d;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
const call = (id, method, params) =>
  new Promise((resolve, reject) => {
    pending.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30_000);
  });

try {
  await call(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const tools = await call(2, "tools/list", {});
  const names = tools.result.tools.map((t) => t.name);
  console.log(`tools (${names.length}):`, names.join(", "));
  const expected = [
    "search_apps", "app_profile", "share_of_search", "keyword_matrix", "market_map",
    "top_charts", "studio_profile", "studio_releases", "suggest_competitors",
    "create_watchlist", "list_watchlists", "snapshot_watchlist", "rank_movement",
    "delete_watchlist",
  ];
  const missing = expected.filter((n) => !names.includes(n));
  if (missing.length) throw new Error(`missing tools: ${missing.join(", ")}`);

  const r = await call(3, "tools/call", {
    name: "search_apps",
    arguments: { term: "habit tracker", limit: 3 },
  });
  if (r.result.isError) throw new Error(`search_apps errored: ${r.result.content[0].text}`);
  const payload = JSON.parse(r.result.content[0].text);
  if (!payload.apps?.length) throw new Error("search_apps returned no apps");
  console.log("search_apps ok:", payload.apps.map((a) => `#${a.rank} ${a.name}`).join(" | "));

  console.log("SMOKE PASS");
  child.kill();
  process.exit(0);
} catch (err) {
  console.error("SMOKE FAIL:", err.message);
  child.kill();
  process.exit(1);
}
