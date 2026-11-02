import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const compilerPath = new URL("../src/engine/compiler.ts", import.meta.url);
const compilerSource = await readFile(compilerPath, "utf8");
const { outputText } = ts.transpileModule(compilerSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
});
const compilerUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
const { compileDesign } = await import(compilerUrl);

function makeDesign() {
  const app = {
    id: "app-1",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "app-server",
      label: "URL Service",
      icon: "Server",
      category: "compute",
      replicas: 2,
      maxQPS: 5000,
      latencyMs: 10,
      scalable: true,
      endpoints: [
        {
          id: "get-url",
          method: "GET",
          path: "/:code",
          trafficWeight: 100,
          steps: [
            { id: "read-url", kind: "database-read", targetNodeId: "db-1", target: "urls.shortCode" },
            { id: "get-response", kind: "respond" },
          ],
        },
        {
          id: "post-url",
          method: "POST",
          path: "/urls",
          trafficWeight: 1,
          steps: [
            { id: "write-url", kind: "database-write", targetNodeId: "db-1", target: "urls.shortCode,longUrl" },
            { id: "post-response", kind: "respond" },
          ],
        },
      ],
    },
  };
  const gateway = {
    id: "gateway-1",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "api-gateway",
      label: "API Gateway",
      icon: "Network",
      category: "networking",
      replicas: 1,
      maxQPS: 50000,
      latencyMs: 2,
      scalable: true,
      routes: [
        { id: "route-get", method: "GET", path: "/:code", backendNodeId: "app-1", trafficWeight: 100 },
        { id: "route-post", method: "POST", path: "/urls", backendNodeId: "app-1", trafficWeight: 1 },
      ],
    },
  };
  const cache = {
    id: "cache-1",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "cache",
      label: "Redis",
      icon: "Database",
      category: "storage",
      replicas: 1,
      maxQPS: 100000,
      latencyMs: 1,
      scalable: true,
    },
  };
  const database = {
    id: "db-1",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "nosql-db",
      label: "URLs DB",
      icon: "Database",
      category: "storage",
      replicas: 1,
      maxQPS: 50000,
      latencyMs: 5,
      scalable: true,
      tables: [{
        id: "urls-table",
        name: "urls",
        estimatedRows: 1000,
        columns: [
          { id: "short-code", name: "shortCode", dataType: "TEXT", nullable: false, primaryKey: true },
          { id: "long-url", name: "longUrl", dataType: "TEXT", nullable: false, primaryKey: false },
        ],
        indexes: [],
      }],
    },
  };
  const edge = (id, source, target) => ({ id, source, target, type: "animated" });
  return {
    nodes: [gateway, app, cache, database],
    edges: [
      edge("gateway-app", "gateway-1", "app-1"),
      edge("app-cache", "app-1", "cache-1"),
      edge("app-db", "app-1", "db-1"),
    ],
  };
}

function diagnosticCodes(result) {
  return result.diagnostics.map(({ code }) => code);
}

function addQueueToDesign(design, retentionHours = 168) {
  const queue = {
    id: "queue-1",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "message-queue",
      label: "Events Queue",
      icon: "Queue",
      category: "messaging",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 2,
      scalable: true,
      queueConfig: { topics: [{ id: "topic-1", name: "url-created", retentionHours }] },
    },
  };
  const consumer = {
    id: "consumer-1",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "app-server",
      label: "Analytics Consumer",
      icon: "Server",
      category: "compute",
      replicas: 1,
      maxQPS: 10000,
      latencyMs: 3,
      scalable: true,
      endpoints: [{ id: "consumer-endpoint", method: "POST", path: "/events", steps: [{ id: "consumer-response", kind: "respond" }] }],
    },
  };
  design.nodes.push(queue, consumer);
  design.edges.push(
    { id: "app-queue", source: "app-1", target: "queue-1" },
    { id: "queue-consumer", source: "queue-1", target: "consumer-1" },
  );
  design.nodes[1].data.endpoints[1].steps.splice(1, 0, {
    id: "publish-url-created",
    kind: "publish-event",
    targetNodeId: "queue-1",
    target: "url-created",
  });
  return queue;
}

