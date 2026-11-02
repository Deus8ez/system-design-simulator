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
const [tutorialsSource, tracksSource, problemCatalogSource, componentCatalogSource, runtimeEditorSource, rightPanelSource, simulationControlsSource, tutorialCoachSource, paletteSource, componentNodeSource, animatedEdgeSource] = await Promise.all([
  readSource("src/data/tutorials.ts"),
  readSource("src/data/tutorialTracks.ts"),
  readSource("src/data/problems.ts"),
  readSource("src/data/components.ts"),
  readSource("src/components/panel/RuntimeModelEditor.tsx"),
  readSource("src/components/panel/RightPanel.tsx"),
  readSource("src/components/panel/SimulationControls.tsx"),
  readSource("src/components/tutorial/TutorialCoach.tsx"),
  readSource("src/components/sidebar/ComponentPalette.tsx"),
  readSource("src/components/canvas/nodes/ComponentNode.tsx"),
  readSource("src/components/canvas/edges/AnimatedEdge.tsx"),
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
const guidanceSource = await readSource("src/lib/tutorialGuidance.ts");
const { getTutorialGuidance } = await import(asDataUrl(guidanceSource, "tutorialGuidance.ts"));
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
    case "database-partitioning":
      addNode(objective.databaseComponentId, { tables: [{
        name: objective.tableName,
        columns: [{ name: objective.keyColumn }],
        indexes: [],
        partitioning: {
          strategy: "hash",
          keyColumn: objective.keyColumn,
          shardCount: objective.minimumShards,
          hotKeyTrafficShare: objective.minimumHotKeyTrafficShare,
          ...(objective.minimumEstimatedWorkCapacityPerShard === undefined ? {} : {
            estimatedWorkCapacityPerShard: objective.minimumEstimatedWorkCapacityPerShard,
          }),
        },
      }] });
      break;
    case "database-read-replicas":
      addNode(objective.databaseComponentId, {
        databaseReplicationEstimate: {
          estimatedReadReplicaCount: objective.minimumReplicas,
          ...(objective.requiredReadTrafficToReplicasShare === undefined ? {} : {
            estimatedReadTrafficToReplicasShare: objective.requiredReadTrafficToReplicasShare,
          }),
          ...(objective.requiredEstimatedReplicationLagMs === undefined ? {} : {
            estimatedReplicationLagMs: objective.requiredEstimatedReplicationLagMs,
          }),
          ...(objective.requiredMaximumToleratedReadStalenessMs === undefined ? {} : {
            maximumToleratedReadStalenessMs: objective.requiredMaximumToleratedReadStalenessMs,
          }),
        },
      });
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
    case "queue-retention":
      addNode(objective.queueComponentId, {
        queueConfig: { topics: [{ name: objective.topicName, retentionHours: objective.minimumRetentionHours }] },
      });
      break;
    case "queue-partitions":
      addNode(objective.queueComponentId, {
        queueConfig: { topics: [{
          name: objective.topicName,
          partitionCount: objective.minimumPartitions,
          ...(objective.minimumHotPartitionTrafficShare === undefined ? {} : { estimatedHotPartitionTrafficShare: objective.minimumHotPartitionTrafficShare }),
          ...(objective.minimumEstimatedAverageMessageSizeBytes === undefined ? {} : { estimatedAverageMessageSizeBytes: objective.minimumEstimatedAverageMessageSizeBytes }),
        }] },
      });
      break;
    case "queue-retry-estimate":
      addNode(objective.queueComponentId, {
        queueConfig: { topics: [{
          name: objective.topicName,
          estimatedFailureRatePerAttempt: objective.assumedFailureRatePerAttempt,
          maxDeliveryRetries: objective.minimumMaxDeliveryRetries,
          estimatedRetryBackoffMs: objective.assumedRetryBackoffMs,
        }] },
      });
      break;
    case "reflection":
      break;
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

test("every tutorial step has detailed, actionable guidance with valid semantic targets", () => {
  const validControls = new Set([
    "endpoint-add", "endpoint-path", "endpoint-pipeline", "gateway-routes", "gateway-route-add", "database-schema", "cache-ttl",
    "queue-topic-add", "queue-topic-name", "queue-topic-retention", "queue-topic-partitions", "queue-subscription-add", "queue-delivery-mode",
    "rate-limit-policy", "simulation-tab", "tutorial-run", "edge-communication", "replicas",
    "database-partitioning-add", "database-partition-key", "database-shard-count", "database-hot-key-share", "database-shard-capacity", "database-read-replica-configure", "database-read-replica-count", "database-read-replica-share", "database-replication-lag", "database-read-staleness-budget",
  ]);
  const targetSources = [runtimeEditorSource, rightPanelSource, simulationControlsSource, tutorialCoachSource];
  const declaredControlIds = targetSources.flatMap((source) =>
    [...source.matchAll(/data-tutorial-target="control:([^"$]+)"/g)].map(([, id]) => id),
  );
  const declaredControlPatterns = targetSources.flatMap((source) =>
    [...source.matchAll(/data-tutorial-target=\{`control:([^$`]+)\$\{([^}]+)\}([^`]*)`\}/g)]
      .map(([, prefix]) => prefix),
  );
  const helperTargets = new Set([
    ...[...runtimeEditorSource.matchAll(/controlTarget\("([^"]+)"\)/g)].map(([, id]) => id),
  ]);
  for (const tutorial of SYSTEM_TUTORIALS) {
    for (const level of tutorial.levels) {
      for (const step of level.steps) {
        const instructions = getTutorialGuidance(step);
        assert.ok(instructions.length > 0, `${tutorial.problemId}/${level.id}/${step.id} needs detailed guidance`);
        for (const instruction of instructions) {
          assert.ok(instruction.instruction.length > 20, `${step.id} guidance must explain a concrete action`);
          if (!instruction.target) continue;
          if (instruction.target.kind === "control") {
            const targetId = instruction.target.id;
            const isDeclared = declaredControlIds.includes(targetId) || helperTargets.has(targetId) ||
              declaredControlPatterns.some((prefix) => targetId.startsWith(prefix));
            assert.ok(validControls.has(targetId) || isDeclared, `${step.id} has unknown control target ${targetId}`);
            assert.ok(isDeclared, `${step.id} target ${targetId} is not declared by a rendered UI control`);
          } else if (instruction.target.kind === "edge") {
            assert.ok(builtInComponentIds.has(instruction.target.sourceComponentId), `${step.id} has unknown edge source component`);
            assert.ok(builtInComponentIds.has(instruction.target.targetComponentId), `${step.id} has unknown edge target component`);
            assert.match(animatedEdgeSource, /data-tutorial-target=\{`edge:/, `${step.id} edge target has no rendered DOM declaration`);
          } else {
            assert.ok(builtInComponentIds.has(instruction.target.componentId), `${step.id} has unknown component target ${instruction.target.componentId}`);
            if (instruction.target.kind === "palette") assert.match(paletteSource, /data-tutorial-target=\{`palette:/);
            if (instruction.target.kind === "node") assert.match(componentNodeSource, /data-tutorial-target=\{tutorialTargetId\}/);
          }
        }
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

test("Message Queue Design teaches deduplication schema without claiming exactly-once behavior", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("message-queue-design");
  const step = tutorial.levels.find((level) => level.id === "medium").steps
    .find((item) => item.id === "message-queue-design-medium-idempotency-record");
  assert.ok(step);
  assert.equal(step.objective.kind, "database-schema");
  assert.deepEqual(step.objective, {
    kind: "database-schema",
    databaseComponentId: "nosql-db",
    tableName: "processed_messages",
    columns: ["messageId", "processedAt"],
    indexedColumns: ["messageId"],
  });
  assert.match(step.tradeoff, /does not model an atomic claim.*exactly-once processing/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("messageId")));

  const db = makeNode("db", "nosql-db", { tables: [{
    name: "processed_messages",
    columns: [{ name: "messageId" }, { name: "processedAt" }],
    indexes: [],
  }] });
  assert.equal(check(step.objective, [db]).complete, false);
  db.data.tables[0].indexes.push({ columns: ["messageId"] });
  assert.equal(check(step.objective, [db]).complete, true);
});

test("Chat System teaches per-conversation ordering scope without claiming queue-order simulation", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("chat-system");
  const medium = tutorial.levels.find((level) => level.id === "medium");
  const workerScaleIndex = medium.steps.findIndex((step) => step.id === "chat-system-medium-worker-scale");
  const orderingIndex = medium.steps.findIndex((step) => step.id === "chat-system-medium-ordering-scope");
  const appScaleIndex = medium.steps.findIndex((step) => step.id === "chat-system-medium-app-scale");
  const step = medium.steps[orderingIndex];

  assert.ok(orderingIndex > workerScaleIndex && orderingIndex < appScaleIndex);
  assert.equal(step.objective.kind, "reflection");
  assert.match(step.prompt, /conversationId.*partition key.*same ordered partition/i);
  assert.match(step.prompt, /not global order.*user-observed effect order/i);
  assert.match(step.prompt, /concurrent producers and retries.*out of order/i);
  assert.match(step.prompt, /hot partition.*throughput and ordering trade-off/i);
  assert.match(step.tradeoff, /self-assessed.*does not model keyed partition assignment.*consumer completion order.*cannot verify message ordering/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("cannot grade the explanation")));
  assert.match(check(step.objective).feedback, /Self-check acknowledged.*does not simulate keyed queue ordering or consumer execution/i);
});

test("Message Queue Design explains checkpoint crash windows and contiguous completion without claiming simulation", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("message-queue-design");
  const medium = tutorial.levels.find((level) => level.id === "medium");
  const idempotencyIndex = medium.steps.findIndex((step) => step.id === "message-queue-design-medium-idempotency-record");
  const checkpointIndex = medium.steps.findIndex((step) => step.id === "message-queue-design-medium-checkpoint-boundary");
  const step = medium.steps[checkpointIndex];

  assert.ok(checkpointIndex > idempotencyIndex);
  assert.equal(step.objective.kind, "reflection");
  assert.match(step.prompt, /consumer group.*topic partition.*next offset/i);
  assert.match(step.prompt, /committing before.*crash can skip.*effect before committing.*redelivery.*duplicate/i);
  assert.match(step.prompt, /contiguous completed offset prefix/i);
  assert.match(step.prompt, /atomic.*transaction.*idempotency/i);
  assert.match(step.tradeoff, /self-assessed.*no message offsets.*crash\/restart state.*cannot verify checkpoint correctness/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("cannot grade the explanation")));
  assert.match(check(step.objective).feedback, /Self-check acknowledged.*does not simulate offsets, acknowledgments, or crash\/restart behavior/i);
});

test("Message Queue Design teaches a scenario-specific retention window", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("message-queue-design");
  const medium = tutorial.levels.find((level) => level.id === "medium");
  const stepIndex = medium.steps.findIndex((item) => item.id === "message-queue-design-medium-recovery-window");
  const idempotencyIndex = medium.steps.findIndex((item) => item.id === "message-queue-design-medium-idempotency-record");
  const step = medium.steps[stepIndex];
  assert.ok(stepIndex > idempotencyIndex);
  assert.equal(step.objective.kind, "queue-retention");
  assert.deepEqual(step.objective, {
    kind: "queue-retention",
    queueComponentId: "message-queue",
    topicName: "message-queue-design-events",
    minimumRetentionHours: 72,
  });
  assert.match(step.tradeoff, /scenario choice.*does not simulate offset rewind.*exactly-once/i);
  assert.ok(getTutorialGuidance(step).some(({ target }) => target?.kind === "control" && target.id === "queue-topic-retention"));

  const objective = step.objective;
  const queueWithTopic = (retentionHours) => makeNode("queue", "message-queue", {
    queueConfig: { topics: [{ name: objective.topicName, retentionHours }] },
  });
  assert.match(check(objective).feedback, /Add a Message Queue/);
  assert.match(check(objective, [makeNode("queue", "message-queue", { queueConfig: { topics: [] } })]).feedback, /Add topic/);
  assert.match(check(objective, [queueWithTopic(undefined)]).feedback, /at least 72 hours/);
  assert.equal(check(objective, [queueWithTopic(24)]).complete, false);
  assert.equal(check(objective, [queueWithTopic(Number.NaN)]).complete, false);
  assert.equal(check(objective, [queueWithTopic(72)]).complete, true);
  assert.equal(check(objective, [queueWithTopic(168)]).complete, true);
});

test("Message Queue Design teaches partition-limited consumer parallelism", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("message-queue-design");
  const medium = tutorial.levels.find((level) => level.id === "medium");
  const step = medium.steps.find((item) => item.id === "message-queue-design-medium-partition-parallelism");
  const retentionIndex = medium.steps.findIndex((item) => item.id === "message-queue-design-medium-recovery-window");
  const stepIndex = medium.steps.indexOf(step);
  assert.ok(stepIndex > retentionIndex);
  assert.deepEqual(step.objective, {
    kind: "queue-partitions",
    queueComponentId: "message-queue",
    topicName: "message-queue-design-events",
    minimumPartitions: 4,
    minimumHotPartitionTrafficShare: 0.5,
    minimumEstimatedAverageMessageSizeBytes: 2048,
  });
  assert.match(step.prompt, /50%.*busiest partition.*2048 bytes.*projected backlog.*logical payload.*uniform 25% share/i);
  assert.match(step.tradeoff, /directional competing-consumer backlog estimate.*actual partition placement.*ordering/i);
  assert.ok(getTutorialGuidance(step).some(({ target }) => target?.kind === "control" && target.id === "queue-topic-partitions"));
  assert.ok(getTutorialGuidance(step).some(({ target }) => target?.kind === "control" && target.id === "queue-topic-hot-partition-share"));
  assert.ok(getTutorialGuidance(step).some(({ target }) => target?.kind === "control" && target.id === "queue-topic-message-size"));

  const objective = step.objective;
  const queueWithTopic = (partitionCount) => makeNode("queue", "message-queue", {
    queueConfig: { topics: [{ name: objective.topicName, partitionCount }] },
  });
  assert.match(check(objective).feedback, /Add a Message Queue/);
  assert.match(check(objective, [makeNode("queue", "message-queue", { queueConfig: { topics: [] } })]).feedback, /Add topic/);
  assert.equal(check(objective, [queueWithTopic(undefined)]).complete, false);
  assert.equal(check(objective, [queueWithTopic(2)]).complete, false);
  assert.equal(check(objective, [queueWithTopic(4)]).complete, false);
  assert.equal(check(objective, [makeNode("queue", "message-queue", { queueConfig: { topics: [{ name: objective.topicName, partitionCount: 4, estimatedHotPartitionTrafficShare: 0.25 }] } })]).complete, false);
  assert.equal(check(objective, [makeNode("queue", "message-queue", { queueConfig: { topics: [{ name: objective.topicName, partitionCount: 4, estimatedHotPartitionTrafficShare: 0.5 }] } })]).complete, false);
  assert.equal(check(objective, [makeNode("queue", "message-queue", { queueConfig: { topics: [{ name: objective.topicName, partitionCount: 4, estimatedHotPartitionTrafficShare: 0.5, estimatedAverageMessageSizeBytes: 1024 }] } })]).complete, false);
  assert.equal(check(objective, [makeNode("queue", "message-queue", { queueConfig: { topics: [{ name: objective.topicName, partitionCount: 4, estimatedHotPartitionTrafficShare: 0.5, estimatedAverageMessageSizeBytes: 2048 }] } })]).complete, true);
  assert.equal(check(objective, [makeNode("queue", "message-queue", { queueConfig: { topics: [{ name: objective.topicName, partitionCount: 8, estimatedHotPartitionTrafficShare: 0.6, estimatedAverageMessageSizeBytes: 4096 }] } })]).complete, true);
});

