import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

function asDataUrl(source, fileName) {
  const output = ts.transpileModule(source, {
    fileName,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [tutorialsSource, tracksSource, problemCatalogSource, componentCatalogSource] = await Promise.all([
  readSource("src/data/tutorials.ts"),
  readSource("src/data/tutorialTracks.ts"),
  readSource("src/data/problems.ts"),
  readSource("src/data/components.ts"),
]);
const tracksUrl = asDataUrl(tracksSource, "tutorialTracks.ts");
const resolvedTutorialsSource = tutorialsSource.replace(
  'from "@/data/tutorialTracks"',
  `from "${tracksUrl}"`,
);
const [{ SYSTEM_TUTORIALS, TUTORIAL_BY_PROBLEM_ID }, evaluator] = await Promise.all([
  import(asDataUrl(resolvedTutorialsSource, "tutorials.ts")),
  readSource("src/lib/tutorialEvaluator.ts").then((source) => import(asDataUrl(source, "tutorialEvaluator.ts"))),
]);
const { evaluateTutorialObjective, getTutorialDesignSignature } = evaluator;
const builtInProblemIds = [...problemCatalogSource.matchAll(/^    id: "([^"]+)"/gm)].map(([, id]) => id);
const builtInComponentIds = new Set([...componentCatalogSource.matchAll(/^    id: "([^"]+)"/gm)].map(([, id]) => id));

const makeNode = (id, componentId, data = {}) => ({
  id,
  type: "component",
  position: { x: 0, y: 0 },
  data: {
    componentId,
    label: componentId,
    icon: "Server",
    category: "compute",
    replicas: 1,
    maxQPS: 1000,
    latencyMs: 1,
    scalable: true,
    ...data,
  },
});
const makeEdge = (source, target, data = {}) => ({ id: `${source}-${target}`, source, target, data });
const check = (objective, nodes = [], edges = [], extra = {}) =>
  evaluateTutorialObjective(objective, { nodes, edges, ...extra });

test("every built-in problem has three progressive, reasoned tutorial levels", () => {
  assert.deepEqual([...TUTORIAL_BY_PROBLEM_ID.keys()].sort(), [...builtInProblemIds].sort());
  const allStepIds = [];
  for (const tutorial of SYSTEM_TUTORIALS) {
    assert.equal(tutorial.levels.length, 3);
    assert.deepEqual(tutorial.levels.map(({ id }) => id), ["low", "medium", "high"]);
    assert.ok(tutorial.learningObjectives.length >= 2);
    const stepIds = tutorial.levels.flatMap((level) => level.steps.map((step) => step.id));
    assert.equal(new Set(stepIds).size, stepIds.length, `${tutorial.problemId} has duplicate tutorial steps`);
    allStepIds.push(...stepIds);
    assert.ok(tutorial.levels[0].requestsPerSec < tutorial.levels[1].requestsPerSec);
    assert.ok(tutorial.levels[1].requestsPerSec < tutorial.levels[2].requestsPerSec);
    for (const level of tutorial.levels) {
      assert.ok(level.requestsPerSec > 0);
      assert.ok(level.steps.length > 0);
      for (const step of level.steps) {
        assert.ok(step.prompt.length > 20, `${step.id} needs an actionable prompt`);
        assert.ok(step.why.length > 20, `${step.id} needs a rationale`);
        assert.ok(step.tradeoff.length > 20, `${step.id} needs a trade-off explanation`);
        const objectiveText = JSON.stringify(step.objective);
        for (const [, componentId] of objectiveText.matchAll(/"(?:componentId|sourceComponentId|targetComponentId|serviceComponentId|gatewayComponentId|databaseComponentId|cacheComponentId|queueComponentId|consumerComponentId)":"([^"]+)"/g)) {
          assert.ok(builtInComponentIds.has(componentId), `${step.id} references unknown component ${componentId}`);
        }
      }
    }
  }
  assert.equal(new Set(allStepIds).size, allStepIds.length, "tutorial step IDs must be unique across the full catalog");
});

test("component and edge objectives report specific missing work", () => {
  const objective = {
    kind: "components-and-edges",
    components: [{ componentId: "load-balancer" }, { componentId: "app-server", replicas: 2 }],
    edges: [{ sourceComponentId: "load-balancer", targetComponentId: "app-server" }],
  };
  const nodes = [makeNode("lb", "load-balancer"), makeNode("app", "app-server")];
  assert.match(check(objective, nodes).feedback, /replicas to at least 2/);
  assert.equal(check(objective, nodes, [makeEdge("lb", "app")]).complete, false);
  nodes[1].data.replicas = 2;
  assert.equal(check(objective, nodes, [makeEdge("lb", "app")]).complete, true);
});

test("endpoint objectives require backend operations and a matching Gateway route", () => {
  const nodes = [
    makeNode("app", "app-server", { endpoints: [{ method: "GET", path: "/:code", steps: [{ kind: "database-read", targetNodeId: "db", target: "urls.shortCode" }] }] }),
    makeNode("gateway", "api-gateway", { routes: [{ method: "GET", path: "/:code", backendNodeId: "app" }] }),
    makeNode("db", "nosql-db"),
  ];
  const objective = {
    kind: "endpoint-contracts",
    serviceComponentId: "app-server",
    gatewayComponentId: "api-gateway",
    contracts: [{ method: "GET", path: "/:code", steps: [{ kind: "database-read", targetComponentId: "nosql-db", target: "urls.shortCode" }] }],
  };
  assert.equal(check(objective, nodes, [makeEdge("gateway", "app")]).complete, true);
  assert.equal(check(objective, nodes).complete, false);
});

test("schema objective checks required columns and indexed lookup", () => {
  const objective = { kind: "database-schema", databaseComponentId: "nosql-db", tableName: "urls", columns: ["shortCode", "longUrl"], indexedColumns: ["shortCode"] };
  const db = makeNode("db", "nosql-db", { tables: [{ name: "urls", columns: [{ name: "shortCode" }, { name: "longUrl" }], indexes: [] }] });
  assert.match(check(objective, [db]).feedback, /index on urls.shortCode/);
  db.data.tables[0].indexes.push({ columns: ["shortCode"] });
  assert.equal(check(objective, [db]).complete, true);
});

test("cache objective separates cache-aside setup from invalidation", () => {
  const nodes = [
    makeNode("app", "app-server", { endpoints: [
      { method: "GET", path: "/:code", steps: [{ kind: "cache-read", targetNodeId: "cache" }] },
      { method: "POST", path: "/urls", steps: [{ kind: "cache-invalidate", targetNodeId: "cache" }] },
    ] }),
    makeNode("cache", "cache", { cacheConfig: { defaultTtlSeconds: 3600 } }),
  ];
  const base = { kind: "cache-behavior", serviceComponentId: "app-server", cacheComponentId: "cache", readEndpoint: { method: "GET", path: "/:code" }, writeEndpoint: { method: "POST", path: "/urls" }, ttlSeconds: 3600 };
  assert.equal(check({ ...base, requireInvalidation: false }, nodes, [makeEdge("app", "cache")]).complete, true);
  assert.equal(check({ ...base, requireInvalidation: true }, nodes, [makeEdge("app", "cache")]).complete, true);
});

test("queue objective requires a configured publisher, subscription, and async path", () => {
  const nodes = [
    makeNode("app", "app-server", { endpoints: [{ method: "POST", path: "/events", steps: [{ kind: "publish-event", targetNodeId: "queue", target: "click-events" }] }] }),
    makeNode("queue", "message-queue", { queueDeliveryMode: "competing", queueConfig: { topics: [{ name: "click-events" }], subscriptions: [{ topicName: "click-events", consumerNodeId: "worker" }] } }),
    makeNode("worker", "stream-processor"),
  ];
  const objective = { kind: "queue-contract", serviceComponentId: "app-server", queueComponentId: "message-queue", consumerComponentId: "stream-processor", topicName: "click-events", deliveryMode: "competing", requireAsync: true };
  const edges = [makeEdge("app", "queue", { async: true }), makeEdge("queue", "worker")];
  assert.equal(check(objective, nodes, edges).complete, true);
  assert.equal(check(objective, nodes, [makeEdge("app", "queue"), edges[1]]).complete, false);
});

test("rate-limit and replica objectives validate configured semantics and placement", () => {
  const nodes = [
    makeNode("lb", "load-balancer"),
    makeNode("limiter", "rate-limiter", { replicas: 2, rateLimiterConfig: { algorithm: "token-bucket", keyBy: "client-id", requestsPerWindow: 100, windowSeconds: 1, estimatedDistinctKeys: 1000 } }),
    makeNode("gateway", "api-gateway"),
  ];
  const policy = { kind: "rate-limit-policy", componentId: "rate-limiter", algorithm: "token-bucket", keyBy: "client-id", minimumRequestsPerWindow: 100, windowSeconds: 1, minimumDistinctKeys: 1000, requiredEdges: [{ sourceComponentId: "load-balancer", targetComponentId: "rate-limiter" }, { sourceComponentId: "rate-limiter", targetComponentId: "api-gateway" }], forbiddenEdges: [{ sourceComponentId: "load-balancer", targetComponentId: "api-gateway" }] };
  assert.equal(check(policy, nodes, [makeEdge("lb", "limiter"), makeEdge("limiter", "gateway")]).complete, true);
  assert.equal(check(policy, nodes, [makeEdge("lb", "limiter"), makeEdge("limiter", "gateway"), makeEdge("lb", "gateway")]).complete, false);
  assert.equal(check({ kind: "replicas", components: [{ componentId: "rate-limiter", minimum: 2 }] }, nodes).complete, true);
});

test("compile and simulation checkpoints require real current-state evidence", () => {
  const nodes = [makeNode("app", "app-server")];
  const edges = [];
  assert.equal(check({ kind: "compile-ready" }, nodes).complete, false);
  assert.equal(check({ kind: "compile-ready" }, nodes, edges, { compilation: { ok: true, diagnostics: [] } }).complete, true);

  const signature = getTutorialDesignSignature(nodes, edges);
  const result = { timestamp: 1234 };
  const objective = { kind: "simulation-checkpoint", requestsPerSec: 100 };
  assert.equal(check(objective, nodes, edges, { simulation: { result, requestsPerSec: 100, recordedSignature: signature, recordedTimestamp: 1234, currentSignature: signature } }).complete, true);
  assert.equal(check(objective, nodes, edges, { simulation: { result, requestsPerSec: 100, recordedSignature: "stale", recordedTimestamp: 1234, currentSignature: signature } }).complete, false);
  const withRuntimeMetrics = [{ ...nodes[0], data: { ...nodes[0].data, utilization: 0.7, status: "warning", isBottleneck: true } }];
  assert.equal(getTutorialDesignSignature(nodes, edges), getTutorialDesignSignature(withRuntimeMetrics, edges));
  assert.notEqual(getTutorialDesignSignature(nodes, edges), getTutorialDesignSignature([{ ...nodes[0], data: { ...nodes[0].data, replicas: 2 } }], edges));
});