test("compiles the URL Shortener Gateway → endpoint → schema contract", () => {
  const { nodes, edges } = makeDesign();
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, true);
  assert.equal(result.errorCount, 0);
  assert.equal(result.warningCount, 0);
});

test("blocks a Gateway route that does not match a backend endpoint", () => {
  const { nodes, edges } = makeDesign();
  nodes[0].data.routes[0].path = "/wrong-path";
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("GATEWAY_BACKEND_ENDPOINT_NOT_FOUND"));
});

test("blocks duplicate Gateway method/path routes", () => {
  const { nodes, edges } = makeDesign();
  nodes[0].data.routes.push({ ...nodes[0].data.routes[0], id: "route-get-duplicate" });
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("GATEWAY_ROUTE_DUPLICATE"));
});

test("blocks Gateway backends that are not directly connected", () => {
  const { nodes, edges } = makeDesign();
  const result = compileDesign(nodes, edges.filter((edge) => edge.id !== "gateway-app"));
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("GATEWAY_BACKEND_NOT_CONNECTED"));
});

test("requires routes when a Gateway fronts contracted App Server endpoints", () => {
  const { nodes, edges } = makeDesign();
  nodes[0].data.routes = [];
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("GATEWAY_ROUTES_REQUIRED"));
});

test("blocks database read and write mappings when a referenced column is removed", () => {
  const { nodes, edges } = makeDesign();
  nodes[3].data.tables[0].columns = nodes[3].data.tables[0].columns.filter((column) => column.name !== "longUrl");
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("DB_COLUMN_NOT_FOUND"));
});

test("accepts time-series databases as App Server read and write targets", () => {
  const { nodes, edges } = makeDesign();
  nodes[3].data.componentId = "timeseries-db";
  nodes[3].data.label = "Metrics DB";
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
});

test("blocks App Servers that have no endpoints", () => {
  const { nodes, edges } = makeDesign();
  nodes[1].data.endpoints = [];
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("APP_ENDPOINT_REQUIRED"));
});

test("blocks malformed endpoint conditions", () => {
  const { nodes, edges } = makeDesign();
  nodes[1].data.endpoints[0].steps.unshift({ id: "bad-validation", kind: "validate", condition: "userId ==" });
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("ENDPOINT_CONDITION_INVALID"));
});

test("accepts condition identifiers declared in the endpoint request contract", () => {
  const { nodes, edges } = makeDesign();
  nodes[1].data.endpoints[0].requestFields = [
    { id: "region-field", name: "region", type: "string", location: "query" },
  ];
  nodes[1].data.endpoints[0].steps.unshift({
    id: "region-validation",
    kind: "validate",
    condition: "region == 'eu' || region == 'us'",
  });
  assert.equal(compileDesign(nodes, edges).ok, true);
});

test("blocks condition identifiers missing from a declared request contract", () => {
  const { nodes, edges } = makeDesign();
  nodes[1].data.endpoints[0].requestFields = [];
  nodes[1].data.endpoints[0].steps.unshift({
    id: "region-validation",
    kind: "validate",
    condition: "region == 'eu'",
  });
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, false);
  const diagnostic = result.diagnostics.find(({ code }) => code === "ENDPOINT_CONDITION_FIELD_UNKNOWN");
  assert.equal(diagnostic.fieldName, "region");
  assert.equal(diagnostic.stepId, "region-validation");
});

test("condition boolean literals do not require request fields", () => {
  const { nodes, edges } = makeDesign();
  nodes[1].data.endpoints[0].requestFields = [];
  nodes[1].data.endpoints[0].steps.unshift({
    id: "literal-validation",
    kind: "validate",
    condition: "true == true && false == false",
  });
  assert.equal(compileDesign(nodes, edges).ok, true);
});

test("blocks duplicate endpoint contract fields", () => {
  const { nodes, edges } = makeDesign();
  nodes[1].data.endpoints[0].requestFields = [
    { id: "region-a", name: "region", type: "string", location: "query" },
    { id: "region-b", name: "region", type: "number", location: "body" },
  ];
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("ENDPOINT_FIELD_DUPLICATE"));
});

