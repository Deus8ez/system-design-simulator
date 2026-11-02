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

test("database read-copy estimate is supplementary and does not change simulated throughput", () => {
  const { nodes, edges } = makeCacheReadDesign(0);
  const database = nodes.find(({ id }) => id === "db");
  database.data.databaseReplicationEstimate = { estimatedReadReplicaCount: 2 };

  const estimated = runSimulation(nodes, edges, 1000);
  const legacyNodes = nodes.map((node) => ({
    ...node,
    data: { ...node.data, databaseReplicationEstimate: undefined },
  }));
  const legacy = runSimulation(legacyNodes, edges, 1000);
  const dbMetrics = estimated.nodeMetrics.get("db");

  assert.equal(dbMetrics.databaseReadWorkQPS, 5000);
  assert.equal(dbMetrics.estimatedReadReplicaReadWorkQPS, 5000);
  assert.equal(dbMetrics.estimatedPrimaryDatabaseWorkQPS, dbMetrics.databaseWriteWorkQPS);
  assert.equal(dbMetrics.estimatedReadReplicaWorkCapacity, 20000);
  assert.equal(dbMetrics.estimatedReadReplicaUtilization, 0.25);
  assert.equal(estimated.throughput, legacy.throughput);
  assert.equal(dbMetrics.incomingQPS, legacy.nodeMetrics.get("db").incomingQPS);
  assert.equal(dbMetrics.utilization, legacy.nodeMetrics.get("db").utilization);
});

test("database read-copy estimate reports zero modeled read work without endpoint database reads", () => {
  const database = {
    id: "db",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "nosql-db",
      label: "Database",
      category: "storage",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 1,
      scalable: true,
      databaseReplicationEstimate: { estimatedReadReplicaCount: 3 },
    },
  };
  const result = runSimulation([database], [], 500);
  const metrics = result.nodeMetrics.get("db");
  assert.equal(metrics.databaseReadWorkQPS, 0);
  assert.equal(metrics.estimatedReadReplicaWorkCapacity, 30000);
  assert.equal(metrics.estimatedReadReplicaUtilization, 0);
});

test("estimated read-copy share splits modeled work without changing simulated traffic", () => {
  const { nodes, edges } = makeCacheReadDesign(0);
  nodes.find(({ id }) => id === "app").data.endpoints.push({
    id: "write-item",
    method: "POST",
    path: "/items",
    steps: [
      { id: "db-write", kind: "database-write", targetNodeId: "db", target: "items" },
      { id: "write-response", kind: "respond" },
    ],
  });
  const database = nodes.find(({ id }) => id === "db");
  database.data.databaseReplicationEstimate = {
    estimatedReadReplicaCount: 2,
    estimatedReadTrafficToReplicasShare: 0.6,
  };

  const estimated = runSimulation(nodes, edges, 1000);
  const legacyNodes = nodes.map((node) => ({
    ...node,
    data: { ...node.data, databaseReplicationEstimate: undefined },
  }));
  const legacy = runSimulation(legacyNodes, edges, 1000);
  const dbMetrics = estimated.nodeMetrics.get("db");

  assert.ok(dbMetrics.databaseReadWorkQPS > 0);
  assert.ok(dbMetrics.databaseWriteWorkQPS > 0);
  assert.equal(dbMetrics.estimatedReadReplicaReadWorkQPS, dbMetrics.databaseReadWorkQPS * 0.6);
  assert.equal(dbMetrics.estimatedPrimaryDatabaseWorkQPS, dbMetrics.databaseWriteWorkQPS + dbMetrics.databaseReadWorkQPS * 0.4);
  assert.equal(dbMetrics.estimatedPrimaryDatabaseWorkCapacity, 10000);
  assert.equal(dbMetrics.estimatedPrimaryDatabaseUtilization, dbMetrics.estimatedPrimaryDatabaseWorkQPS / 10000);
  assert.equal(dbMetrics.estimatedReadReplicaWorkCapacity, 20000);
  assert.equal(dbMetrics.estimatedReadReplicaUtilization, dbMetrics.estimatedReadReplicaReadWorkQPS / 20000);
  assert.equal(estimated.throughput, legacy.throughput);
  assert.equal(dbMetrics.incomingQPS, legacy.nodeMetrics.get("db").incomingQPS);
  assert.equal(dbMetrics.utilization, legacy.nodeMetrics.get("db").utilization);
});

