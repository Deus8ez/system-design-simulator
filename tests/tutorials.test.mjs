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
const customProblemStoreUrl = asDataUrl(
  "export const useCustomProblemsStore = { getState: () => ({}) };",
  "customProblemsStore.ts",
);
const resolvedProblemCatalogSource = problemCatalogSource.replace(
  'from "@/store/customProblemsStore"',
  `from "${customProblemStoreUrl}"`,
);
const problemCatalogUrl = asDataUrl(resolvedProblemCatalogSource, "problems.ts");
const engineConstantsUrl = asDataUrl(await readSource("src/engine/constants.ts"), "constants.ts");
const resolvedTracksSource = tracksSource.replace(
  'from "@/data/problems"',
  `from "${problemCatalogUrl}"`,
).replace('from "@/engine/constants"', `from "${engineConstantsUrl}"`);
const tracksUrl = asDataUrl(resolvedTracksSource, "tutorialTracks.ts");
const resolvedTutorialsSource = tutorialsSource.replace(
  'from "@/data/tutorialTracks"',
  `from "${tracksUrl}"`,
);
const [{ SYSTEM_TUTORIALS, TUTORIAL_BY_PROBLEM_ID }, evaluator] = await Promise.all([
  import(asDataUrl(resolvedTutorialsSource, "tutorials.ts")),
  readSource("src/lib/tutorialEvaluator.ts").then((source) => import(asDataUrl(source, "tutorialEvaluator.ts"))),
]);
const { PROBLEMS } = await import(problemCatalogUrl);
const { MAX_SIMULATION_QPS, MIN_SIMULATION_QPS } = await import(engineConstantsUrl);
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

