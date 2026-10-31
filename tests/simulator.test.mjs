import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

function transpileModule(source, fileName) {
  return ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
}

const constantsSource = await readFile(new URL("../src/engine/constants.ts", import.meta.url), "utf8");
const constantsOutput = transpileModule(constantsSource, "constants.ts");
const constantsUrl = `data:text/javascript;base64,${Buffer.from(constantsOutput).toString("base64")}`;
const simulatorSource = await readFile(new URL("../src/engine/simulator.ts", import.meta.url), "utf8");
const simulatorOutput = transpileModule(simulatorSource, "simulator.ts")
  .replace('from "./constants"', `from "${constantsUrl}"`);
const simulatorUrl = `data:text/javascript;base64,${Buffer.from(simulatorOutput).toString("base64")}`;
const { runSimulation } = await import(simulatorUrl);

function makeGateway(routes) {
  const gateway = {
    id: "gateway",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "api-gateway",
      label: "Gateway",
      category: "networking",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 1,
      scalable: true,
      routes,
    },
  };
  const backend = (id) => ({
    id,
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "app-server",
      label: id,
      category: "compute",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 1,
      scalable: true,
    },
  });
  const nodes = [gateway, backend("backend-a"), backend("backend-b")];
  const edges = [
    { id: "edge-a", source: "gateway", target: "backend-a" },
    { id: "edge-b", source: "gateway", target: "backend-b" },
  ];
  return { nodes, edges };
}

test("API Gateway route weights direct traffic across distinct backends", () => {
  const { nodes, edges } = makeGateway([
    { id: "route-a", method: "GET", path: "/a", backendNodeId: "backend-a", trafficWeight: 3 },
    { id: "route-b", method: "GET", path: "/b", backendNodeId: "backend-b", trafficWeight: 1 },
  ]);
  const result = runSimulation(nodes, edges, 1000);
  assert.equal(result.nodeMetrics.get("backend-a").incomingQPS, 750);
  assert.equal(result.nodeMetrics.get("backend-b").incomingQPS, 250);
});

test("route-less legacy API Gateways retain even-split traffic behavior", () => {
  const { nodes, edges } = makeGateway(undefined);
  const result = runSimulation(nodes, edges, 1000);
  assert.equal(result.nodeMetrics.get("backend-a").incomingQPS, 500);
  assert.equal(result.nodeMetrics.get("backend-b").incomingQPS, 500);
});

function makeRateLimiterDesign(rateLimiterConfig) {
  const limiter = {
    id: "limiter",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "rate-limiter",
      label: "Rate Limiter",
      category: "networking",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 1,
      scalable: true,
      rateLimiterConfig,
    },
  };
  const backend = {
    id: "backend",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "app-server",
      label: "Backend",
      category: "compute",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 1,
      scalable: true,
    },
  };
  return {
    nodes: [limiter, backend],
    edges: [{ id: "limiter-backend", source: limiter.id, target: backend.id }],
  };
}

test("global rate-limit quotas reject excess traffic without counting it as capacity failure", () => {
  const { nodes, edges } = makeRateLimiterDesign({
    algorithm: "sliding-window",
    keyBy: "global",
    requestsPerWindow: 100,
    windowSeconds: 10,
  });
  const result = runSimulation(nodes, edges, 1000);

  assert.equal(result.nodeMetrics.get("limiter").incomingQPS, 1000);
  assert.equal(result.nodeMetrics.get("limiter").rejectedQPS, 990);
  assert.equal(result.nodeMetrics.get("backend").incomingQPS, 10);
  assert.equal(result.rejectedRequestsPerSec, 990);
  assert.equal(result.failedOperationsPerSec, 0);
  assert.ok(result.warnings.some((warning) => warning.includes("configured rate limits")));
});

test("per-key rate-limit quotas scale by estimated distinct key count", () => {
  const { nodes, edges } = makeRateLimiterDesign({
    algorithm: "token-bucket",
    keyBy: "api-key",
    requestsPerWindow: 100,
    windowSeconds: 10,
    estimatedDistinctKeys: 5,
    burstCapacity: 200,
  });
  const result = runSimulation(nodes, edges, 1000);

  assert.equal(result.nodeMetrics.get("limiter").rejectedQPS, 950);
  assert.equal(result.nodeMetrics.get("backend").incomingQPS, 50);
  assert.equal(result.rejectedRequestsPerSec, 950);
});