test("Message Queue Design prompts an honest replication trade-off self-review", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("message-queue-design");
  const high = tutorial.levels.find((level) => level.id === "high");
  const coordinationIndex = high.steps.findIndex((step) => step.id === "message-queue-design-high-extension");
  const reflectionIndex = high.steps.findIndex((step) => step.id === "message-queue-design-high-replication-tradeoffs");
  const step = high.steps[reflectionIndex];
  assert.ok(reflectionIndex > coordinationIndex);
  assert.equal(step.objective.kind, "reflection");
  assert.match(step.prompt, /N = 3.*W = 2 and R = 2.*W \+ R > N/);
  assert.match(step.prompt, /latency.*availability.*stale-read.*write-loss/i);
  assert.match(step.tradeoff, /self-assessed.*does not model broker replicas.*not a universal consistency guarantee/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("cannot grade the explanation")));
  assert.match(check(step.objective).feedback, /Self-check acknowledged.*does not simulate replication or quorum/i);
});

test("Message Queue Design guides a bounded retry estimate without claiming delivery simulation", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("message-queue-design");
  const high = tutorial.levels.find((level) => level.id === "high");
  const step = high.steps.find((item) => item.id === "message-queue-design-high-retry-estimate");
  const objective = step.objective;

  assert.equal(objective.kind, "queue-retry-estimate");
  assert.match(step.prompt, /10% independent failure probability.*three additional retries.*fixed 250 ms delay.*retry attempts.*exhausted deliveries/i);
  assert.match(step.tradeoff, /post-hoc estimate.*fixed delay per retry.*does not feed retry work back.*does not simulate acknowledgments.*delivery guarantees/i);
  assert.ok(getTutorialGuidance(step).some(({ target }) => target?.kind === "control" && target.id === "queue-topic-failure-rate"));
  assert.ok(getTutorialGuidance(step).some(({ target }) => target?.kind === "control" && target.id === "queue-topic-retries"));
  assert.ok(getTutorialGuidance(step).some(({ target }) => target?.kind === "control" && target.id === "queue-topic-retry-backoff"));

  assert.match(check(objective).feedback, /Add a Message Queue/);
  const noTopic = makeNode("queue", "message-queue", { queueConfig: { topics: [] } });
  assert.match(check(objective, [noTopic]).feedback, /Add topic/);
  const topicWith = (failureRate, retries, backoffMs = objective.assumedRetryBackoffMs) => makeNode("queue", "message-queue", {
    queueConfig: { topics: [{ name: objective.topicName, estimatedFailureRatePerAttempt: failureRate, maxDeliveryRetries: retries, estimatedRetryBackoffMs: backoffMs }] },
  });
  assert.equal(check(objective, [topicWith(0.1, 2)]).complete, false);
  assert.equal(check(objective, [topicWith(0.2, 3)]).complete, false);
  assert.equal(check(objective, [topicWith(0.1, 3, 500)]).complete, false);
  assert.equal(check(objective, [topicWith(0.1, 3)]).complete, true);
  assert.equal(check(objective, [topicWith(0.1, 5)]).complete, true);
});