function makePassingObjectiveContext(objective) {
  const nodesByComponent = new Map();
  const edges = [];
  const addNode = (componentId, data = {}) => {
    const node = nodesByComponent.get(componentId) ?? makeNode(`node-${componentId}`, componentId);
    node.data = { ...node.data, ...data };
    nodesByComponent.set(componentId, node);
    return node;
  };
  const connect = (sourceComponentId, targetComponentId, data = {}) => {
    const source = nodesByComponent.get(sourceComponentId) ?? addNode(sourceComponentId);
    const target = nodesByComponent.get(targetComponentId) ?? addNode(targetComponentId);
    edges.push(makeEdge(source.id, target.id, data));
  };

  switch (objective.kind) {
    case "components-and-edges":
      for (const required of objective.components) {
        addNode(required.componentId, { replicas: required.replicas ?? 1 });
      }
      for (const edge of [...(objective.edges ?? []), ...(objective.forbiddenEdges ?? []).map(({ sourceComponentId, targetComponentId }) => ({ sourceComponentId, targetComponentId }))]) {
        addNode(edge.sourceComponentId);
        addNode(edge.targetComponentId);
      }
      for (const edge of objective.edges ?? []) connect(edge.sourceComponentId, edge.targetComponentId);
      break;
    case "endpoint-contracts": {
      const service = addNode(objective.serviceComponentId);
      const gateway = objective.gatewayComponentId ? addNode(objective.gatewayComponentId) : undefined;
      const endpoints = objective.contracts.map((contract) => ({
        method: contract.method,
        path: contract.path,
        steps: contract.steps.map((step) => {
          const target = step.targetComponentId ? nodesByComponent.get(step.targetComponentId) ?? addNode(step.targetComponentId) : undefined;
          return { kind: step.kind, targetNodeId: target?.id, target: step.target };
        }),
      }));
      service.data.endpoints = endpoints;
      if (gateway) {
        edges.push(makeEdge(gateway.id, service.id));
        gateway.data.routes = objective.contracts.map((contract) => ({ method: contract.method, path: contract.path, backendNodeId: service.id }));
      }
      for (const edge of objective.asyncEdges ?? []) {
        const source = nodesByComponent.get(edge.sourceComponentId) ?? addNode(edge.sourceComponentId);
        const target = nodesByComponent.get(edge.targetComponentId) ?? addNode(edge.targetComponentId);
        edges.push(makeEdge(source.id, target.id, { async: true }));
      }
      break;
    }
    case "database-schema":
      addNode(objective.databaseComponentId, { tables: [{
        name: objective.tableName,
        columns: objective.columns.map((name) => ({ name })),
        indexes: (objective.indexedColumns ?? []).map((name) => ({ columns: [name] })),
      }] });
      break;
    case "cache-behavior": {
      const service = addNode(objective.serviceComponentId, { endpoints: [
        { method: objective.readEndpoint.method, path: objective.readEndpoint.path, steps: [{ kind: "cache-read", targetNodeId: "node-cache" }] },
        { method: objective.writeEndpoint.method, path: objective.writeEndpoint.path, steps: objective.requireInvalidation === false ? [] : [{ kind: "cache-invalidate", targetNodeId: "node-cache" }] },
      ] });
      const cache = addNode(objective.cacheComponentId, { cacheConfig: objective.ttlSeconds === undefined ? undefined : { defaultTtlSeconds: objective.ttlSeconds } });
      edges.push(makeEdge(service.id, cache.id));
      break;
    }
    case "queue-contract": {
      const service = addNode(objective.serviceComponentId);
      const queue = addNode(objective.queueComponentId, {
        queueDeliveryMode: objective.deliveryMode,
        queueConfig: {
          topics: [{ name: objective.topicName }],
          subscriptions: [{ topicName: objective.topicName, consumerNodeId: `node-${objective.consumerComponentId}` }],
        },
      });
      const consumer = addNode(objective.consumerComponentId);
      const producer = objective.producerEndpoint ?? { method: "POST", path: "/events" };
      service.data.endpoints = [{ method: producer.method, path: producer.path, steps: [{ kind: "publish-event", targetNodeId: queue.id, target: objective.topicName }] }];
      edges.push(makeEdge(service.id, queue.id, objective.requireAsync ? { async: true } : {}), makeEdge(queue.id, consumer.id));
      break;
    }
    case "queue-setup": {
      const queue = addNode(objective.queueComponentId, {
        queueDeliveryMode: objective.deliveryMode,
        queueConfig: {
          topics: [{ name: objective.topicName }],
          subscriptions: [{ topicName: objective.topicName, consumerNodeId: `node-${objective.consumerComponentId}` }],
        },
      });
      const consumer = addNode(objective.consumerComponentId);
      edges.push(makeEdge(queue.id, consumer.id));
      break;
    }
    case "rate-limit-policy":
      addNode(objective.componentId, { replicas: objective.minimumReplicas ?? 1, rateLimiterConfig: {
        algorithm: objective.algorithm,
        keyBy: objective.keyBy,
        requestsPerWindow: objective.minimumRequestsPerWindow,
        windowSeconds: objective.windowSeconds,
        estimatedDistinctKeys: objective.minimumDistinctKeys,
      } });
      for (const edge of objective.requiredEdges ?? []) connect(edge.sourceComponentId, edge.targetComponentId);
      break;
    case "replicas":
      for (const requirement of objective.components) addNode(requirement.componentId, { replicas: requirement.minimum });
      break;
    case "compile-ready":
      break;
    case "simulation-checkpoint":
      break;
  }

  const nodes = [...nodesByComponent.values()];
  const signature = getTutorialDesignSignature(nodes, edges);
  const timestamp = 42;
  return {
    nodes,
    edges,
    compilation: objective.kind === "compile-ready" ? { ok: true, diagnostics: [] } : undefined,
    simulation: objective.kind === "simulation-checkpoint" ? {
      result: { timestamp },
      requestsPerSec: objective.requestsPerSec,
      recordedRequestsPerSec: objective.requestsPerSec,
      recordedSignature: signature,
      recordedTimestamp: timestamp,
      currentSignature: signature,
    } : undefined,
  };
}

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
      assert.ok(level.requestsPerSec >= MIN_SIMULATION_QPS && level.requestsPerSec <= MAX_SIMULATION_QPS);
    }
    if (!new Set(["url-shortener", "video-streaming", "rate-limiter"]).has(tutorial.problemId)) {
      const problem = PROBLEMS.find((item) => item.id === tutorial.problemId);
      const highQps = Math.max(problem.requirements.readsPerSec, problem.requirements.writesPerSec);
      assert.equal(tutorial.levels[0].requestsPerSec, Math.max(MIN_SIMULATION_QPS, Math.ceil(highQps * 0.01)));
      assert.equal(tutorial.levels[1].requestsPerSec, Math.max(tutorial.levels[0].requestsPerSec + 1, Math.ceil(highQps * 0.1)));
      assert.equal(tutorial.levels[2].requestsPerSec, highQps);
    }
    const availableEndpoints = new Set();
    for (const level of tutorial.levels) {
      assert.ok(level.requestsPerSec > 0);
      assert.ok(level.steps.length > 0);
      assert.ok(level.steps.some((step) => step.objective.kind === "simulation-checkpoint" && step.objective.requestsPerSec === level.requestsPerSec), `${tutorial.problemId}/${level.id} needs a simulation checkpoint at its advertised load`);
      for (const step of level.steps) {
        assert.ok(step.prompt.length > 20, `${step.id} needs an actionable prompt`);
        assert.ok(step.why.length > 20, `${step.id} needs a rationale`);
        assert.ok(step.tradeoff.length > 20, `${step.id} needs a trade-off explanation`);
        const objectiveText = JSON.stringify(step.objective);
        for (const [, componentId] of objectiveText.matchAll(/"(?:componentId|sourceComponentId|targetComponentId|serviceComponentId|gatewayComponentId|databaseComponentId|cacheComponentId|queueComponentId|consumerComponentId)":"([^"]+)"/g)) {
          assert.ok(builtInComponentIds.has(componentId), `${step.id} references unknown component ${componentId}`);
        }
        if (step.objective.kind === "queue-contract" && step.objective.producerEndpoint) {
          const producer = `${step.objective.producerEndpoint.method} ${step.objective.producerEndpoint.path}`;
          assert.ok(availableEndpoints.has(producer), `${step.id} requires a producer endpoint defined in an earlier tutorial step: ${producer}`);
        }
        if (step.objective.kind === "endpoint-contracts") {
          for (const contract of step.objective.contracts) {
            availableEndpoints.add(`${contract.method} ${contract.path}`);
          }
        }
        if (step.objective.kind === "simulation-checkpoint") {
          assert.equal(step.objective.requestsPerSec, level.requestsPerSec, `${step.id} checkpoint must match its level's stated load`);
        }
      }
    }
  }
  assert.equal(new Set(allStepIds).size, allStepIds.length, "tutorial step IDs must be unique across the full catalog");
});