test("legacy unconfigured rate limiter retains hardware-capacity behavior", () => {
  const { nodes, edges } = makeRateLimiterDesign(undefined);
  const result = runSimulation(nodes, edges, 1000);

  assert.equal(result.nodeMetrics.get("limiter").rejectedQPS, 0);
  assert.equal(result.nodeMetrics.get("backend").incomingQPS, 1000);
  assert.equal(result.rejectedRequestsPerSec, 0);
});

function makeCacheReadDesign(cacheHitRate) {
  const app = {
    id: "app",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "app-server",
      label: "App",
      category: "compute",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 1,
      scalable: true,
      endpoints: [{
        id: "read",
        method: "GET",
        path: "/items",
        steps: [
          { id: "cache-read", kind: "cache-read", targetNodeId: "cache", ...(cacheHitRate === undefined ? {} : { cacheHitRate }) },
          { id: "db-read", kind: "database-read", targetNodeId: "db", target: "items.id" },
          { id: "respond", kind: "respond" },
        ],
      }],
    },
  };
  const dependency = (id, componentId, label) => ({
    id,
    type: "component",
    position: { x: 0, y: 0 },
    data: { componentId, label, category: "storage", replicas: 1, maxQPS: 10000, latencyMs: 1, scalable: true },
  });
  const cache = dependency("cache", "cache", "Cache");
  const database = dependency("db", "nosql-db", "Database");
  const edges = [
    { id: "app-cache", source: "app", target: "cache" },
    { id: "app-db", source: "app", target: "db" },
  ];
  return { nodes: [app, cache, database], edges };
}

test("request cohorts override cache hit rate and proportionally reduce database reads", () => {
  const { nodes, edges } = makeCacheReadDesign(0.5);
  const result = runSimulation(nodes, edges, 1000, {}, 10, [
    { name: "hot", trafficWeight: 3, attributes: {}, cacheHitRate: 1 },
    { name: "cold", trafficWeight: 1, attributes: {}, cacheHitRate: 0 },
  ]);
  assert.equal(result.nodeMetrics.get("cache").incomingQPS, 1000);
  assert.equal(result.nodeMetrics.get("db").incomingQPS, 250);
});

test("request profiles without a cache override keep the endpoint cache hit rate", () => {
  const { nodes, edges } = makeCacheReadDesign(0.75);
  const result = runSimulation(nodes, edges, 1000, {}, 10, [
    { name: "all", trafficWeight: 1, attributes: {} },
  ]);
  assert.equal(result.nodeMetrics.get("db").incomingQPS, 250);
});

test("request profiles and cache steps without a rate retain the existing default", () => {
  const { nodes, edges } = makeCacheReadDesign(undefined);
  const result = runSimulation(nodes, edges, 1000, {}, 10, [
    { name: "all", trafficWeight: 1, attributes: {} },
  ]);
  assert.ok(Math.abs(result.nodeMetrics.get("db").incomingQPS - 100) < 1e-9);
});

function makeQueueDesign({ inputQPS = 1000, consumerCapacities = [], deliveryMode = "competing" } = {}) {
  const producer = {
    id: "producer",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "app-server",
      label: "Producer",
      category: "compute",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 1,
      scalable: true,
    },
  };
  const queue = {
    id: "queue",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "message-queue",
      label: "Events Queue",
      category: "messaging",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 1,
      scalable: true,
      queueDeliveryMode: deliveryMode,
    },
  };
  const consumers = consumerCapacities.map((maxQPS, index) => ({
    id: `consumer-${index}`,
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "app-server",
      label: `Consumer ${index}`,
      category: "compute",
      replicas: 1,
      maxQPS,
      latencyMs: 1,
      scalable: true,
    },
  }));
  const edges = [
    { id: "producer-queue", source: "producer", target: "queue" },
    ...consumers.map((consumer) => ({
      id: `queue-${consumer.id}`,
      source: "queue",
      target: consumer.id,
    })),
  ];
  return { nodes: [producer, queue, ...consumers], edges, inputQPS };
}