test("blocks unsupported endpoint contract field types", () => {
  const { nodes, edges } = makeDesign();
  nodes[1].data.endpoints[0].responseFields = [
    { id: "bad-type", name: "result", type: "object" },
  ];
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("ENDPOINT_FIELD_TYPE_INVALID"));
});

test("warns when a request profile omits a declared field used by a condition", () => {
  const { nodes, edges } = makeDesign();
  nodes[1].data.endpoints[0].requestFields = [
    { id: "region-field", name: "region", type: "string", location: "query" },
  ];
  nodes[1].data.endpoints[0].steps.unshift({
    id: "region-validation",
    kind: "validate",
    condition: "region == 'eu'",
  });
  const result = compileDesign(nodes, edges, [
    { name: "profile without region", trafficWeight: 1, attributes: {} },
  ]);
  assert.equal(result.ok, true);
  const diagnostic = result.diagnostics.find(({ code }) => code === "REQUEST_PROFILE_FIELD_MISSING");
  assert.equal(diagnostic.fieldName, "region");
  assert.equal(diagnostic.profileName, "profile without region");
});

test("does not warn when request profiles provide the condition field", () => {
  const { nodes, edges } = makeDesign();
  nodes[1].data.endpoints[0].requestFields = [
    { id: "region-field", name: "region", type: "string", location: "query" },
  ];
  nodes[1].data.endpoints[0].steps.unshift({
    id: "region-validation",
    kind: "validate",
    condition: "region == 'eu'",
  });
  const result = compileDesign(nodes, edges, [
    { name: "EU", trafficWeight: 1, attributes: { region: "eu" } },
  ]);
  assert.equal(result.ok, true);
  assert.ok(!diagnosticCodes(result).includes("REQUEST_PROFILE_FIELD_MISSING"));
});

test("reports an unindexed lookup as a non-blocking warning", () => {
  const { nodes, edges } = makeDesign();
  nodes[3].data.tables[0].columns[0].primaryKey = false;
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, true);
  assert.equal(result.warningCount, 1);
  assert.ok(diagnosticCodes(result).includes("DB_READ_INDEX_MISSING"));
});

test("blocks invalid Redis memory and TTL configuration", () => {
  const { nodes, edges } = makeDesign();
  nodes[2].data.cacheConfig = { maxMemoryMB: 0, defaultTtlSeconds: -1, evictionPolicy: "unknown" };
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("CACHE_MEMORY_INVALID"));
  assert.ok(diagnosticCodes(result).includes("CACHE_TTL_INVALID"));
  assert.ok(diagnosticCodes(result).includes("CACHE_EVICTION_POLICY_INVALID"));
});

test("keeps an unconfigured legacy cache non-blocking", () => {
  const { nodes, edges } = makeDesign();
  const result = compileDesign(nodes, edges);
  assert.equal(result.ok, true);
  assert.equal(result.errorCount, 0);
});

test("validates configured rate-limit quota and per-key population", () => {
  const { nodes, edges } = makeDesign();
  const limiter = {
    id: "limiter-1",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId: "rate-limiter",
      label: "API Rate Limiter",
      icon: "ShieldAlert",
      category: "networking",
      replicas: 1,
      maxQPS: 80000,
      latencyMs: 1,
      scalable: true,
      rateLimiterConfig: {
        algorithm: "token-bucket",
        keyBy: "client-id",
        requestsPerWindow: 100,
        windowSeconds: 60,
        estimatedDistinctKeys: 500,
        burstCapacity: 200,
      },
    },
  };
  nodes.push(limiter);

  assert.equal(compileDesign(nodes, edges).ok, true);

  limiter.data.rateLimiterConfig = {
    algorithm: "unknown",
    keyBy: "user-agent",
    requestsPerWindow: 0,
    windowSeconds: -2,
    estimatedDistinctKeys: 1.5,
    burstCapacity: 0,
  };
  const invalid = compileDesign(nodes, edges);
  assert.equal(invalid.ok, false);
  for (const code of [
    "RATE_LIMIT_ALGORITHM_INVALID",
    "RATE_LIMIT_KEY_INVALID",
    "RATE_LIMIT_QUOTA_INVALID",
    "RATE_LIMIT_WINDOW_INVALID",
    "RATE_LIMIT_KEY_COUNT_INVALID",
    "RATE_LIMIT_BURST_INVALID",
  ]) {
    assert.ok(diagnosticCodes(invalid).includes(code), `Expected ${code}`);
  }
});