test("every authored tutorial objective has a satisfiable positive example", () => {
  for (const tutorial of SYSTEM_TUTORIALS) {
    for (const level of tutorial.levels) {
      for (const step of level.steps) {
        const context = makePassingObjectiveContext(step.objective);
        const result = evaluateTutorialObjective(step.objective, context);
        assert.equal(result.complete, true, `${tutorial.problemId}/${level.id}/${step.id}: ${result.feedback}`);
      }
    }
  }
});

test("Rate Limiter traffic instructions match their configured scenarios", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("rate-limiter");
  const medium = tutorial.levels.find((level) => level.id === "medium");
  const high = tutorial.levels.find((level) => level.id === "high");
  assert.match(medium.steps.find((step) => step.objective.kind === "simulation-checkpoint").prompt, /5,000 requests\/sec/);
  assert.match(high.steps[0].prompt, /50,000 requests\/sec/);
});

test("Video Streaming API lesson explains the response step required to compile endpoints", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("video-streaming");
  const endpointStep = tutorial.levels.find((level) => level.id === "low").steps
    .find((step) => step.objective.kind === "endpoint-contracts");
  assert.match(endpointStep.prompt, /finish both endpoint pipelines with Return response/i);
});

test("numeric traffic directions match their simulation checkpoint load", () => {
  for (const tutorial of SYSTEM_TUTORIALS) {
    for (const level of tutorial.levels) {
      for (const step of level.steps) {
        const mentionedLoads = [...step.prompt.matchAll(/Run(?: the)?\s+([\d,]+)\s+requests\/sec\b|([\d,]+)\s+requests\/sec\s+scenario\b/gi)]
          .map(([, runValue, scenarioValue]) => Number((runValue ?? scenarioValue).replaceAll(",", "")));
        for (const mentionedLoad of mentionedLoads) {
          assert.equal(mentionedLoad, level.requestsPerSec, `${tutorial.problemId}/${level.id}/${step.id} prompt load must match its level scenario`);
        }
      }
    }
  }
});