test("Message Queue Design teaches a bounded dead-letter policy without claiming consumer simulation", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("message-queue-design");
  const high = tutorial.levels.find((level) => level.id === "high");
  const replicationIndex = high.steps.findIndex((step) => step.id === "message-queue-design-high-replication-tradeoffs");
  const deadLetterIndex = high.steps.findIndex((step) => step.id === "message-queue-design-high-dead-letter-policy");
  const step = high.steps[deadLetterIndex];

  assert.ok(deadLetterIndex > replicationIndex);
  assert.equal(step.objective.kind, "reflection");
  assert.match(step.prompt, /bounded retries with backoff.*dead-letter queue/i);
  assert.match(step.prompt, /message ID.*topic.*partition.*offset.*failure reason/i);
  assert.match(step.prompt, /alert.*repair.*replay/i);
  assert.match(step.prompt, /partition order.*idempotent/i);
  assert.match(step.tradeoff, /self-assessed.*does not execute consumer retries.*dead-letter routing.*replay/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("cannot grade the explanation")));
  assert.match(check(step.objective).feedback, /Self-check acknowledged.*does not simulate consumer retry or dead-letter behavior/i);
});

test("Message Queue Design discusses replica failure-domain placement without claiming fault simulation", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("message-queue-design");
  const high = tutorial.levels.find((level) => level.id === "high");
  const replicationIndex = high.steps.findIndex((step) => step.id === "message-queue-design-high-replication-tradeoffs");
  const placementIndex = high.steps.findIndex((step) => step.id === "message-queue-design-high-failure-domain-placement");
  const deadLetterIndex = high.steps.findIndex((step) => step.id === "message-queue-design-high-dead-letter-policy");
  const step = high.steps[placementIndex];

  assert.ok(placementIndex > replicationIndex && placementIndex < deadLetterIndex);
  assert.equal(step.objective.kind, "reflection");
  assert.match(step.prompt, /three replicas.*one rack or zone.*three independent zones/i);
  assert.match(step.prompt, /single-domain failure.*two-domain failure.*quorum/i);
  assert.match(step.prompt, /cross-zone latency and cost.*network-partition/i);
  assert.match(step.prompt, /replica count alone does not establish availability or durability/i);
  assert.match(step.tradeoff, /self-assessed.*does not model replica placement.*correlated failures.*network partitions.*failover/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("cannot grade the explanation")));
  assert.match(check(step.objective).feedback, /Self-check acknowledged.*does not simulate failure domains, correlated faults, or quorum availability/i);
});

