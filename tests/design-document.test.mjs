import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/designDocument.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
const { buildDesignMarkdown } = await import(moduleUrl);

test("architecture report contains a diagram, component parameters, connections, and load configuration", () => {
  const markdown = buildDesignMarkdown(
    "Orders & Payments",
    [
      {
        id: "api-1",
        type: "component",
        position: { x: 20, y: 30 },
        data: { componentId: "app-server", label: "API & Web", icon: "Server", category: "compute", replicas: 3, maxQPS: 4500, latencyMs: 8, scalable: true, endpoints: [{ id: "read", method: "GET", path: "/orders", steps: [{ id: "respond", kind: "respond" }] }] },
      },
      {
        id: "queue-1",
        type: "component",
        position: { x: 260, y: 30 },
        data: { componentId: "message-queue", label: "Orders Queue", icon: "Queue", category: "messaging", replicas: 2, maxQPS: 9000, latencyMs: 4, scalable: true },
      },
    ],
    [{ id: "api-queue", source: "api-1", target: "queue-1", data: { label: "events", protocol: "pubsub", async: true } }],
    { requestsPerSec: 90000, durationSec: 60, rampUp: true, faults: {}, requestProfiles: [{ name: "default", trafficWeight: 1, attributes: {} }] },
  );

  assert.match(markdown, /```mermaid\nflowchart LR/);
  assert.match(markdown, /API &amp; Web \(app-server\)/);
  assert.match(markdown, /--\|events · pubsub · async\|/);
  assert.match(markdown, /"maxQPS": 4500/);
  assert.match(markdown, /"path": "\/orders"/);
  assert.match(markdown, /"requestsPerSec": 90000/);
  assert.match(markdown, /"durationSec": 60/);
});