test("replica lag estimate warns above the read-staleness budget without changing simulation", () => {
  const { nodes, edges } = makeCacheReadDesign(0);
  const database = nodes.find(({ id }) => id === "db");
  database.data.databaseReplicationEstimate = {
    estimatedReadReplicaCount: 2,
    estimatedReadTrafficToReplicasShare: 0.8,
    estimatedReplicationLagMs: 800,
    maximumToleratedReadStalenessMs: 500,
  };

  const estimated = runSimulation(nodes, edges, 1000);
  const equalBudgetNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      databaseReplicationEstimate: node.data.databaseReplicationEstimate
        ? { ...node.data.databaseReplicationEstimate, maximumToleratedReadStalenessMs: 800 }
        : undefined,
    },
  }));
  const equalBudget = runSimulation(equalBudgetNodes, edges, 1000);
  const noEstimateNodes = nodes.map((node) => ({
    ...node,
    data: { ...node.data, databaseReplicationEstimate: undefined },
  }));
  const noEstimate = runSimulation(noEstimateNodes, edges, 1000);
  const noCopyReadNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      databaseReplicationEstimate: node.data.databaseReplicationEstimate
        ? { ...node.data.databaseReplicationEstimate, estimatedReadTrafficToReplicasShare: 0 }
        : undefined,
    },
  }));
  const noCopyRead = runSimulation(noCopyReadNodes, edges, 1000);
  const noDatabaseRead = makeCacheReadDesign(1);
  noDatabaseRead.nodes.find(({ id }) => id === "db").data.databaseReplicationEstimate = {
    estimatedReadReplicaCount: 2,
    estimatedReadTrafficToReplicasShare: 0.8,
    estimatedReplicationLagMs: 800,
    maximumToleratedReadStalenessMs: 500,
  };
  const noDatabaseReadResult = runSimulation(noDatabaseRead.nodes, noDatabaseRead.edges, 1000);
  const dbMetrics = estimated.nodeMetrics.get("db");

  assert.ok(estimated.warnings.some((warning) => /assumed 80% read share.*800 ms estimated lag.*above the 500 ms scenario budget.*reads are not routed/i.test(warning)));
  assert.equal(equalBudget.warnings.some((warning) => /read-copy freshness estimate/.test(warning)), false);
  assert.equal(noEstimate.warnings.some((warning) => /read-copy freshness estimate/.test(warning)), false);
  assert.equal(noCopyRead.warnings.some((warning) => /read-copy freshness estimate/.test(warning)), false);
  assert.equal(noDatabaseReadResult.warnings.some((warning) => /read-copy freshness estimate/.test(warning)), false);
  assert.equal(estimated.throughput, noEstimate.throughput);
  assert.equal(dbMetrics.incomingQPS, noEstimate.nodeMetrics.get("db").incomingQPS);
  assert.equal(dbMetrics.utilization, noEstimate.nodeMetrics.get("db").utilization);
});

function makeDatabaseWriteWorkDesign({ retries, retryFailureRate, maxQPS = 10000, fault, partitioning } = {}) {
  const app = {
    id: "app",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "app-server",
      label: "Writer",
      category: "compute",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 1,
      scalable: true,
      endpoints: [{
        id: "write-item",
        method: "POST",
        path: "/items",
        steps: [
          { id: "write-row", kind: "database-write", targetNodeId: "db", target: "items", retryAttempts: retries, retryFailureRate },
          { id: "respond", kind: "respond" },
        ],
      }],
    },
  };
  const db = {
    id: "db",
    type: "component",
    position: { x: 100, y: 0 },
    data: {
      componentId: "sql-db",
      label: "Items DB",
      category: "storage",
      replicas: 1,
      maxQPS,
      latencyMs: 5,
      scalable: false,
      tables: [{
        id: "items-table",
        name: "items",
        estimatedRows: 1_000_000,
        columns: [{ id: "item-id", name: "id", dataType: "UUID", nullable: false, primaryKey: true }],
        indexes: [{ id: "items-name", name: "items_name_idx", columns: ["name"], unique: false }],
        ...(partitioning ? { partitioning } : {}),
      }],
    },
  };
  return {
    nodes: [app, db],
    edges: [{ id: "app-db", source: "app", target: "db" }],
    faults: fault ? { db: fault } : {},
  };
}

