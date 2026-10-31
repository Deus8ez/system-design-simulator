import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

function transpile(source, fileName) {
  return ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
}

async function importTypeScriptSource(relativePath, fileName = relativePath.split("/").at(-1)) {
  const source = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  const output = transpile(source, fileName);
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const [{ serializeComponentConfiguration, normalizeComponentConfiguration }, { compileDesign }, constants] = await Promise.all([
  importTypeScriptSource("src/lib/componentConfigSerialization.ts"),
  importTypeScriptSource("src/engine/compiler.ts"),
  readFile(new URL("../src/engine/constants.ts", import.meta.url), "utf8"),
]);
const constantsUrl = `data:text/javascript;base64,${Buffer.from(transpile(constants, "constants.ts")).toString("base64")}`;
const simulatorSource = await readFile(new URL("../src/engine/simulator.ts", import.meta.url), "utf8");
const simulatorOutput = transpile(simulatorSource, "simulator.ts")
  .replace('from "./constants"', `from "${constantsUrl}"`);
const simulatorUrl = `data:text/javascript;base64,${Buffer.from(simulatorOutput).toString("base64")}`;
const { runSimulation } = await import(simulatorUrl);

function makeDesign() {
  const limiter = {
    id: "limiter",
    type: "component",
    position: { x: 0, y: 20 },
    data: {
      componentId: "rate-limiter",
      label: "Ingress Limiter",
      icon: "ShieldAlert",
      category: "networking",
      replicas: 1,
      maxQPS: 80000,
      latencyMs: 1,
      scalable: true,
      rateLimiterConfig: {
        algorithm: "sliding-window",
        keyBy: "global",
        requestsPerWindow: 2000,
        windowSeconds: 1,
      },
    },
  };
  const producer = {
    id: "producer",
    type: "component",
    position: { x: 10, y: 20 },
    data: {
      componentId: "app-server",
      label: "Event API",
      icon: "Server",
      category: "compute",
      replicas: 1,
      maxQPS: 5000,
      latencyMs: 8,
      scalable: true,
      endpoints: [{
        id: "post-order",
        method: "POST",
        path: "/orders",
        requestFields: [{ id: "event-type", name: "eventType", type: "string", location: "body" }],
        responseFields: [{ id: "accepted", name: "accepted", type: "boolean" }],
        steps: [
          { id: "validate-order", kind: "validate", condition: "eventType == 'order'" },
          { id: "publish-order", kind: "publish-event", targetNodeId: "queue", target: "orders" },
          { id: "respond", kind: "respond" },
        ],
      }],
    },
  };
  const queue = {
    id: "queue",
    type: "component",
    position: { x: 220, y: 20 },
    data: {
      componentId: "message-queue",
      label: "Orders Queue",
      icon: "Queue",
      category: "messaging",
      replicas: 1,
      maxQPS: 5000,
      latencyMs: 2,
      scalable: true,
      queueDeliveryMode: "competing",
      queueConfig: {
        topics: [{ id: "orders-topic", name: "orders", retentionHours: 168 }],
        subscriptions: [{ id: "orders-worker-sub", consumerNodeId: "worker", topicName: "orders" }],
      },
    },
  };
  const worker = {
    id: "worker",
    type: "component",
    position: { x: 440, y: 20 },
    data: {
      componentId: "stream-processor",
      label: "Order Worker",
      icon: "Workflow",
      category: "messaging",
      replicas: 1,
      maxQPS: 5000,
      latencyMs: 4,
      scalable: true,
    },
  };
  const nodes = [limiter, producer, queue, worker];
  const edges = [
    { id: "limiter-producer", source: "limiter", target: "producer" },
    { id: "producer-queue", source: "producer", target: "queue", data: { label: "publish", protocol: "pubsub", async: true } },
    { id: "queue-worker", source: "queue", target: "worker", data: { label: "consume", protocol: "pubsub", async: true } },
  ];
  return { nodes, edges };
}

test("runtime contracts survive export/import, compile, and topic-aware simulation", () => {
  const { nodes, edges } = makeDesign();
  const profiles = [{ name: "valid order", trafficWeight: 1, attributes: { eventType: "order" } }];

  // Mirror the component-configuration portion of the shared design envelope.
  const exported = JSON.stringify({
    schemaVersion: 1,
    name: "Order Event Flow",
    nodes: nodes.map((node) => ({
      ...node,
      data: { ...node.data, ...serializeComponentConfiguration(node.data) },
    })),
    edges,
  });
  const imported = JSON.parse(exported);
  const restoredNodes = imported.nodes.map((node) => ({
    ...node,
    data: { ...node.data, ...normalizeComponentConfiguration(node.data) },
  }));

  const restoredProducer = restoredNodes.find(({ id }) => id === "producer");
  const restoredLimiter = restoredNodes.find(({ id }) => id === "limiter");
  const restoredQueue = restoredNodes.find(({ id }) => id === "queue");
  const sourceProducer = nodes.find(({ id }) => id === "producer");
  const sourceLimiter = nodes.find(({ id }) => id === "limiter");
  assert.deepEqual(restoredProducer.data.endpoints[0].requestFields, sourceProducer.data.endpoints[0].requestFields);
  assert.deepEqual(restoredProducer.data.endpoints[0].responseFields, sourceProducer.data.endpoints[0].responseFields);
  assert.deepEqual(restoredQueue.data.queueConfig.subscriptions, nodes.find(({ id }) => id === "queue").data.queueConfig.subscriptions);
  assert.deepEqual(
    {
      algorithm: restoredLimiter.data.rateLimiterConfig.algorithm,
      keyBy: restoredLimiter.data.rateLimiterConfig.keyBy,
      requestsPerWindow: restoredLimiter.data.rateLimiterConfig.requestsPerWindow,
      windowSeconds: restoredLimiter.data.rateLimiterConfig.windowSeconds,
    },
    sourceLimiter.data.rateLimiterConfig,
  );
  assert.equal(imported.edges[1].data.async, true);

  const compilation = compileDesign(restoredNodes, imported.edges, profiles);
  assert.equal(compilation.ok, true, JSON.stringify(compilation.diagnostics));
  const simulation = runSimulation(restoredNodes, imported.edges, 1000, {}, 10, profiles);
  assert.equal(simulation.nodeMetrics.get("limiter").rejectedQPS, 0);
  assert.equal(simulation.nodeMetrics.get("producer").incomingQPS, 1000);
  assert.equal(simulation.nodeMetrics.get("worker").incomingQPS, 1000);
  assert.equal(simulation.nodeMetrics.get("queue").queueBacklogQPS, 0);
});