test("component and edge objectives report specific missing work", () => {
  const missingGateway = check({
    kind: "components-and-edges",
    components: [{ componentId: "api-gateway" }],
  });
  assert.equal(missingGateway.feedback, "Add the API Gateway component.");

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

test("endpoint objectives can require asynchronous component edges", () => {
  const service = makeNode("app", "app-server", { endpoints: [{
    method: "POST",
    path: "/complete",
    steps: [{ kind: "publish-event", targetNodeId: "queue", target: "jobs" }, { kind: "respond" }],
  }] });
  const queue = makeNode("queue", "message-queue");
  const objective = {
    kind: "endpoint-contracts",
    serviceComponentId: "app-server",
    asyncEdges: [{ sourceComponentId: "app-server", targetComponentId: "message-queue" }],
    contracts: [{ method: "POST", path: "/complete", steps: [{ kind: "publish-event", targetComponentId: "message-queue", target: "jobs" }] }],
  };
  assert.equal(check(objective, [service, queue], [makeEdge("app", "queue", { async: true })]).complete, true);
  assert.match(check(objective, [service, queue], [makeEdge("app", "queue")]).feedback, /asynchronous/);
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

test("queue setup objective validates topic, subscription, delivery mode, and consumer wiring without requiring a publisher", () => {
  const queue = makeNode("queue", "message-queue", { queueDeliveryMode: "competing", queueConfig: {
    topics: [{ name: "video-transcoding" }],
    subscriptions: [{ topicName: "video-transcoding", consumerNodeId: "worker" }],
  } });
  const worker = makeNode("worker", "stream-processor");
  const objective = { kind: "queue-setup", queueComponentId: "message-queue", consumerComponentId: "stream-processor", topicName: "video-transcoding", deliveryMode: "competing" };
  assert.equal(check(objective, [queue, worker], [makeEdge("queue", "worker")]).complete, true);
  assert.equal(check(objective, [queue, worker], []).complete, false);
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
  const validProof = { result, requestsPerSec: 100, recordedRequestsPerSec: 100, recordedSignature: signature, recordedTimestamp: 1234, currentSignature: signature };
  assert.equal(check(objective, nodes, edges, { simulation: validProof }).complete, true);
  assert.equal(check(objective, nodes, edges, { simulation: { ...validProof, recordedRequestsPerSec: 10 } }).complete, false);
  assert.equal(check(objective, nodes, edges, { simulation: { ...validProof, recordedSignature: "stale" } }).complete, false);
  const withRuntimeMetrics = [{ ...nodes[0], data: { ...nodes[0].data, utilization: 0.7, status: "warning", isBottleneck: true } }];
  assert.equal(getTutorialDesignSignature(nodes, edges), getTutorialDesignSignature(withRuntimeMetrics, edges));
  assert.notEqual(getTutorialDesignSignature(nodes, edges), getTutorialDesignSignature([{ ...nodes[0], data: { ...nodes[0].data, replicas: 2 } }], edges));
});