test("validates published topic names against configured queue topics", () => {
  const design = makeDesign();
  const queue = addQueueToDesign(design);
  queue.data.queueConfig.topics[0].name = "other-topic";
  const result = compileDesign(design.nodes, design.edges);
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("QUEUE_TOPIC_NOT_FOUND"));
});

test("warns when a configured queue topic has no publish-event producer", () => {
  const design = makeDesign();
  addQueueToDesign(design);
  const publisher = design.nodes[1].data.endpoints.find(({ id }) => id === "post-url");
  publisher.steps = publisher.steps.filter(({ kind }) => kind !== "publish-event");
  const result = compileDesign(design.nodes, design.edges);
  assert.equal(result.ok, true);
  assert.ok(diagnosticCodes(result).includes("QUEUE_TOPIC_NO_PRODUCERS"));
});

test("blocks invalid queue retention and warns on short retention", () => {
  const invalidDesign = makeDesign();
  addQueueToDesign(invalidDesign, 0);
  const invalidResult = compileDesign(invalidDesign.nodes, invalidDesign.edges);
  assert.equal(invalidResult.ok, false);
  assert.ok(diagnosticCodes(invalidResult).includes("QUEUE_RETENTION_INVALID"));

  const shortDesign = makeDesign();
  addQueueToDesign(shortDesign, 12);
  const shortResult = compileDesign(shortDesign.nodes, shortDesign.edges);
  assert.equal(shortResult.ok, true);
  assert.ok(diagnosticCodes(shortResult).includes("QUEUE_RETENTION_SHORT"));
});

test("blocks non-positive or fractional queue partition counts", () => {
  for (const partitionCount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const design = makeDesign();
    const queue = addQueueToDesign(design);
    queue.data.queueConfig.topics[0].partitionCount = partitionCount;
    const result = compileDesign(design.nodes, design.edges);
    assert.equal(result.ok, false, `partitionCount=${partitionCount} should be rejected`);
    assert.ok(diagnosticCodes(result).includes("QUEUE_PARTITION_COUNT_INVALID"));
  }

  const validDesign = makeDesign();
  const queue = addQueueToDesign(validDesign);
  queue.data.queueConfig.topics[0].partitionCount = 8;
  const validResult = compileDesign(validDesign.nodes, validDesign.edges);
  assert.equal(validResult.ok, true);
  assert.equal(diagnosticCodes(validResult).includes("QUEUE_PARTITION_COUNT_INVALID"), false);
});

test("validates hottest-partition queue traffic estimates against partition count", () => {
  const designForTopic = (partitionCount, estimatedHotPartitionTrafficShare) => {
    const design = makeDesign();
    const queue = addQueueToDesign(design);
    queue.data.queueConfig.topics[0] = {
      id: "topic-1",
      name: "url-created",
      ...(partitionCount === undefined ? {} : { partitionCount }),
      estimatedHotPartitionTrafficShare,
    };
    return compileDesign(design.nodes, design.edges);
  };

  for (const [partitionCount, share] of [[4, 0], [4, -0.1], [4, 1.01], [4, 0.2]]) {
    const result = designForTopic(partitionCount, share);
    assert.ok(diagnosticCodes(result).includes("QUEUE_HOT_PARTITION_SHARE_INVALID"), `${partitionCount} partitions, ${share} share`);
  }

  const missingPartitionCount = designForTopic(undefined, 0.5);
  assert.ok(diagnosticCodes(missingPartitionCount).includes("QUEUE_HOT_PARTITION_SHARE_REQUIRES_PARTITIONS"));

  const uniformBoundary = designForTopic(4, 0.25);
  assert.equal(diagnosticCodes(uniformBoundary).includes("QUEUE_HOT_PARTITION_SHARE_INVALID"), false);
  const validSkew = designForTopic(4, 0.5);
  assert.equal(diagnosticCodes(validSkew).includes("QUEUE_HOT_PARTITION_SHARE_INVALID"), false);
});