test("Message Queue Design distinguishes client-visible consistency guarantees without claiming simulation", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("message-queue-design");
  const high = tutorial.levels.find((level) => level.id === "high");
  const quorumIndex = high.steps.findIndex((step) => step.id === "message-queue-design-high-replication-tradeoffs");
  const consistencyIndex = high.steps.findIndex((step) => step.id === "message-queue-design-high-client-consistency-contracts");
  const failureDomainIndex = high.steps.findIndex((step) => step.id === "message-queue-design-high-failure-domain-placement");
  const step = high.steps[consistencyIndex];

  assert.ok(consistencyIndex > quorumIndex && consistencyIndex < failureDomainIndex);
  assert.equal(step.objective.kind, "reflection");
  assert.match(step.prompt, /read-your-writes.*acknowledged write/i);
  assert.match(step.prompt, /monotonic reads.*do not regress/i);
  assert.match(step.prompt, /consistent prefix.*never sees “paid” without “created”/i);
  assert.match(step.prompt, /linearizability.*real-time precedence.*invoked after a completed write/i);
  assert.match(step.prompt, /session guarantees do not establish one global real-time order/i);
  assert.match(step.prompt, /sticky routing or W \+ R > N alone does not establish linearizability/i);
  assert.match(step.tradeoff, /self-assessed.*does not model client-observed consistency.*quorum overlap alone does not prove linearizability/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("cannot grade the explanation")));
  assert.match(check(step.objective).feedback, /Self-check acknowledged.*does not simulate or verify client-visible consistency guarantees/i);
});