test("database write work exposes index cost and expected retry-attempt amplification", () => {
  const baseline = makeDatabaseWriteWorkDesign({});
  const retrying = makeDatabaseWriteWorkDesign({ retries: 2, retryFailureRate: 0.5 });
  const baselineResult = runSimulation(baseline.nodes, baseline.edges, 1000);
  const retryResult = runSimulation(retrying.nodes, retrying.edges, 1000);

  // One maintained index at a 1M-row depth has modeled cost 1.3. Two retries
  // with p=0.5 yield 1 + 0.5 + 0.25 = 1.75 expected attempts.
  assert.equal(baselineResult.nodeMetrics.get("db").databaseWriteWorkQPS, 1300);
  assert.equal(retryResult.nodeMetrics.get("db").databaseWriteWorkQPS, 2275);
  assert.equal(retryResult.nodeMetrics.get("db").databaseReadWorkQPS, 0);
  assert.ok(retryResult.failedOperationsPerSec > 0);
});

test("database write work includes attempts against a down target without implying successful commits", () => {
  const design = makeDatabaseWriteWorkDesign({ retries: 2, retryFailureRate: 0, fault: { mode: "down" } });
  const result = runSimulation(design.nodes, design.edges, 1000, design.faults);
  const dbMetrics = result.nodeMetrics.get("db");

  assert.ok(Math.abs(dbMetrics.databaseWriteWorkQPS - 3900) < 1e-9);
  assert.equal(dbMetrics.failedQPS, 1000);
  assert.equal(result.failedOperationsPerSec, 1000);
  assert.equal(result.throughput, 0);
});

test("database hash partition estimates compare modeled table work without changing aggregate simulation", () => {
  const options = {
    partitioning: {
      strategy: "hash",
      keyColumn: "id",
      shardCount: 16,
      hotKeyTrafficShare: 0.2,
      estimatedWorkCapacityPerShard: 300,
    },
  };
  const partitioned = makeDatabaseWriteWorkDesign(options);
  const baseline = makeDatabaseWriteWorkDesign({});
  const partitionedResult = runSimulation(partitioned.nodes, partitioned.edges, 1000);
  const baselineResult = runSimulation(baseline.nodes, baseline.edges, 1000);
  const estimate = partitionedResult.nodeMetrics.get("db").estimatedDatabasePartitionWork[0];

  assert.equal(estimate.tableName, "items");
  assert.equal(estimate.modeledReadWorkQPS, 0);
  assert.equal(estimate.modeledWriteWorkQPS, 1300);
  assert.equal(estimate.estimatedHotShardWorkQPS, 325);
  assert.equal(estimate.estimatedUniformShardWorkQPS, 81.25);
  assert.ok(Math.abs(estimate.estimatedHotShardUtilization - (325 / 300)) < 1e-12);
  assert.ok(partitionedResult.warnings.some((warning) => /items.*hot-shard work.*325 work\/sec.*300 work\/sec per-shard capacity.*aggregate database throughput is unchanged/i.test(warning)));
  assert.equal(partitionedResult.throughput, baselineResult.throughput);
  assert.equal(partitionedResult.nodeMetrics.get("db").utilization, baselineResult.nodeMetrics.get("db").utilization);
});

test("database hash partition work estimate is omitted for tables without attributed endpoint work", () => {
  const design = makeDatabaseWriteWorkDesign({
    partitioning: {
      strategy: "hash",
      keyColumn: "id",
      shardCount: 8,
      hotKeyTrafficShare: 0,
      estimatedWorkCapacityPerShard: 1000,
    },
  });
  design.nodes[0].data.endpoints[0].steps = [{ id: "respond", kind: "respond" }];
  const result = runSimulation(design.nodes, design.edges, 1000);
  assert.equal(result.nodeMetrics.get("db").estimatedDatabasePartitionWork, undefined);
});

