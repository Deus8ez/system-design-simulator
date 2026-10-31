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

const zustandUrl = asDataUrl(`
  export function create() {
    return (initializer) => {
      let state;
      const set = (update) => {
        const partial = typeof update === "function" ? update(state) : update;
        state = { ...state, ...partial };
      };
      const get = () => state;
      const store = (selector = (value) => value) => selector(state);
      store.getState = get;
      store.setState = set;
      state = initializer(set, get);
      return store;
    };
  }
  export const persist = (initializer) => initializer;
  export const createJSONStorage = () => ({});
`, "zustand.js");

const canvasUrl = asDataUrl(`
  export const canvasState = {
    nodes: [],
    edges: [],
    lastTab: null,
    addTab(tab) {
      this.lastTab = tab;
      this.nodes = tab.nodes;
      this.edges = tab.edges;
    },
  };
  export const useCanvasStore = { getState: () => canvasState };
`, "canvasStore.js");
const appUrl = asDataUrl(`
  export const appState = {
    selectedProblemId: "parking-lot",
    setSelectedProblem(id) { this.selectedProblemId = id; },
    showToast() {},
  };
  export const useAppStore = { getState: () => appState };
`, "appStore.js");
const penUrl = asDataUrl(`
  export const penState = {
    strokes: [{ id: "stroke-1", color: "#fff", width: 2, points: [[1, 2], [3, 4]] }],
    setStrokes(strokes) { this.strokes = strokes; },
  };
  export const usePenStore = { getState: () => penState };
`, "penStore.js");
const simulationUrl = asDataUrl(`
  export const simulationState = { resetCount: 0, reset() { this.resetCount += 1; } };
  export const useSimulationStore = { getState: () => simulationState };
`, "simulationStore.js");
const customProblemsUrl = asDataUrl(
  "export const useCustomProblemsStore = { getState: () => ({ problems: [] }) };",
  "customProblemsStore.js",
);
const storageUrl = asDataUrl("export const safeLocalStorage = {};", "safeStorage.js");
const problemsUrl = asDataUrl(
  'export const PROBLEMS = [{ id: "parking-lot", title: "Parking Lot System" }];',
  "problems.js",
);
const configUrl = asDataUrl(
  await source("src/lib/componentConfigSerialization.ts"),
  "componentConfigSerialization.ts",
);

let storeSource = await source("src/store/savedDesignsStore.ts");
storeSource = storeSource
  .replace('from "zustand"', `from "${zustandUrl}"`)
  .replace('from "zustand/middleware"', `from "${zustandUrl}"`)
  .replace('from "./canvasStore"', `from "${canvasUrl}"`)
  .replace('from "./appStore"', `from "${appUrl}"`)
  .replace('from "./penStore"', `from "${penUrl}"`)
  .replace('from "./simulationStore"', `from "${simulationUrl}"`)
  .replace('from "./customProblemsStore"', `from "${customProblemsUrl}"`)
  .replace('from "./safeStorage"', `from "${storageUrl}"`)
  .replace('from "@/data/problems"', `from "${problemsUrl}"`)
  .replace('from "@/lib/componentConfigSerialization"', `from "${configUrl}"`);
const storeUrl = asDataUrl(storeSource, "savedDesignsStore.ts");
const [{ useSavedDesignsStore, serializeNodes, serializeEdges }, { canvasState, useCanvasStore }, { appState }, { penState }, { simulationState }] = await Promise.all([
  import(storeUrl),
  import(canvasUrl),
  import(appUrl),
  import(penUrl),
  import(simulationUrl),
]);

test("saved-design export/import/load preserves runtime contracts and edge metadata", () => {
  canvasState.nodes = [
    {
      id: "app",
      type: "component",
      position: { x: 10, y: 20 },
      data: {
        componentId: "app-server",
        label: "Parking API",
        icon: "Server",
        category: "compute",
        replicas: 3,
        maxQPS: 5000,
        latencyMs: 20,
        scalable: true,
        endpoints: [{
          id: "availability",
          method: "GET",
          path: "/lots/:lotId/availability",
          requestFields: [{ id: "lot-id", name: "lotId", type: "string", location: "path" }],
          responseFields: [{ id: "available", name: "availableSpots", type: "number" }],
          steps: [{ id: "respond", kind: "respond" }],
        }],
      },
    },
    {
      id: "queue",
      type: "component",
      position: { x: 220, y: 20 },
      data: {
        componentId: "message-queue",
        label: "Parking Events",
        icon: "Queue",
        category: "messaging",
        replicas: 1,
        maxQPS: 100000,
        latencyMs: 5,
        scalable: true,
        queueDeliveryMode: "competing",
        queueConfig: {
          topics: [{ id: "topic", name: "parking-events", retentionHours: 24 }],
          subscriptions: [{ id: "subscription", consumerNodeId: "db", topicName: "parking-events" }],
        },
      },
    },
    {
      id: "db",
      type: "component",
      position: { x: 440, y: 20 },
      data: {
        componentId: "sql-db",
        label: "Parking DB",
        icon: "Database",
        category: "storage",
        replicas: 2,
        maxQPS: 10000,
        latencyMs: 30,
        scalable: false,
      },
    },
  ];
  canvasState.edges = [
    { id: "app-queue", source: "app", target: "queue", data: { label: "events", protocol: "pubsub", async: true } },
    { id: "queue-db", source: "queue", target: "db", data: { label: "consume", protocol: "pubsub", async: true } },
  ];

  const serializedNodes = serializeNodes(useCanvasStore.getState().nodes);
  const serializedEdges = serializeEdges(useCanvasStore.getState().edges);
  assert.deepEqual(serializedNodes[0].data.endpoints, canvasState.nodes[0].data.endpoints);
  assert.deepEqual(serializedNodes[1].data.queueConfig, canvasState.nodes[1].data.queueConfig);
  assert.equal(serializedEdges[1].data.async, true);

  useSavedDesignsStore.getState().saveDesign("Parking Runtime Contracts");
  const saved = useSavedDesignsStore.getState().designs[0];
  const exported = useSavedDesignsStore.getState().exportDesign(saved.id);
  const importResult = useSavedDesignsStore.getState().importDesign(exported);
  assert.deepEqual(importResult, { ok: true });

  const imported = useSavedDesignsStore.getState().designs[0];
  assert.equal(imported.nodes[0].data.endpoints[0].requestFields[0].name, "lotId");
  assert.equal(imported.nodes[1].data.queueConfig.subscriptions[0].topicName, "parking-events");
  assert.equal(imported.edges[1].data.protocol, "pubsub");
  assert.equal(imported.edges[1].data.async, true);

  useSavedDesignsStore.getState().loadDesign(imported.id);
  assert.equal(canvasState.lastTab.id, "my-design");
  assert.equal(canvasState.lastTab.nodes[0].data.endpoints[0].path, "/lots/:lotId/availability");
  assert.equal(canvasState.lastTab.nodes[1].data.queueConfig.subscriptions[0].consumerNodeId, "db");
  assert.equal(canvasState.lastTab.edges[1].data.async, true);
  assert.equal(appState.selectedProblemId, "parking-lot");
  assert.equal(penState.strokes.length, 1);
  assert.equal(simulationState.resetCount, 1);
});