test("Twitter Feed prompts a shard-key hot-spot self-review without claiming simulation", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("twitter-feed");
  const high = tutorial.levels.find((level) => level.id === "high");
  const stepIndex = high.steps.findIndex((step) => step.id === "twitter-feed-high-shard-key-hotspot-review");
  const capacityIndex = high.steps.findIndex((step) => step.id === "twitter-feed-high-capacity");
  const step = high.steps[stepIndex];
  assert.ok(stepIndex > 0 && stepIndex < capacityIndex);
  assert.equal(step.objective.kind, "reflection");
  assert.match(step.prompt, /authorId and postId.*celebrity's writes.*timeline reads/i);
  assert.match(step.prompt, /mitigation for the hot author/i);
  assert.match(step.tradeoff, /does not model database partition keys.*hot-key skew/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("cannot grade the explanation")));
});

test("Twitter Feed guides a hash-shard hot-key estimate and checks its configuration", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("twitter-feed");
  const high = tutorial.levels.find((level) => level.id === "high");
  const stepIndex = high.steps.findIndex((step) => step.id === "twitter-feed-high-hash-partition-estimate");
  const reflectionIndex = high.steps.findIndex((step) => step.id === "twitter-feed-high-shard-key-hotspot-review");
  const step = high.steps[stepIndex];
  assert.ok(stepIndex > 0 && stepIndex < reflectionIndex);
  assert.equal(step.objective.kind, "database-partitioning");
  assert.deepEqual(step.objective, {
    kind: "database-partitioning",
    databaseComponentId: "sql-db",
    tableName: "posts",
    keyColumn: "authorId",
    minimumShards: 16,
    minimumHotKeyTrafficShare: 0.2,
    minimumEstimatedWorkCapacityPerShard: 1000,
  });
  assert.match(step.prompt, /per-shard modeled work capacity of 1000 work\/s.*hot-shard work and utilization.*uniform-shard baseline/i);
  assert.match(step.why, /expected 25%.*6\.25%/);
  assert.match(step.tradeoff, /directional work estimate.*does not change database throughput.*illustrative, not a recommendation.*hot authors/i);
  assert.ok(getTutorialGuidance(step).some(({ target }) => target?.kind === "control" && target.id === "database-hot-key-share"));
  assert.ok(getTutorialGuidance(step).some(({ target }) => target?.kind === "control" && target.id === "database-shard-capacity"));

  const objective = step.objective;
  const tableWithPartitioning = (partitioning) => makeNode("db", "sql-db", { tables: [{
    name: "posts",
    columns: [{ name: "authorId" }],
    indexes: [],
    partitioning,
  }] });
  assert.match(check(objective).feedback, /Add SQL Database/);
  assert.match(check(objective, [makeNode("db", "sql-db", { tables: [] })]).feedback, /Add a posts table/);
  assert.match(check(objective, [tableWithPartitioning(undefined)]).feedback, /Configure hash partitioning/);
  assert.match(check(objective, [tableWithPartitioning({ strategy: "hash", keyColumn: "postId", shardCount: 16, hotKeyTrafficShare: 0.2 })]).feedback, /partition key to authorId/);
  assert.match(check(objective, [tableWithPartitioning({ strategy: "hash", keyColumn: "authorId", shardCount: 8, hotKeyTrafficShare: 0.2 })]).feedback, /at least 16 shards/);
  assert.match(check(objective, [tableWithPartitioning({ strategy: "hash", keyColumn: "authorId", shardCount: 16, hotKeyTrafficShare: 0.1 })]).feedback, /at least 20%/);
  assert.match(check(objective, [tableWithPartitioning({ strategy: "hash", keyColumn: "authorId", shardCount: 16, hotKeyTrafficShare: 0.2 })]).feedback, /estimated per-shard work capacity to at least 1000 work\/s/);
  assert.equal(check(objective, [tableWithPartitioning({ strategy: "hash", keyColumn: "authorId", shardCount: 16, hotKeyTrafficShare: 0.2, estimatedWorkCapacityPerShard: 1000 })]).complete, true);
});

