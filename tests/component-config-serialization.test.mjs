import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/componentConfigSerialization.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
const { normalizeComponentConfiguration, serializeComponentConfiguration } = await import(moduleUrl);

test("component runtime configuration survives serialize and import normalization", () => {
  const original = {
    endpoints: [{
      id: "endpoint-read",
      method: "GET",
      path: "/items/:id",
      trafficWeight: 3,
      requestFields: [{ id: "item-id-request", name: "id", type: "string", location: "path" }],
      responseFields: [{ id: "item-title-response", name: "title", type: "string" }],
      steps: [
        { id: "cache-step", kind: "cache-read", targetNodeId: "cache-1", target: "item:{id}", cacheHitRate: 0.8 },
        { id: "reply-step", kind: "respond" },
      ],
    }],
    routes: [{
      id: "gateway-read",
      method: "GET",
      path: "/items/:id",
      backendNodeId: "app-1",
      trafficWeight: 2,
    }],
    cacheConfig: {
      maxMemoryMB: 2048,
      defaultTtlSeconds: 300,
      evictionPolicy: "allkeys-lru",
    },
    tables: [{
      id: "items-table",
      name: "items",
      estimatedRows: 50000,
      columns: [
        { id: "item-id", name: "id", dataType: "UUID", nullable: false, primaryKey: true },
        { id: "item-title", name: "title", dataType: "TEXT", nullable: false, primaryKey: false },
      ],
      indexes: [{ id: "items-id-index", name: "items_id_idx", columns: ["id"], unique: true }],
    }],
    queueConfig: {
      topics: [{ id: "topic-created", name: "item-created", retentionHours: 240 }],
      subscriptions: [{
        id: "subscription-created-analytics",
        consumerNodeId: "analytics-worker",
        topicName: "item-created",
      }],
    },
    queueDeliveryMode: "competing",
    rateLimiterConfig: {
      algorithm: "token-bucket",
      keyBy: "client-id",
      requestsPerWindow: 50,
      windowSeconds: 1,
      estimatedDistinctKeys: 1000,
      burstCapacity: 100,
    },
  };

  const exported = serializeComponentConfiguration(original);
  const imported = normalizeComponentConfiguration(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(JSON.parse(JSON.stringify(imported)), JSON.parse(JSON.stringify(exported)));
});

test("legacy components without runtime configuration remain importable with legacy defaults", () => {
  const imported = normalizeComponentConfiguration({ componentId: "app-server", label: "Legacy" });
  assert.equal(imported.endpoints, undefined);
  assert.equal(imported.routes, undefined);
  assert.equal(imported.cacheConfig, undefined);
  assert.equal(imported.tables, undefined);
  assert.equal(imported.queueConfig, undefined);
  assert.equal(imported.queueDeliveryMode, "broadcast");
  assert.equal(imported.rateLimiterConfig, undefined);
});

test("import normalization preserves invalid gateway route method for compiler diagnostics", () => {
  const imported = normalizeComponentConfiguration({
    routes: [{ id: "bad-method", method: "TRACE", path: "/items", backendNodeId: "app-1" }],
  });
  assert.equal(imported.routes[0].method, "TRACE");
});

test("import normalization preserves unsupported field types for compiler diagnostics", () => {
  const imported = normalizeComponentConfiguration({
    endpoints: [{
      id: "endpoint-bad-type",
      method: "POST",
      path: "/items",
      responseFields: [{ id: "payload", name: "payload", type: "object" }],
      steps: [{ id: "respond", kind: "respond" }],
    }],
  });
  assert.equal(imported.endpoints[0].responseFields[0].type, "object");
});

test("import normalization keeps malformed queue subscriptions repairable", () => {
  const imported = normalizeComponentConfiguration({
    queueConfig: {
      topics: [{ id: "topic-created", name: "item-created" }],
      subscriptions: [null],
    },
  });
  assert.deepEqual(imported.queueConfig.subscriptions, [{
    id: "subscription-0",
    consumerNodeId: "",
    topicName: "",
  }]);
});