test("validates optional queue average message-size estimates", () => {
  for (const sizeBytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "512"]) {
    const design = makeDesign();
    const queue = addQueueToDesign(design);
    queue.data.queueConfig.topics[0].estimatedAverageMessageSizeBytes = sizeBytes;
    const result = compileDesign(design.nodes, design.edges);
    assert.ok(diagnosticCodes(result).includes("QUEUE_MESSAGE_SIZE_INVALID"), `sizeBytes=${sizeBytes}`);
  }

  const validDesign = makeDesign();
  const queue = addQueueToDesign(validDesign);
  queue.data.queueConfig.topics[0].estimatedAverageMessageSizeBytes = 512;
  const result = compileDesign(validDesign.nodes, validDesign.edges);
  assert.equal(diagnosticCodes(result).includes("QUEUE_MESSAGE_SIZE_INVALID"), false);
});

test("validates paired queue retry-estimate assumptions and their bounds", () => {
  const designFor = (estimatedFailureRatePerAttempt, maxDeliveryRetries) => {
    const design = makeDesign();
    const queue = addQueueToDesign(design);
    Object.assign(queue.data.queueConfig.topics[0], {
      estimatedFailureRatePerAttempt,
      maxDeliveryRetries,
    });
    return compileDesign(design.nodes, design.edges);
  };

  const incomplete = designFor(0.1, undefined);
  assert.ok(diagnosticCodes(incomplete).includes("QUEUE_RETRY_ESTIMATE_INCOMPLETE"));
  for (const failureRate of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.1"]) {
    assert.ok(diagnosticCodes(designFor(failureRate, 3)).includes("QUEUE_RETRY_FAILURE_RATE_INVALID"));
  }
  for (const retries of [-1, 1.5, 6, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.ok(diagnosticCodes(designFor(0.1, retries)).includes("QUEUE_RETRY_COUNT_INVALID"));
  }
  for (const [failureRate, retries] of [[0, 0], [1, 5], [0.1, 3]]) {
    const result = designFor(failureRate, retries);
    assert.equal(diagnosticCodes(result).includes("QUEUE_RETRY_FAILURE_RATE_INVALID"), false);
    assert.equal(diagnosticCodes(result).includes("QUEUE_RETRY_COUNT_INVALID"), false);
    assert.equal(diagnosticCodes(result).includes("QUEUE_RETRY_ESTIMATE_INCOMPLETE"), false);
  }
});

test("validates optional fixed retry backoff assumptions", () => {
  const designFor = (retryConfig) => {
    const design = makeDesign();
    const queue = addQueueToDesign(design);
    Object.assign(queue.data.queueConfig.topics[0], retryConfig);
    return compileDesign(design.nodes, design.edges);
  };

  for (const delayMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, "250"]) {
    assert.ok(diagnosticCodes(designFor({ estimatedFailureRatePerAttempt: 0.1, maxDeliveryRetries: 3, estimatedRetryBackoffMs: delayMs })).includes("QUEUE_RETRY_BACKOFF_INVALID"));
  }
  assert.ok(diagnosticCodes(designFor({ estimatedRetryBackoffMs: 250 })).includes("QUEUE_RETRY_BACKOFF_REQUIRES_RETRY_ESTIMATE"));
  for (const delayMs of [0, 250]) {
    const result = designFor({ estimatedFailureRatePerAttempt: 0.1, maxDeliveryRetries: 3, estimatedRetryBackoffMs: delayMs });
    assert.equal(diagnosticCodes(result).includes("QUEUE_RETRY_BACKOFF_INVALID"), false);
    assert.equal(diagnosticCodes(result).includes("QUEUE_RETRY_BACKOFF_REQUIRES_RETRY_ESTIMATE"), false);
  }
});