function makeHashPartitionedDatabaseDesign(partitioning) {
  const app = {
    id: "app",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "app-server",
      label: "Feed API",
      category: "compute",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 1,
      scalable: true,
      endpoints: [{
        id: "feed-read",
        method: "GET",
        path: "/feed",
        steps: [
          { id: "posts-read", kind: "database-read", targetNodeId: "db", target: "posts.authorId" },
          { id: "respond", kind: "respond" },
        ],
      }],
    },
  };
  const db = {
    id: "db",
    type: "component",
    position: { x: 100, y: 0 },
    data: {
      componentId: "sql-db",
      label: "Posts DB",
      category: "storage",
      replicas: 1,
      maxQPS: 5000,
      latencyMs: 5,
      scalable: true,
      tables: [{
        id: "posts-table",
        name: "posts",
        estimatedRows: 1000,
        columns: [{ id: "author-id", name: "authorId", dataType: "TEXT", nullable: false, primaryKey: true }],
        indexes: [],
        partitioning,
      }],
    },
  };
  return { nodes: [app, db], edges: [{ id: "app-db", source: "app", target: "db" }] };
}

test("hash-partition simulation warns on estimated hot-shard skew without changing throughput", () => {
  const uniform = makeHashPartitionedDatabaseDesign({
    strategy: "hash",
    keyColumn: "authorId",
    shardCount: 16,
    hotKeyTrafficShare: 0,
  });
  const uniformResult = runSimulation(uniform.nodes, uniform.edges, 1000);
  assert.equal(uniformResult.warnings.some((warning) => /hottest shard/i.test(warning)), false);

  const skewed = makeHashPartitionedDatabaseDesign({
    strategy: "hash",
    keyColumn: "authorId",
    shardCount: 16,
    hotKeyTrafficShare: 0.2,
  });
  const skewedResult = runSimulation(skewed.nodes, skewed.edges, 1000);
  assert.equal(skewedResult.throughput, uniformResult.throughput);
  assert.ok(skewedResult.warnings.some((warning) => /shard containing the hottest key is expected to receive about 25\.0%.*6\.3% under uniform keys.*throughput is unchanged/i.test(warning)));
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
  partitionCounts = {},
  hotPartitionShares = {},
  retentionHoursByTopic = {},
  averageMessageSizeBytesByTopic = {},
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
    topics: topicNames.map((name, index) => ({
      id: `topic-${index}`,
      name,
      ...(Object.hasOwn(partitionCounts, name) ? { partitionCount: partitionCounts[name] } : {}),
      ...(Object.hasOwn(hotPartitionShares, name) ? { estimatedHotPartitionTrafficShare: hotPartitionShares[name] } : {}),
      ...(Object.hasOwn(retentionHoursByTopic, name) ? { retentionHours: retentionHoursByTopic[name] } : {}),
      ...(Object.hasOwn(averageMessageSizeBytesByTopic, name) ? { estimatedAverageMessageSizeBytes: averageMessageSizeBytesByTopic[name] } : {}),
    })),
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

test("queue reports per-topic backlog growth and depth using each topic's estimated processing rate", () => {
  const design = makeTopicQueueDesign({
    publishers: [
      { topicName: "orders", trafficWeight: 3 },
      { topicName: "metrics", trafficWeight: 1 },
    ],
    subscriptions: [
      { consumerIndex: 0, topicName: "orders" },
      { consumerIndex: 1, topicName: "metrics" },
    ],
    consumerCapacities: [300, 300],
    averageMessageSizeBytesByTopic: { orders: 2048 },
  });
  const short = runSimulation(design.nodes, design.edges, 1000, {}, 10);
  const long = runSimulation(design.nodes, design.edges, 1000, {}, 20);
  const estimates = short.nodeMetrics.get("queue").estimatedQueueTopicBacklog;
  const orders = estimates.find(({ topicName }) => topicName === "orders");
  const metrics = estimates.find(({ topicName }) => topicName === "metrics");

  assert.deepEqual(orders, {
    topicName: "orders",
    acceptedMessagesPerSec: 750,
    estimatedProcessedMessagesPerSec: 300,
    estimatedBacklogGrowthPerSec: 450,
    estimatedBacklogDepth: 4500,
    estimatedBacklogPayloadBytes: 9_216_000,
  });
  assert.deepEqual(metrics, {
    topicName: "metrics",
    acceptedMessagesPerSec: 250,
    estimatedProcessedMessagesPerSec: 250,
    estimatedBacklogGrowthPerSec: 0,
    estimatedBacklogDepth: 0,
  });
  assert.equal(short.nodeMetrics.get("queue").queueBacklogQPS, 450);
  assert.equal(short.nodeMetrics.get("queue").queueDepth, 4500);
  assert.equal(long.nodeMetrics.get("queue").estimatedQueueTopicBacklog.find(({ topicName }) => topicName === "orders").estimatedBacklogDepth, 9000);
  assert.equal(long.nodeMetrics.get("queue").estimatedQueueTopicBacklog.find(({ topicName }) => topicName === "orders").estimatedBacklogPayloadBytes, 18_432_000);
  assert.equal(long.throughput, short.throughput);
});

test("queue retry estimate reports attempts, successes, and exhaustion without changing simulation rates", () => {
  const design = makeTopicQueueDesign({
    publishers: [{ topicName: "orders" }],
    subscriptions: [{ consumerIndex: 0, topicName: "orders" }],
    consumerCapacities: [10000],
  });
  const topic = design.nodes.find(({ id }) => id === "queue").data.queueConfig.topics[0];
  const baseline = runSimulation(design.nodes, design.edges, 1000);
  assert.equal(baseline.nodeMetrics.get("queue").estimatedQueueTopicBacklog[0].estimatedRetryAttemptsPerSec, undefined);

  topic.estimatedFailureRatePerAttempt = 0.5;
  topic.maxDeliveryRetries = 2;
  const retryResult = runSimulation(design.nodes, design.edges, 1000);
  const estimate = retryResult.nodeMetrics.get("queue").estimatedQueueTopicBacklog[0];
  assert.equal(estimate.estimatedDeliveryAttemptsPerSec, 1750);
  assert.equal(estimate.estimatedRetryAttemptsPerSec, 750);
  assert.equal(estimate.estimatedSuccessfulDeliveriesPerSec, 875);
  assert.equal(estimate.estimatedExhaustedDeliveriesPerSec, 125);
  assert.equal(estimate.estimatedRetryWaitMsPerDelivery, undefined);
  assert.equal(retryResult.nodeMetrics.get("queue").queueBacklogQPS, baseline.nodeMetrics.get("queue").queueBacklogQPS);
  assert.equal(retryResult.nodeMetrics.get("queue").queueDepth, baseline.nodeMetrics.get("queue").queueDepth);
  assert.equal(retryResult.nodeMetrics.get("consumer-0").incomingQPS, baseline.nodeMetrics.get("consumer-0").incomingQPS);
  assert.equal(retryResult.nodeMetrics.get("consumer-0").utilization, baseline.nodeMetrics.get("consumer-0").utilization);
  assert.equal(retryResult.throughput, baseline.throughput);

  topic.estimatedRetryBackoffMs = 250;
  const withBackoff = runSimulation(design.nodes, design.edges, 1000);
  assert.equal(withBackoff.nodeMetrics.get("queue").estimatedQueueTopicBacklog[0].estimatedRetryWaitMsPerDelivery, 187.5);
  assert.equal(withBackoff.totalLatencyMs, baseline.totalLatencyMs);
  assert.equal(withBackoff.throughput, baseline.throughput);
});

test("queue retry estimate handles zero retries and certain failure without inventing success", () => {
  const design = makeTopicQueueDesign({
    publishers: [{ topicName: "orders" }],
    subscriptions: [{ consumerIndex: 0, topicName: "orders" }],
    consumerCapacities: [10000],
  });
  const topic = design.nodes.find(({ id }) => id === "queue").data.queueConfig.topics[0];

  topic.estimatedFailureRatePerAttempt = 0;
  topic.maxDeliveryRetries = 3;
  const noFailures = runSimulation(design.nodes, design.edges, 1000).nodeMetrics.get("queue").estimatedQueueTopicBacklog[0];
  assert.equal(noFailures.estimatedDeliveryAttemptsPerSec, 1000);
  assert.equal(noFailures.estimatedRetryAttemptsPerSec, 0);
  assert.equal(noFailures.estimatedSuccessfulDeliveriesPerSec, 1000);
  assert.equal(noFailures.estimatedExhaustedDeliveriesPerSec, 0);
  topic.estimatedRetryBackoffMs = 500;
  assert.equal(runSimulation(design.nodes, design.edges, 1000).nodeMetrics.get("queue").estimatedQueueTopicBacklog[0].estimatedRetryWaitMsPerDelivery, 0);

  topic.estimatedFailureRatePerAttempt = 1;
  topic.maxDeliveryRetries = 0;
  const certainFailure = runSimulation(design.nodes, design.edges, 1000).nodeMetrics.get("queue").estimatedQueueTopicBacklog[0];
  assert.equal(certainFailure.estimatedDeliveryAttemptsPerSec, 1000);
  assert.equal(certainFailure.estimatedRetryAttemptsPerSec, 0);
  assert.equal(certainFailure.estimatedSuccessfulDeliveriesPerSec, 0);
  assert.equal(certainFailure.estimatedExhaustedDeliveriesPerSec, 1000);
  assert.equal(certainFailure.estimatedRetryWaitMsPerDelivery, 0);
});

test("queue backlog payload estimate is omitted without a size assumption and skips overflow", () => {
  const design = makeTopicQueueDesign({
    publishers: [{ topicName: "orders" }],
    subscriptions: [],
  });
  const withoutSize = runSimulation(design.nodes, design.edges, 1000, {}, 5);
  assert.equal(withoutSize.nodeMetrics.get("queue").estimatedQueueTopicBacklog[0].estimatedBacklogPayloadBytes, undefined);

  design.nodes.find(({ id }) => id === "queue").data.queueConfig.topics[0].estimatedAverageMessageSizeBytes = Number.MAX_VALUE;
  const overflow = runSimulation(design.nodes, design.edges, 1000, {}, Number.MAX_VALUE);
  assert.equal(overflow.nodeMetrics.get("queue").estimatedQueueTopicBacklog[0].estimatedBacklogPayloadBytes, undefined);
});

test("unsubscribed configured topic projects all accepted topic traffic as backlog", () => {
  const design = makeTopicQueueDesign({
    publishers: [{ topicName: "orphan-events" }],
    subscriptions: [],
  });
  const result = runSimulation(design.nodes, design.edges, 1000, {}, 5);
  const estimate = result.nodeMetrics.get("queue").estimatedQueueTopicBacklog[0];

  assert.equal(estimate.acceptedMessagesPerSec, 1000);
  assert.equal(estimate.estimatedProcessedMessagesPerSec, 0);
  assert.equal(estimate.estimatedBacklogGrowthPerSec, 1000);
  assert.equal(estimate.estimatedBacklogDepth, 5000);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, 1000);
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

test("configured topic partitions cap competing-consumer backlog drain by replica parallelism", () => {
  const design = makeTopicQueueDesign({
    publishers: [{ topicName: "orders" }],
    subscriptions: [
      { consumerIndex: 0, topicName: "orders" },
      { consumerIndex: 1, topicName: "orders" },
    ],
    consumerCapacities: [300, 300],
    partitionCounts: { orders: 1 },
  });
  for (const consumer of design.nodes.filter(({ id }) => id.startsWith("consumer-"))) {
    consumer.data.replicas = 2;
  }

  const result = runSimulation(design.nodes, design.edges, 1000, {}, 10);
  assert.equal(result.nodeMetrics.get("consumer-0").incomingQPS, 500);
  assert.equal(result.nodeMetrics.get("consumer-1").incomingQPS, 500);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, 700);
  assert.equal(result.nodeMetrics.get("queue").queueDepth, 7000);
  assert.ok(result.warnings.some((warning) => /orders.*1 partitions for 4 competing-consumer replica slots.*partition parallelism/i.test(warning)));
});

test("partition cap is optional and stops limiting when partitions cover replica slots", () => {
  const makeDesign = (partitionCounts) => {
    const design = makeTopicQueueDesign({
      publishers: [{ topicName: "orders" }],
      subscriptions: [
        { consumerIndex: 0, topicName: "orders" },
        { consumerIndex: 1, topicName: "orders" },
      ],
      consumerCapacities: [300, 300],
      partitionCounts,
    });
    for (const consumer of design.nodes.filter(({ id }) => id.startsWith("consumer-"))) {
      consumer.data.replicas = 2;
    }
    return design;
  };

  const withoutSetting = makeDesign({});
  const withoutSettingResult = runSimulation(withoutSetting.nodes, withoutSetting.edges, 1000);
  assert.equal(withoutSettingResult.nodeMetrics.get("queue").queueBacklogQPS, 0);

  const withEnoughPartitions = makeDesign({ orders: 4 });
  const enoughPartitionsResult = runSimulation(withEnoughPartitions.nodes, withEnoughPartitions.edges, 1000);
  assert.equal(enoughPartitionsResult.nodeMetrics.get("queue").queueBacklogQPS, 0);
});

test("uniform hottest-partition share preserves the partition-only drain estimate", () => {
  const makeDesign = (hotPartitionShares = {}) => {
    const design = makeTopicQueueDesign({
      publishers: [{ topicName: "orders" }],
      subscriptions: [{ consumerIndex: 0, topicName: "orders" }, { consumerIndex: 1, topicName: "orders" }],
      consumerCapacities: [300, 300],
      partitionCounts: { orders: 4 },
      hotPartitionShares,
    });
    for (const consumer of design.nodes.filter(({ id }) => id.startsWith("consumer-"))) consumer.data.replicas = 2;
    return design;
  };

  const legacy = makeDesign();
  const uniform = makeDesign({ orders: 0.25 });
  assert.equal(runSimulation(legacy.nodes, legacy.edges, 1000).nodeMetrics.get("queue").queueBacklogQPS, 0);
  assert.equal(runSimulation(uniform.nodes, uniform.edges, 1000).nodeMetrics.get("queue").queueBacklogQPS, 0);
});

test("estimated hot-partition skew reduces competing-consumer drain and reports its assumption", () => {
  const design = makeTopicQueueDesign({
    publishers: [{ topicName: "orders" }],
    subscriptions: [{ consumerIndex: 0, topicName: "orders" }, { consumerIndex: 1, topicName: "orders" }],
    consumerCapacities: [300, 300],
    partitionCounts: { orders: 4 },
    hotPartitionShares: { orders: 0.5 },
  });
  for (const consumer of design.nodes.filter(({ id }) => id.startsWith("consumer-"))) consumer.data.replicas = 2;

  const result = runSimulation(design.nodes, design.edges, 1000, {}, 10);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, 400);
  assert.equal(result.nodeMetrics.get("queue").queueDepth, 4000);
  assert.equal(result.nodeMetrics.get("queue").estimatedQueueTopicBacklog[0].estimatedProcessedMessagesPerSec, 600);
  assert.equal(result.nodeMetrics.get("queue").estimatedQueueTopicBacklog[0].estimatedBacklogGrowthPerSec, 400);
  assert.ok(result.warnings.some((warning) => /orders.*50\.0%.*busiest partition.*directional skew estimate/i.test(warning)));
});

test("broadcast topic delivery ignores the competing-consumer hot-partition estimate", () => {
  const design = makeTopicQueueDesign({
    publishers: [{ topicName: "orders" }],
    subscriptions: [{ consumerIndex: 0, topicName: "orders" }, { consumerIndex: 1, topicName: "orders" }],
    deliveryMode: "broadcast",
    partitionCounts: { orders: 1 },
    hotPartitionShares: { orders: 0.9 },
  });
  const result = runSimulation(design.nodes, design.edges, 1000);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, 0);
  assert.equal(result.warnings.some((warning) => /busiest partition/i.test(warning)), false);
});