test("Twitter Feed guides a read-copy capacity estimate without claiming read routing", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("twitter-feed");
  const high = tutorial.levels.find((level) => level.id === "high");
  const reflectionIndex = high.steps.findIndex((step) => step.id === "twitter-feed-high-shard-key-hotspot-review");
  const replicaIndex = high.steps.findIndex((step) => step.id === "twitter-feed-high-read-replica-capacity");
  const capacityIndex = high.steps.findIndex((step) => step.id === "twitter-feed-high-capacity");
  const step = high.steps[replicaIndex];

  assert.ok(replicaIndex > reflectionIndex && replicaIndex < capacityIndex);
  assert.deepEqual(step.objective, {
    kind: "database-read-replicas",
    databaseComponentId: "sql-db",
    minimumReplicas: 2,
    requiredReadTrafficToReplicasShare: 0.8,
    requiredEstimatedReplicationLagMs: 800,
    requiredMaximumToleratedReadStalenessMs: 500,
  });
  assert.match(step.prompt, /two additional read-serving copies.*80% of modeled read work.*lag of 800 ms.*staleness of 500 ms.*advisory stale-read risk warning/i);
  assert.match(step.tradeoff, /user-supplied estimates, not measured lag.*does not route reads.*warning only compares the two inputs/i);
  const guidance = getTutorialGuidance(step);
  assert.ok(guidance.some(({ target }) => target?.kind === "control" && target.id === "database-read-replica-configure"));
  assert.ok(guidance.some(({ target }) => target?.kind === "control" && target.id === "database-read-replica-count"));
  assert.ok(guidance.some(({ target }) => target?.kind === "control" && target.id === "database-read-replica-share"));
  assert.ok(guidance.some(({ target }) => target?.kind === "control" && target.id === "database-replication-lag"));
  assert.ok(guidance.some(({ target }) => target?.kind === "control" && target.id === "database-read-staleness-budget"));

  assert.match(check(step.objective).feedback, /Add SQL Database/);
  assert.match(check(step.objective, [makeNode("db", "sql-db")]).feedback, /Configure at least 2 additional read-serving copies/);
  assert.match(check(step.objective, [makeNode("db", "sql-db", { databaseReplicationEstimate: { estimatedReadReplicaCount: 1 } })]).feedback, /at least 2 additional read-serving copies/);
  assert.match(check(step.objective, [makeNode("db", "sql-db", { databaseReplicationEstimate: { estimatedReadReplicaCount: 2 } })]).feedback, /read work served by additional copies to 80%/);
  assert.match(check(step.objective, [makeNode("db", "sql-db", { databaseReplicationEstimate: { estimatedReadReplicaCount: 2, estimatedReadTrafficToReplicasShare: 0.7 } })]).feedback, /to 80%/);
  const withReplicaAssumptions = (databaseReplicationEstimate) => makeNode("db", "sql-db", { databaseReplicationEstimate });
  assert.match(check(step.objective, [withReplicaAssumptions({ estimatedReadReplicaCount: 2, estimatedReadTrafficToReplicasShare: 0.8 })]).feedback, /estimated replication lag estimate to 800 ms/);
  assert.match(check(step.objective, [withReplicaAssumptions({ estimatedReadReplicaCount: 2, estimatedReadTrafficToReplicasShare: 0.8, estimatedReplicationLagMs: 800 })]).feedback, /maximum tolerated read staleness estimate to 500 ms/);
  assert.equal(check(step.objective, [withReplicaAssumptions({ estimatedReadReplicaCount: 2, estimatedReadTrafficToReplicasShare: 0.8, estimatedReplicationLagMs: 800, maximumToleratedReadStalenessMs: 500 })]).complete, true);
});

