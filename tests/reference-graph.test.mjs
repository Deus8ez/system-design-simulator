import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

function asDataUrl(source, fileName) {
  const output = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const componentStoreUrl = asDataUrl(
  "export const useCustomComponentsStore = { getState: () => ({ getComponent: () => undefined }) };",
  "customComponentsStore.js",
);
const problemStoreUrl = asDataUrl(
  "export const useCustomProblemsStore = { getState: () => ({ getProblems: () => [] }) };",
  "customProblemsStore.js",
);
const canvasStoreUrl = asDataUrl(
  "export const useCanvasStore = { getState: () => ({ addTab: () => {} }) };",
  "canvasStore.js",
);
const appStoreUrl = asDataUrl(
  "export const useAppStore = { getState: () => ({ showToast: () => {} }) };",
  "appStore.js",
);

let componentSource = await source("src/data/components.ts");
componentSource = componentSource.replace(
  'from "@/store/customComponentsStore"',
  `from "${componentStoreUrl}"`,
);
const componentsUrl = asDataUrl(componentSource, "components.ts");

let problemsSource = await source("src/data/problems.ts");
problemsSource = problemsSource.replace(
  'from "@/store/customProblemsStore"',
  `from "${problemStoreUrl}"`,
);
const problemsUrl = asDataUrl(problemsSource, "problems.ts");
const compilerUrl = asDataUrl(await source("src/engine/compiler.ts"), "compiler.ts");
const { compileDesign } = await import(compilerUrl);
const constantsUrl = asDataUrl(await source("src/engine/constants.ts"), "constants.ts");
const simulatorSource = (await source("src/engine/simulator.ts")).replace(
  'from "./constants"',
  `from "${constantsUrl}"`,
);
const { runSimulation } = await import(asDataUrl(simulatorSource, "simulator.ts"));

let referenceSource = await source("src/lib/loadReference.ts");
referenceSource = referenceSource
  .replace('from "@/data/components"', `from "${componentsUrl}"`)
  .replace('from "@/store/canvasStore"', `from "${canvasStoreUrl}"`)
  .replace('from "@/store/appStore"', `from "${appStoreUrl}"`)
  .replace('from "@/engine/compiler"', `from "${compilerUrl}"`);
const { buildReferenceGraph } = await import(asDataUrl(referenceSource, "loadReference.ts"));
const { PROBLEMS } = await import(problemsUrl);

test("Parking Lot reference graph compiles with topic subscriptions and async queue edge", () => {
  const problem = PROBLEMS.find(({ id }) => id === "parking-lot");
  assert.ok(problem, "Parking Lot problem should exist");

  const { nodes, edges } = buildReferenceGraph(problem);
  assert.equal(nodes.length, problem.referenceSolution.nodes.length);
  const compilation = compileDesign(nodes, edges);
  assert.equal(compilation.ok, true, JSON.stringify(compilation.diagnostics));

  const app = nodes.find(({ data }) => data.componentId === "app-server");
  const gateway = nodes.find(({ data }) => data.componentId === "api-gateway");
  const queue = nodes.find(({ data }) => data.componentId === "message-queue");
  const database = nodes.find(({ data }) => data.componentId === "sql-db");
  assert.ok(app && gateway && queue && database);
  assert.equal(app.data.replicas, 3);
  assert.equal(database.data.replicas, 2);

  assert.deepEqual(
    app.data.endpoints.map(({ path }) => path),
    ["/lots/:lotId/availability", "/lots/:lotId/reservations", "/sensor-events"],
  );
  assert.equal(gateway.data.routes.length, 3);
  assert.deepEqual(
    queue.data.queueConfig.subscriptions.map(({ topicName, consumerNodeId }) => ({ topicName, consumerNodeId })),
    [
      { topicName: "reservation-events", consumerNodeId: database.id },
      { topicName: "parking-events", consumerNodeId: database.id },
    ],
  );
  assert.ok(edges.some(({ source, target, data }) =>
    source === queue.id && target === database.id && data?.async === true && data?.protocol === "pubsub",
  ));

  const simulation = runSimulation(nodes, edges, 10_000);
  assert.equal(simulation.nodeMetrics.get(app.id).failedQPS ?? 0, 0);
  assert.equal(simulation.nodeMetrics.get(queue.id).queueBacklogQPS ?? 0, 0);
});

test("Rate Limiter reference graph compiles and sustains the default simulation load", () => {
  const problem = PROBLEMS.find(({ id }) => id === "rate-limiter");
  assert.ok(problem, "Rate Limiter problem should exist");

  const { nodes, edges } = buildReferenceGraph(problem);
  const compilation = compileDesign(nodes, edges);
  assert.equal(compilation.ok, true, JSON.stringify(compilation.diagnostics));

  const app = nodes.find(({ data }) => data.componentId === "app-server");
  const gateway = nodes.find(({ data }) => data.componentId === "api-gateway");
  const limiter = nodes.find(({ data }) => data.componentId === "rate-limiter");
  const cache = nodes.find(({ data }) => data.componentId === "cache");
  assert.ok(app && gateway && limiter && cache);
  assert.equal(app.data.replicas, 3);
  assert.deepEqual(
    app.data.endpoints.map(({ method, path }) => `${method} ${path}`),
    ["GET /api/resources", "POST /api/resources"],
  );
  assert.equal(gateway.data.routes.length, 2);
  assert.equal(cache.data.cacheConfig.defaultTtlSeconds, 60);
  assert.deepEqual(limiter.data.rateLimiterConfig, {
    algorithm: "token-bucket",
    keyBy: "client-id",
    requestsPerWindow: 50,
    windowSeconds: 1,
    estimatedDistinctKeys: 1000,
    burstCapacity: 100,
  });
  assert.ok(edges.some(({ source, target }) => source === limiter.id && target === cache.id));

  const simulation = runSimulation(nodes, edges, 10_000);
  assert.equal(simulation.nodeMetrics.get(app.id).failedQPS ?? 0, 0);
  assert.equal(simulation.failedOperationsPerSec, 0);
  assert.equal(simulation.rejectedRequestsPerSec, 0);
});

test("Notification System reference compiles with contracts, schemas, and a routable async queue", () => {
  const problem = PROBLEMS.find(({ id }) => id === "notification-system");
  assert.ok(problem, "Notification System problem should exist");

  const { nodes, edges } = buildReferenceGraph(problem);
  const compilation = compileDesign(nodes, edges);
  assert.equal(compilation.ok, true, JSON.stringify(compilation.diagnostics));

  const app = nodes.find(({ data }) => data.componentId === "app-server");
  const gateway = nodes.find(({ data }) => data.componentId === "api-gateway");
  const queue = nodes.find(({ data }) => data.componentId === "message-queue");
  const worker = nodes.find(({ data }) => data.componentId === "notification-service");
  const sql = nodes.find(({ data }) => data.componentId === "sql-db");
  const noSql = nodes.find(({ data }) => data.componentId === "nosql-db");
  const cache = nodes.find(({ data }) => data.componentId === "cache");
  const rateLimiter = nodes.find(({ data }) => data.componentId === "rate-limiter");
  assert.ok(app && gateway && queue && worker && sql && noSql && cache && rateLimiter);
  assert.equal(sql.data.replicas, 2);
  assert.ok(edges.some(({ source, target }) => source === rateLimiter.id && target === gateway.id));
  assert.ok(!edges.some(({ source, target }) => source === gateway.id && target === rateLimiter.id));

  assert.deepEqual(
    app.data.endpoints.map(({ method, path }) => `${method} ${path}`),
    [
      "POST /notifications",
      "GET /notifications/:notificationId",
      "GET /users/:userId/notification-preferences",
    ],
  );
  assert.ok(app.data.endpoints[0].steps.some(({ kind, target }) =>
    kind === "database-write" && target === "notifications.notificationId,userId,type,priority,deliveryStatus,createdAt,updatedAt",
  ));
  assert.equal(gateway.data.routes.length, 3);
  assert.equal(queue.data.queueConfig.topics.length, 1);
  assert.deepEqual(queue.data.queueConfig.subscriptions.map(({ consumerNodeId, topicName }) => ({ consumerNodeId, topicName })), [
    { consumerNodeId: worker.id, topicName: "notifications" },
  ]);
  assert.ok(edges.some(({ source, target, data }) =>
    source === queue.id && target === worker.id && data?.async === true && data?.protocol === "pubsub",
  ));
  assert.ok(edges.some(({ source, target }) => source === app.id && target === noSql.id));
  assert.equal(sql.data.tables[0].name, "user_preferences");
  assert.equal(noSql.data.tables[0].name, "notifications");
  assert.equal(cache.data.cacheConfig.defaultTtlSeconds, 300);

  const simulation = runSimulation(nodes, edges, 10_000);
  assert.equal(simulation.nodeMetrics.get(app.id).failedQPS ?? 0, 0);
  assert.equal(simulation.nodeMetrics.get(queue.id).queueBacklogQPS ?? 0, 0);
  assert.equal(simulation.failedOperationsPerSec, 0);
  assert.equal(simulation.bottleneckNodes.length, 0);
});

test("Music Streaming reference compiles with catalog, recommendations, and async play-event contracts", () => {
  const problem = PROBLEMS.find(({ id }) => id === "music-streaming");
  assert.ok(problem, "Music Streaming problem should exist");

  const { nodes, edges } = buildReferenceGraph(problem);
  const compilation = compileDesign(nodes, edges);
  assert.equal(compilation.ok, true, JSON.stringify(compilation.diagnostics));

  const app = nodes.find(({ data }) => data.componentId === "app-server");
  const gateway = nodes.find(({ data }) => data.componentId === "api-gateway");
  const cache = nodes.find(({ data }) => data.componentId === "cache");
  const queue = nodes.find(({ data }) => data.componentId === "message-queue");
  const database = nodes.find(({ data }) => data.componentId === "nosql-db");
  assert.ok(app && gateway && cache && queue && database);
  assert.equal(app.data.replicas, 3);
  assert.deepEqual(
    app.data.endpoints.map(({ method, path }) => `${method} ${path}`),
    [
      "GET /tracks/:trackId",
      "POST /plays",
      "GET /users/:userId/recommendations",
    ],
  );
  assert.equal(gateway.data.routes.length, 3);
  assert.equal(queue.data.queueConfig.topics[0].name, "play-events");
  assert.deepEqual(queue.data.queueConfig.subscriptions.map(({ consumerNodeId, topicName }) => ({ consumerNodeId, topicName })), [
    { consumerNodeId: database.id, topicName: "play-events" },
  ]);
  assert.ok(edges.some(({ source, target, data }) =>
    source === queue.id && target === database.id && data?.async === true && data?.protocol === "pubsub",
  ));
  assert.deepEqual(database.data.tables.map(({ name }) => name), ["tracks", "play_history", "user_recommendations"]);
  assert.equal(cache.data.cacheConfig.defaultTtlSeconds, 300);

  const simulation = runSimulation(nodes, edges, 10_000);
  assert.equal(simulation.nodeMetrics.get(app.id).failedQPS ?? 0, 0);
  assert.equal(simulation.nodeMetrics.get(queue.id).queueBacklogQPS ?? 0, 0);
  assert.equal(simulation.failedOperationsPerSec, 0);
});

test("Instagram reference compiles with photo processing, feed, engagement, and profile contracts", () => {
  const problem = PROBLEMS.find(({ id }) => id === "instagram");
  assert.ok(problem, "Instagram problem should exist");

  const { nodes, edges } = buildReferenceGraph(problem);
  assert.equal(nodes.length, problem.referenceSolution.nodes.length);
  const compilation = compileDesign(nodes, edges);
  assert.equal(compilation.ok, true, JSON.stringify(compilation.diagnostics));

  const app = nodes.find(({ data }) => data.componentId === "app-server");
  const gateway = nodes.find(({ data }) => data.componentId === "api-gateway");
  const cache = nodes.find(({ data }) => data.componentId === "cache");
  const queue = nodes.find(({ data }) => data.componentId === "message-queue");
  const processor = nodes.find(({ data }) => data.componentId === "stream-processor");
  const database = nodes.find(({ data }) => data.componentId === "nosql-db");
  const objectStorage = nodes.find(({ data }) => data.componentId === "object-storage");
  assert.ok(app && gateway && cache && queue && processor && database && objectStorage);
  assert.equal(app.data.replicas, 3);
  assert.deepEqual(
    app.data.endpoints.map(({ method, path }) => `${method} ${path}`),
    [
      "POST /posts",
      "GET /feed",
      "POST /posts/:postId/likes",
      "GET /profiles/:userId",
    ],
  );
  assert.equal(gateway.data.routes.length, 4);
  assert.equal(queue.data.queueConfig.topics[0].name, "photo-processing");
  assert.deepEqual(queue.data.queueConfig.subscriptions.map(({ consumerNodeId, topicName }) => ({ consumerNodeId, topicName })), [
    { consumerNodeId: processor.id, topicName: "photo-processing" },
  ]);
  assert.ok(edges.some(({ source, target, data }) =>
    source === queue.id && target === processor.id && data?.async === true && data?.protocol === "pubsub",
  ));
  assert.ok(edges.some(({ source, target }) => source === processor.id && target === objectStorage.id));
  assert.deepEqual(database.data.tables.map(({ name }) => name), ["posts", "likes", "user_profiles"]);
  assert.equal(cache.data.cacheConfig.defaultTtlSeconds, 300);

  const simulation = runSimulation(nodes, edges, 10_000);
  assert.equal(simulation.nodeMetrics.get(app.id).failedQPS ?? 0, 0);
  assert.equal(simulation.nodeMetrics.get(queue.id).queueBacklogQPS ?? 0, 0);
  assert.equal(simulation.failedOperationsPerSec, 0);
});

test("Video Streaming reference compiles with upload, catalog, and async transcoding contracts", () => {
  const problem = PROBLEMS.find(({ id }) => id === "video-streaming");
  assert.ok(problem, "Video Streaming problem should exist");

  const { nodes, edges } = buildReferenceGraph(problem);
  const compilation = compileDesign(nodes, edges);
  assert.equal(compilation.ok, true, JSON.stringify(compilation.diagnostics));

  const app = nodes.find(({ data }) => data.componentId === "app-server");
  const gateway = nodes.find(({ data }) => data.componentId === "api-gateway");
  const rateLimiter = nodes.find(({ data }) => data.componentId === "rate-limiter");
  const cache = nodes.find(({ data }) => data.componentId === "cache");
  const queue = nodes.find(({ data }) => data.componentId === "message-queue");
  const processor = nodes.find(({ data }) => data.componentId === "stream-processor");
  const database = nodes.find(({ data }) => data.componentId === "sql-db");
  const objectStorage = nodes.find(({ data }) => data.componentId === "object-storage");
  assert.ok(app && gateway && rateLimiter && cache && queue && processor && database && objectStorage);

  assert.ok(edges.some(({ source, target }) => source === rateLimiter.id && target === gateway.id));
  assert.ok(!edges.some(({ source, target }) => source === gateway.id && target === rateLimiter.id));
  assert.deepEqual(
    app.data.endpoints.map(({ method, path }) => `${method} ${path}`),
    [
      "GET /videos/:videoId",
      "POST /videos",
      "POST /videos/:videoId/complete",
      "GET /creators/:creatorId/videos",
    ],
  );
  assert.equal(gateway.data.routes.length, 4);
  assert.equal(queue.data.queueConfig.topics[0].name, "transcoding-jobs");
  assert.deepEqual(queue.data.queueConfig.subscriptions.map(({ consumerNodeId, topicName }) => ({ consumerNodeId, topicName })), [
    { consumerNodeId: processor.id, topicName: "transcoding-jobs" },
  ]);
  assert.ok(edges.some(({ source, target, data }) =>
    source === queue.id && target === processor.id && data?.async === true && data?.protocol === "pubsub",
  ));
  assert.ok(edges.some(({ source, target, data }) =>
    source === processor.id && target === objectStorage.id && data?.async === true,
  ));
  assert.equal(database.data.replicas, 3);
  assert.equal(database.data.tables[0].name, "videos");
  assert.ok(database.data.tables[0].indexes.some(({ columns }) => columns[0] === "creatorId"));
  assert.equal(cache.data.cacheConfig.defaultTtlSeconds, 600);

  const simulation = runSimulation(nodes, edges, 10_000);
  assert.equal(simulation.nodeMetrics.get(app.id).failedQPS ?? 0, 0);
  assert.equal(simulation.nodeMetrics.get(queue.id).queueBacklogQPS ?? 0, 0);
  assert.equal(
    simulation.failedOperationsPerSec,
    0,
    JSON.stringify([...simulation.nodeMetrics.values()].filter(({ failedQPS }) => failedQPS > 0)),
  );
});

test("All built-in references have an explicit executable or architecture-only classification", () => {
  const executableReferenceIds = new Set([
    "url-shortener",
    "video-streaming",
    "rate-limiter",
    "notification-system",
    "parking-lot",
    "instagram",
    "music-streaming",
  ]);

  assert.equal(PROBLEMS.length, 35);
  for (const problem of PROBLEMS) {
    const { nodes, edges } = buildReferenceGraph(problem);
    const compilation = compileDesign(nodes, edges);
    const expectedExecutable = executableReferenceIds.has(problem.id);
    assert.equal(
      compilation.ok,
      expectedExecutable,
      `${problem.id} should be ${expectedExecutable ? "executable" : "architecture-only"}: ${JSON.stringify(compilation.diagnostics)}`,
    );

    if (!expectedExecutable) {
      const diagnosticCodes = new Set(compilation.diagnostics.map(({ code }) => code));
      assert.ok(diagnosticCodes.has("APP_ENDPOINT_REQUIRED"), `${problem.id} should identify its missing endpoint contract`);
      assert.ok(
        [...diagnosticCodes].every((code) => ["APP_ENDPOINT_REQUIRED", "GATEWAY_ROUTES_UNCONFIGURED"].includes(code)),
        `${problem.id} has an unexpected compile diagnostic: ${JSON.stringify(compilation.diagnostics)}`,
      );
    }
  }
});