test("competing queue consumers build backlog only when aggregate capacity is insufficient", () => {
  const { nodes, edges } = makeQueueDesign({ consumerCapacities: [300, 300] });
  const result = runSimulation(nodes, edges, 1000, {}, 10);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, 400);
  assert.equal(result.nodeMetrics.get("queue").queueDepth, 4000);
});

test("competing queue consumers with enough aggregate capacity have no projected backlog", () => {
  const { nodes, edges } = makeQueueDesign({ consumerCapacities: [600, 600] });
  const result = runSimulation(nodes, edges, 1000, {}, 10);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, 0);
  assert.equal(result.nodeMetrics.get("queue").queueDepth, 0);
});

test("queue without consumers projects all accepted messages as backlog growth", () => {
  const { nodes, edges } = makeQueueDesign();
  const result = runSimulation(nodes, edges, 1000, {}, 5);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, 1000);
  assert.equal(result.nodeMetrics.get("queue").queueDepth, 5000);
});

test("broadcast queue backlog is constrained by its slowest consumer", () => {
  const { nodes, edges } = makeQueueDesign({
    consumerCapacities: [900, 500],
    deliveryMode: "broadcast",
  });
  const result = runSimulation(nodes, edges, 1000, {}, 10);
  assert.equal(result.nodeMetrics.get("consumer-0").incomingQPS, 1000);
  assert.equal(result.nodeMetrics.get("consumer-1").incomingQPS, 1000);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, 500);
  assert.equal(result.nodeMetrics.get("queue").queueDepth, 5000);
});

function makeTopicQueueDesign({
  publishers,
  subscriptions,
  consumerCapacities = [10000, 10000],
  deliveryMode = "competing",
} = {}) {
  const design = makeQueueDesign({ consumerCapacities, deliveryMode });
  const producer = design.nodes[0];
  const queue = design.nodes[1];
  const topicNames = [...new Set(publishers.map(({ topicName }) => topicName))];
  producer.data.endpoints = publishers.map(({ topicName, trafficWeight = 1 }, index) => ({
    id: `publisher-${index}`,
    method: "POST",
    path: `/events/${index}`,
    trafficWeight,
    steps: [
      { id: `publish-${index}`, kind: "publish-event", targetNodeId: queue.id, target: topicName },
      { id: `respond-${index}`, kind: "respond" },
    ],
  }));
  queue.data.queueConfig = {
    topics: topicNames.map((name, index) => ({ id: `topic-${index}`, name })),
    subscriptions: subscriptions.map(({ consumerIndex, topicName }, index) => ({
      id: `subscription-${index}`,
      consumerNodeId: `consumer-${consumerIndex}`,
      topicName,
    })),
  };
  return design;
}

test("queue topic traffic reaches only its mapped consumers", () => {
  const { nodes, edges } = makeTopicQueueDesign({
    publishers: [
      { topicName: "orders", trafficWeight: 3 },
      { topicName: "metrics", trafficWeight: 1 },
    ],
    subscriptions: [
      { consumerIndex: 0, topicName: "orders" },
      { consumerIndex: 1, topicName: "metrics" },
    ],
  });
  const result = runSimulation(nodes, edges, 1000);
  assert.equal(result.nodeMetrics.get("consumer-0").incomingQPS, 750);
  assert.equal(result.nodeMetrics.get("consumer-1").incomingQPS, 250);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, 0);
});

test("queue topic delivery does not send messages to an unsubscriber", () => {
  const { nodes, edges } = makeTopicQueueDesign({
    publishers: [{ topicName: "orders" }],
    subscriptions: [{ consumerIndex: 0, topicName: "orders" }],
  });
  const result = runSimulation(nodes, edges, 1000);
  assert.equal(result.nodeMetrics.get("consumer-0").incomingQPS, 1000);
  assert.equal(result.nodeMetrics.get("consumer-1").incomingQPS, 0);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, 0);
});

test("competing subscribers split each topic independently", () => {
  const { nodes, edges } = makeTopicQueueDesign({
    publishers: [{ topicName: "orders" }],
    subscriptions: [
      { consumerIndex: 0, topicName: "orders" },
      { consumerIndex: 1, topicName: "orders" },
    ],
    deliveryMode: "competing",
  });
  const result = runSimulation(nodes, edges, 1000);
  assert.equal(result.nodeMetrics.get("consumer-0").incomingQPS, 500);
  assert.equal(result.nodeMetrics.get("consumer-1").incomingQPS, 500);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, 0);
});