test("Payment System teaches the transactional outbox shape without claiming atomicity", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("payment-system");
  const medium = tutorial.levels.find((level) => level.id === "medium");
  const stepIndex = medium.steps.findIndex((item) => item.id === "payment-system-medium-outbox-schema");
  const queueIndex = medium.steps.findIndex((item) => item.id === "payment-system-medium-queue");
  const step = medium.steps[stepIndex];
  assert.ok(stepIndex > queueIndex);
  assert.equal(step.objective.kind, "database-schema");
  assert.deepEqual(step.objective, {
    kind: "database-schema",
    databaseComponentId: "sql-db",
    tableName: "outbox_events",
    columns: ["eventId", "paymentId", "eventType", "payload", "createdAt", "publishedAt"],
    indexedColumns: ["eventId"],
  });
  assert.match(step.why, /one database transaction/i);
  assert.match(step.tradeoff, /does not verify a shared transaction.*idempotent consumers/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("outbox_events")));
});

test("Digital Wallet teaches transfer transaction boundaries without claiming financial correctness simulation", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("digital-wallet");
  const medium = tutorial.levels.find((level) => level.id === "medium");
  const workerIndex = medium.steps.findIndex((step) => step.id === "digital-wallet-medium-worker-scale");
  const transferIndex = medium.steps.findIndex((step) => step.id === "digital-wallet-medium-transfer-boundary");
  const appScaleIndex = medium.steps.findIndex((step) => step.id === "digital-wallet-medium-app-scale");
  const step = medium.steps[transferIndex];

  assert.ok(transferIndex > workerIndex && transferIndex < appScaleIndex);
  assert.equal(step.objective.kind, "reflection");
  assert.match(step.prompt, /equal debit and credit.*partial committed transfer.*overspend/i);
  assert.match(step.prompt, /atomic ledger writes.*concurrent debits/i);
  assert.match(step.prompt, /different shards or services.*partial transfer.*distributed transaction.*saga/i);
  assert.match(step.prompt, /pending state.*compensation is not an instantaneous rollback/i);
  assert.match(step.tradeoff, /self-assessed.*does not execute transactions.*sagas.*cross-shard consistency.*cannot verify financial correctness/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("cannot grade the explanation")));
  assert.match(check(step.objective).feedback, /Self-check acknowledged.*does not simulate transaction isolation or cross-boundary commit\/recovery/i);
});

test("Digital Wallet teaches replica-read consistency without claiming replication simulation", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("digital-wallet");
  const high = tutorial.levels.find((level) => level.id === "high");
  const extensionIndex = high.steps.findIndex((step) => step.id === "digital-wallet-high-extension");
  const replicaIndex = high.steps.findIndex((step) => step.id === "digital-wallet-high-replica-read-policy");
  const capacityIndex = high.steps.findIndex((step) => step.id === "digital-wallet-high-capacity");
  const step = high.steps[replicaIndex];

  assert.ok(replicaIndex > extensionIndex && replicaIndex < capacityIndex);
  assert.equal(step.objective.kind, "reflection");
  assert.match(step.prompt, /asynchronously replicated read replicas.*replica lag.*just-completed credit/i);
  assert.match(step.prompt, /primary.*version\/read barrier.*read-your-writes/i);
  assert.match(step.prompt, /stale balance read must never authorize a debit.*authoritative transactional write boundary/i);
  assert.match(step.prompt, /primary-only reads.*replica reads.*asynchronous replication.*synchronous policy/i);
  assert.match(step.tradeoff, /self-assessed.*capacity estimate.*does not model primary\/replica routing, lag.*data loss/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("cannot grade the explanation")));
  assert.match(check(step.objective).feedback, /Self-check acknowledged.*does not simulate database replication, lag, consistency, or failover/i);
});

test("Search Engine teaches staged schema evolution without claiming migration verification", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("search-engine");
  const high = tutorial.levels.find((level) => level.id === "high");
  const extensionIndex = high.steps.findIndex((step) => step.id === "search-engine-high-extension");
  const migrationIndex = high.steps.findIndex((step) => step.id === "search-engine-high-schema-evolution");
  const capacityIndex = high.steps.findIndex((step) => step.id === "search-engine-high-capacity");
  const step = high.steps[migrationIndex];

  assert.ok(migrationIndex > extensionIndex && migrationIndex < capacityIndex);
  assert.equal(step.objective.kind, "reflection");
  assert.match(step.prompt, /expand-and-contract/i);
  assert.match(step.prompt, /tolerate both old and new representations.*dual-writing/i);
  assert.match(step.prompt, /backfill\/reindex.*resumable batches/i);
  assert.match(step.prompt, /measure coverage.*switch reads.*rollback window/i);
  assert.match(step.prompt, /malformed.*partially migrated.*stop or resume/i);
  assert.match(step.tradeoff, /self-assessed.*does not model mixed-version compatibility.*backfill completeness.*rollback safety/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("cannot grade the explanation")));
  assert.match(check(step.objective).feedback, /Self-check acknowledged.*does not simulate schema evolution, reindexing, or mixed-version deployments/i);
});