test("queue retained-payload estimate uses accepted rate, average size, and retention", () => {
  const design = makeTopicQueueDesign({
    publishers: [{ topicName: "orders" }],
    subscriptions: [{ consumerIndex: 0, topicName: "orders" }],
    consumerCapacities: [10000],
    retentionHoursByTopic: { orders: 24 },
    averageMessageSizeBytesByTopic: { orders: 512 },
  });
  const result = runSimulation(design.nodes, design.edges, 100);
  const estimate = result.nodeMetrics.get("queue").estimatedQueueTopicStorage[0];

  assert.deepEqual(estimate, {
    topicName: "orders",
    acceptedMessagesPerSec: 100,
    estimatedAverageMessageSizeBytes: 512,
    retentionHours: 24,
    estimatedRetainedPayloadBytes: 4_423_680_000,
  });
});

test("queue retained-payload estimates are topic-specific and do not alter throughput or backlog", () => {
  const makeDesign = (withEstimates) => makeTopicQueueDesign({
    publishers: [{ topicName: "orders", trafficWeight: 3 }, { topicName: "audit", trafficWeight: 1 }],
    subscriptions: [{ consumerIndex: 0, topicName: "orders" }, { consumerIndex: 0, topicName: "audit" }],
    consumerCapacities: [10000],
    ...(withEstimates ? {
      retentionHoursByTopic: { orders: 24, audit: 48 },
      averageMessageSizeBytesByTopic: { orders: 512, audit: 128 },
    } : {}),
  });
  const withoutEstimates = makeDesign(false);
  const configured = makeDesign(true);
  const baseline = runSimulation(withoutEstimates.nodes, withoutEstimates.edges, 1000);
  const result = runSimulation(configured.nodes, configured.edges, 1000);
  const estimates = result.nodeMetrics.get("queue").estimatedQueueTopicStorage;

  assert.equal(estimates.length, 2);
  assert.deepEqual(estimates.map(({ topicName, acceptedMessagesPerSec, estimatedRetainedPayloadBytes }) => ({ topicName, acceptedMessagesPerSec, estimatedRetainedPayloadBytes })), [
    { topicName: "orders", acceptedMessagesPerSec: 750, estimatedRetainedPayloadBytes: 750 * 512 * 24 * 3600 },
    { topicName: "audit", acceptedMessagesPerSec: 250, estimatedRetainedPayloadBytes: 250 * 128 * 48 * 3600 },
  ]);
  assert.equal(result.throughput, baseline.throughput);
  assert.equal(result.nodeMetrics.get("queue").queueBacklogQPS, baseline.nodeMetrics.get("queue").queueBacklogQPS);
});