test("validates table hash-partition keys, shard counts, strategies, and skew inputs", () => {
  const invalidCases = [
    [{ strategy: "hash", keyColumn: "missing", shardCount: 16, hotKeyTrafficShare: 0.2 }, "DB_PARTITION_KEY_MISSING"],
    [{ strategy: "range", keyColumn: "shortCode", shardCount: 16, hotKeyTrafficShare: 0.2 }, "DB_PARTITION_STRATEGY_INVALID"],
    [{ strategy: "hash", keyColumn: "shortCode", shardCount: 1.5, hotKeyTrafficShare: 0.2 }, "DB_PARTITION_COUNT_INVALID"],
    [{ strategy: "hash", keyColumn: "shortCode", shardCount: 16, hotKeyTrafficShare: 1.1 }, "DB_PARTITION_HOT_KEY_SHARE_INVALID"],
    [{ strategy: "hash", keyColumn: "shortCode", shardCount: 16, hotKeyTrafficShare: 0.1, estimatedWorkCapacityPerShard: 0 }, "DB_PARTITION_WORK_CAPACITY_INVALID"],
    [{ strategy: "hash", keyColumn: "shortCode", shardCount: 16, hotKeyTrafficShare: 0.1, estimatedWorkCapacityPerShard: Number.POSITIVE_INFINITY }, "DB_PARTITION_WORK_CAPACITY_INVALID"],
  ];
  for (const [partitioning, expectedCode] of invalidCases) {
    const design = makeDesign();
    design.nodes.find(({ id }) => id === "db-1").data.tables[0].partitioning = partitioning;
    const result = compileDesign(design.nodes, design.edges);
    assert.equal(result.ok, false);
    assert.ok(diagnosticCodes(result).includes(expectedCode), `Expected ${expectedCode}`);
  }

  const validDesign = makeDesign();
  validDesign.nodes.find(({ id }) => id === "db-1").data.tables[0].partitioning = {
    strategy: "hash",
    keyColumn: "shortCode",
    shardCount: 16,
    hotKeyTrafficShare: 0.2,
    estimatedWorkCapacityPerShard: 2000,
  };
  const validResult = compileDesign(validDesign.nodes, validDesign.edges);
  assert.equal(validResult.ok, true);
  assert.equal(diagnosticCodes(validResult).some((code) => code.startsWith("DB_PARTITION_")), false);
});

test("validates estimated read-replica count without requiring a replication topology", () => {
  for (const estimatedReadReplicaCount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const design = makeDesign();
    design.nodes.find(({ id }) => id === "db-1").data.databaseReplicationEstimate = { estimatedReadReplicaCount };
    const result = compileDesign(design.nodes, design.edges);
    assert.equal(result.ok, false, `estimatedReadReplicaCount=${estimatedReadReplicaCount} should be rejected`);
    assert.ok(diagnosticCodes(result).includes("DB_READ_REPLICA_ESTIMATE_INVALID"));
  }

  const validDesign = makeDesign();
  validDesign.nodes.find(({ id }) => id === "db-1").data.databaseReplicationEstimate = { estimatedReadReplicaCount: 2 };
  const validResult = compileDesign(validDesign.nodes, validDesign.edges);
  assert.equal(validResult.ok, true);
  assert.equal(diagnosticCodes(validResult).includes("DB_READ_REPLICA_ESTIMATE_INVALID"), false);
});

test("validates the estimated read-work share assigned to additional copies", () => {
  for (const estimatedReadTrafficToReplicasShare of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    const design = makeDesign();
    design.nodes.find(({ id }) => id === "db-1").data.databaseReplicationEstimate = {
      estimatedReadReplicaCount: 2,
      estimatedReadTrafficToReplicasShare,
    };
    const result = compileDesign(design.nodes, design.edges);
    assert.equal(result.ok, false, `estimatedReadTrafficToReplicasShare=${estimatedReadTrafficToReplicasShare} should be rejected`);
    assert.ok(diagnosticCodes(result).includes("DB_READ_REPLICA_SHARE_INVALID"));
  }

  for (const estimatedReadTrafficToReplicasShare of [0, 0.8, 1]) {
    const design = makeDesign();
    design.nodes.find(({ id }) => id === "db-1").data.databaseReplicationEstimate = {
      estimatedReadReplicaCount: 2,
      estimatedReadTrafficToReplicasShare,
    };
    const result = compileDesign(design.nodes, design.edges);
    assert.equal(result.ok, true, `estimatedReadTrafficToReplicasShare=${estimatedReadTrafficToReplicasShare} should be accepted`);
    assert.equal(diagnosticCodes(result).includes("DB_READ_REPLICA_SHARE_INVALID"), false);
  }
});