test("queue topics without subscribers contribute to projected backlog", () => {
  const { nodes, edges } = makeTopicQueueDesign({
    publishers: [{ topicName: "orphan-events" }],
    subscriptions: [],
    consumerCapacities: [10000],
  });
  const result = runSimulation(nodes, edges, 1000, {}, 5);
  assert.equal(result.nodeMetrics.get("consumer-0").incomingQPS, 0);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, 1000);
  assert.equal(result.nodeMetrics.get("queue").queueDepth, 5000);
});

test("topic broadcast backlog follows the slowest mapped consumer", () => {
  const { nodes, edges } = makeTopicQueueDesign({
    publishers: [{ topicName: "orders" }],
    subscriptions: [
      { consumerIndex: 0, topicName: "orders" },
      { consumerIndex: 1, topicName: "orders" },
    ],
    consumerCapacities: [1000, 400],
    deliveryMode: "broadcast",
  });
  const result = runSimulation(nodes, edges, 1000, {}, 10);
  assert.equal(result.nodeMetrics.get("consumer-0").incomingQPS, 1000);
  assert.equal(result.nodeMetrics.get("consumer-1").incomingQPS, 1000);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, 600);
});

function makeProfileRoutingDesign() {
  const app = {
    id: "app",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "app-server",
      label: "Router",
      category: "compute",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 1,
      scalable: true,
      endpoints: [{
        id: "regional-route",
        method: "GET",
        path: "/items",
        requestFields: [{ id: "region", name: "region", type: "string", location: "query" }],
        steps: [
          { id: "route-eu", kind: "route", targetNodeId: "eu-service", condition: "region == 'eu'" },
          { id: "route-us", kind: "route", targetNodeId: "us-service", condition: "region == 'us'" },
          { id: "respond", kind: "respond" },
        ],
      }],
    },
  };
  const service = (id) => ({
    id,
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "app-server",
      label: id,
      category: "compute",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 1,
      scalable: true,
    },
  });
  const eu = service("eu-service");
  const us = service("us-service");
  return {
    nodes: [app, eu, us],
    edges: [
      { id: "app-eu", source: "app", target: "eu-service" },
      { id: "app-us", source: "app", target: "us-service" },
    ],
  };
}

test("request profile attributes route weighted cohorts to matching services", () => {
  const { nodes, edges } = makeProfileRoutingDesign();
  const result = runSimulation(nodes, edges, 1000, {}, 10, [
    { name: "EU", trafficWeight: 3, attributes: { region: "eu" } },
    { name: "US", trafficWeight: 1, attributes: { region: "us" } },
  ]);
  assert.equal(result.nodeMetrics.get("eu-service").incomingQPS, 750);
  assert.equal(result.nodeMetrics.get("us-service").incomingQPS, 250);
});

test("validation rejects only the request profile that fails its condition", () => {
  const { nodes, edges } = makeProfileRoutingDesign();
  nodes[0].data.endpoints[0].steps = [
    { id: "region-validation", kind: "validate", condition: "region == 'eu'" },
    { id: "respond", kind: "respond" },
  ];
  const result = runSimulation(nodes, edges, 1000, {}, 10, [
    { name: "EU", trafficWeight: 3, attributes: { region: "eu" } },
    { name: "US", trafficWeight: 1, attributes: { region: "us" } },
  ]);
  assert.equal(result.nodeMetrics.get("app").rejectedQPS, 250);
  assert.equal(result.nodeMetrics.get("eu-service").incomingQPS, 750);
});

test("missing profile attributes keep documented condition fallback behavior", () => {
  const { nodes, edges } = makeProfileRoutingDesign();
  nodes[0].data.endpoints[0].steps = [
    { id: "route-eu", kind: "route", targetNodeId: "eu-service", condition: "region == 'eu'", matchRate: 0.4 },
    { id: "respond", kind: "respond" },
  ];
  const result = runSimulation(nodes, edges, 1000, {}, 10, [
    { name: "missing region", trafficWeight: 1, attributes: {} },
  ]);
  assert.equal(result.nodeMetrics.get("eu-service").incomingQPS, 400);
  assert.ok(result.warnings.some((warning) => warning.includes("could not be evaluated")));
});