test("Metrics Monitoring teaches event-time windows and late-data policy without claiming stream simulation", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("metrics-monitoring");
  const medium = tutorial.levels.find((level) => level.id === "medium");
  const workerIndex = medium.steps.findIndex((step) => step.id === "metrics-monitoring-medium-worker-scale");
  const lateDataIndex = medium.steps.findIndex((step) => step.id === "metrics-monitoring-medium-event-time-lateness");
  const appScaleIndex = medium.steps.findIndex((step) => step.id === "metrics-monitoring-medium-app-scale");
  const step = medium.steps[lateDataIndex];

  assert.ok(lateDataIndex > workerIndex && lateDataIndex < appScaleIndex);
  assert.equal(step.objective.kind, "reflection");
  assert.match(step.prompt, /event time from processing time/i);
  assert.match(step.prompt, /10:04.*10:00–10:05/i);
  assert.match(step.prompt, /allowed-lateness policy.*revise the dashboard.*reconciled separately or dropped/i);
  assert.match(step.prompt, /provisional versus corrected.*watermark estimates.*rather than proving/i);
  assert.match(step.prompt, /late-event handling differs from duplicate-event deduplication/i);
  assert.match(step.tradeoff, /self-assessed.*does not model event timestamps.*watermarks.*late-event correction.*not a universal recommendation/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("cannot grade the explanation")));
  assert.match(check(step.objective).feedback, /Self-check acknowledged.*does not simulate stream-processing windows, watermarks, or late events/i);
});

test("Ticket Booking teaches an atomic seat claim without claiming transaction simulation", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("ticket-booking");
  const medium = tutorial.levels.find((level) => level.id === "medium");
  const invalidationIndex = medium.steps.findIndex((step) => step.id === "ticket-booking-medium-invalidation");
  const claimIndex = medium.steps.findIndex((step) => step.id === "ticket-booking-medium-atomic-seat-claim");
  const appScaleIndex = medium.steps.findIndex((step) => step.id === "ticket-booking-medium-app-scale");
  const step = medium.steps[claimIndex];

  assert.ok(claimIndex > invalidationIndex && claimIndex < appScaleIndex);
  assert.equal(step.objective.kind, "reflection");
  assert.match(step.prompt, /two requests.*same time.*cache/i);
  assert.match(step.prompt, /at most one active reservation/i);
  assert.match(step.prompt, /uniqueness.*conditional seat-state update.*serializable transaction/i);
  assert.match(step.prompt, /abort and require retry.*losing request.*temporary hold.*final confirmation/i);
  assert.match(step.tradeoff, /self-assessed.*does not execute concurrent transactions.*enforce SQL constraints.*isolation levels/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("cannot grade the explanation")));
  assert.match(check(step.objective).feedback, /Self-check acknowledged.*does not simulate concurrent writes, database constraints, or transaction isolation/i);
});

test("File Storage teaches a cross-store backup and restore plan without claiming recovery simulation", () => {
  const tutorial = TUTORIAL_BY_PROBLEM_ID.get("file-storage");
  const medium = tutorial.levels.find((level) => level.id === "medium");
  const workerIndex = medium.steps.findIndex((step) => step.id === "file-storage-medium-worker-scale");
  const restoreIndex = medium.steps.findIndex((step) => step.id === "file-storage-medium-backup-restore");
  const appScaleIndex = medium.steps.findIndex((step) => step.id === "file-storage-medium-app-scale");
  const step = medium.steps[restoreIndex];

  assert.ok(restoreIndex > workerIndex && restoreIndex < appScaleIndex);
  assert.equal(step.objective.kind, "reflection");
  assert.match(step.prompt, /recovery point objective \(RPO\).*recovery time objective \(RTO\)/i);
  assert.match(step.prompt, /not automatically atomic/i);
  assert.match(step.prompt, /object-version/i);
  assert.match(step.prompt, /uploads and deletes in flight/i);
  assert.match(step.prompt, /restore drill.*isolated environment.*checksums.*cutover/i);
  assert.match(step.prompt, /replicas alone are not backups/i);
  assert.match(step.tradeoff, /self-assessed.*does not create backups.*cross-store snapshots.*measure RPO\/RTO.*not recommendations/i);
  assert.ok(getTutorialGuidance(step).some(({ instruction }) => instruction.includes("cannot grade the explanation")));
  assert.match(check(step.objective).feedback, /Self-check acknowledged.*does not simulate backups, cross-store snapshot consistency, restore drills, or RPO\/RTO/i);
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