test("validates non-negative replication-lag and read-staleness estimates", () => {
  const cases = [
    ["estimatedReplicationLagMs", "DB_REPLICATION_LAG_ESTIMATE_INVALID"],
    ["maximumToleratedReadStalenessMs", "DB_READ_STALENESS_BUDGET_INVALID"],
  ];
  for (const [field, diagnosticCode] of cases) {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const design = makeDesign();
      design.nodes.find(({ id }) => id === "db-1").data.databaseReplicationEstimate = {
        estimatedReadReplicaCount: 2,
        [field]: value,
      };
      const result = compileDesign(design.nodes, design.edges);
      assert.equal(result.ok, false, `${field}=${value} should be rejected`);
      assert.ok(diagnosticCodes(result).includes(diagnosticCode));
    }
    for (const value of [0, 500]) {
      const design = makeDesign();
      design.nodes.find(({ id }) => id === "db-1").data.databaseReplicationEstimate = {
        estimatedReadReplicaCount: 2,
        [field]: value,
      };
      const result = compileDesign(design.nodes, design.edges);
      assert.equal(result.ok, true, `${field}=${value} should be accepted`);
    }
  }
});

test("accepts an explicit subscription from a configured topic to a connected consumer", () => {
  const design = makeDesign();
  const queue = addQueueToDesign(design);
  queue.data.queueConfig.subscriptions = [{
    id: "sub-created-analytics",
    consumerNodeId: "consumer-1",
    topicName: "url-created",
  }];
  const result = compileDesign(design.nodes, design.edges);
  assert.equal(result.ok, true);
  assert.equal(result.warningCount, 0);
});

test("blocks subscriptions to missing topics and disconnected consumers", () => {
  const design = makeDesign();
  const queue = addQueueToDesign(design);
  queue.data.queueConfig.subscriptions = [{
    id: "sub-invalid",
    consumerNodeId: "app-1",
    topicName: "missing-topic",
  }];
  const result = compileDesign(design.nodes, design.edges);
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("QUEUE_SUBSCRIPTION_TOPIC_NOT_FOUND"));
  assert.ok(diagnosticCodes(result).includes("QUEUE_SUBSCRIPTION_CONSUMER_NOT_CONNECTED"));
});

test("rejects duplicate subscriptions and warns on unmapped topics or consumers", () => {
  const duplicateDesign = makeDesign();
  const duplicateQueue = addQueueToDesign(duplicateDesign);
  duplicateQueue.data.queueConfig.subscriptions = [
    { id: "sub-1", consumerNodeId: "consumer-1", topicName: "url-created" },
    { id: "sub-2", consumerNodeId: "consumer-1", topicName: "url-created" },
  ];
  const duplicateResult = compileDesign(duplicateDesign.nodes, duplicateDesign.edges);
  assert.equal(duplicateResult.ok, false);
  assert.ok(diagnosticCodes(duplicateResult).includes("QUEUE_SUBSCRIPTION_DUPLICATE"));

  const unmappedDesign = makeDesign();
  const unmappedQueue = addQueueToDesign(unmappedDesign);
  unmappedQueue.data.queueConfig.subscriptions = [];
  const unmappedResult = compileDesign(unmappedDesign.nodes, unmappedDesign.edges);
  assert.equal(unmappedResult.ok, true);
  assert.ok(diagnosticCodes(unmappedResult).includes("QUEUE_TOPIC_NO_SUBSCRIBERS"));
  assert.ok(diagnosticCodes(unmappedResult).includes("QUEUE_CONSUMER_NO_SUBSCRIPTIONS"));
});