test("queue retained-payload estimate is omitted without explicit topic rate or required settings", () => {
  const legacy = makeQueueDesign({ consumerCapacities: [10000] });
  const legacyResult = runSimulation(legacy.nodes, legacy.edges, 100);
  assert.equal(legacyResult.nodeMetrics.get("queue").estimatedQueueTopicStorage, undefined);

  for (const configuration of [
    { retentionHoursByTopic: { orders: 24 } },
    { averageMessageSizeBytesByTopic: { orders: 512 } },
  ]) {
    const design = makeTopicQueueDesign({
      publishers: [{ topicName: "orders" }],
      subscriptions: [{ consumerIndex: 0, topicName: "orders" }],
      consumerCapacities: [10000],
      ...configuration,
    });
    assert.equal(runSimulation(design.nodes, design.edges, 100).nodeMetrics.get("queue").estimatedQueueTopicStorage, undefined);
  }
});

test("queue retained-payload estimate skips arithmetic overflow", () => {
  const design = makeTopicQueueDesign({
    publishers: [{ topicName: "orders" }],
    subscriptions: [{ consumerIndex: 0, topicName: "orders" }],
    consumerCapacities: [10000],
    retentionHoursByTopic: { orders: Number.MAX_VALUE },
    averageMessageSizeBytesByTopic: { orders: Number.MAX_VALUE },
  });
  const result = runSimulation(design.nodes, design.edges, 100);
  assert.equal(result.nodeMetrics.get("queue").estimatedQueueTopicStorage, undefined);
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
  assert.equal(result.nodeMetrics.get("queue").estimatedQueueTopicBacklog[0].estimatedProcessedMessagesPerSec, 400);
  assert.equal(result.nodeMetrics.get("queue").estimatedQueueTopicBacklog[0].estimatedBacklogDepth, 6000);
});

test("topic partition count does not cap broadcast delivery", () => {
  const { nodes, edges } = makeTopicQueueDesign({
    publishers: [{ topicName: "orders" }],
    subscriptions: [
      { consumerIndex: 0, topicName: "orders" },
      { consumerIndex: 1, topicName: "orders" },
    ],
    consumerCapacities: [1000, 400],
    deliveryMode: "broadcast",
    partitionCounts: { orders: 1 },
  });
  const result = runSimulation(nodes, edges, 1000, {}, 10);
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
