import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Node } from "@xyflow/react";
import { useCanvasStore, type ComponentNodeData } from "./canvasStore";
import { useAppStore } from "./appStore";
import { usePenStore, type Stroke } from "./penStore";
import { useSimulationStore } from "./simulationStore";
import { useCustomProblemsStore } from "./customProblemsStore";
import { safeLocalStorage } from "./safeStorage";
import { PROBLEMS } from "@/data/problems";
import type { SimulationConfig } from "@/types/simulation";
import {
  normalizeComponentConfiguration,
  serializeComponentConfiguration,
  type SerializedComponentConfiguration,
} from "@/lib/componentConfigSerialization";

export interface SerializedComponentData extends SerializedComponentConfiguration {
  componentId: string;
  label: string;
  icon: string;
  category: string;
  replicas: number;
  maxQPS: number;
  latencyMs: number;
  scalable: boolean;
}

export interface SerializedTextData {
  text: string;
  fontSize?: "sm" | "base" | "lg";
}

export interface SerializedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: SerializedComponentData | SerializedTextData;
}

export interface SerializedEdge {
  id: string;
  type?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: { label?: string; protocol?: string; async?: boolean };
}

export interface SavedDesign {
  id: string;
  name: string;
  problemId: string | null;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  annotations: string[];
  strokes: Stroke[];
  simulationConfig?: SimulationConfig;
  createdAt: string;
  updatedAt: string;
}

export type ImportResult = { ok: true; id: string } | { ok: false; error: string };

interface SavedDesignsState {
  designs: SavedDesign[];
  saveDesign: (name: string) => void;
  loadDesign: (id: string) => void;
  deleteDesign: (id: string) => void;
  renameDesign: (id: string, name: string) => void;
  exportDesign: (id: string) => string;
  importDesign: (json: string) => ImportResult;
}

export function serializeNodes(
  nodes: ReturnType<typeof useCanvasStore.getState>["nodes"]
): SerializedNode[] {
  return nodes.map((n) => {
    const base = {
      id: n.id,
      type: n.type ?? "component",
      position: { x: n.position.x, y: n.position.y },
    };

    if (n.type === "text") {
      return {
        ...base,
        data: {
          text: (n.data.text as string) ?? "",
          fontSize: (n.data.fontSize as "sm" | "base" | "lg") ?? undefined,
        } as SerializedTextData,
      };
    }

    return {
      ...base,
      data: {
        componentId: n.data.componentId,
        label: n.data.label,
        icon: n.data.icon,
        category: n.data.category,
        replicas: n.data.replicas,
        maxQPS: n.data.maxQPS,
        latencyMs: n.data.latencyMs,
        scalable: n.data.scalable,
        ...serializeComponentConfiguration(n.data),
      } as SerializedComponentData,
    };
  });
}

export function serializeEdges(
  edges: ReturnType<typeof useCanvasStore.getState>["edges"]
): SerializedEdge[] {
  return edges.map((e) => ({
    id: e.id,
    type: e.type,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    data: {
      label: typeof e.data?.label === "string" ? e.data.label : "",
      protocol: typeof e.data?.protocol === "string" ? e.data.protocol : "http",
      async: e.data?.async === true,
    },
  }));
}

/* ---------- import validation (no external deps) ---------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Structurally validate an imported design and normalize it into the
 * SerializedNode/SerializedEdge shape (stripping unknown/runtime fields).
 * Accepts both the LoadDialog export envelope (a full SavedDesign) and the
 * top-bar exportAsJSON envelope ({ schemaVersion, name, problemId, nodes,
 * edges, strokes }).
 */
function normalizeImportedDesign(parsed: unknown):
  | {
      ok: true;
      name: string;
      problemId: string | null;
      nodes: SerializedNode[];
      edges: SerializedEdge[];
      strokes: Stroke[];
      simulationConfig?: SimulationConfig;
    }
  | { ok: false; error: string } {
  if (!isRecord(parsed)) {
    return { ok: false, error: "File is not a design object" };
  }
  if (!Array.isArray(parsed.nodes)) {
    return { ok: false, error: "Missing or invalid \"nodes\" array" };
  }
  if (!Array.isArray(parsed.edges)) {
    return { ok: false, error: "Missing or invalid \"edges\" array" };
  }

  const nodes: SerializedNode[] = [];
  const nodeIds = new Set<string>();
  for (let i = 0; i < parsed.nodes.length; i++) {
    const raw = parsed.nodes[i];
    if (!isRecord(raw)) {
      return { ok: false, error: `Node ${i} is not an object` };
    }
    if (typeof raw.id !== "string" || raw.id.length === 0) {
      return { ok: false, error: `Node ${i} has no string id` };
    }
    if (nodeIds.has(raw.id)) {
      return { ok: false, error: `Duplicate node id "${raw.id}"` };
    }
    const pos = raw.position;
    if (
      !isRecord(pos) ||
      typeof pos.x !== "number" ||
      typeof pos.y !== "number" ||
      !Number.isFinite(pos.x) ||
      !Number.isFinite(pos.y)
    ) {
      return { ok: false, error: `Node "${raw.id}" has an invalid position` };
    }
    if (!isRecord(raw.data)) {
      return { ok: false, error: `Node "${raw.id}" has no data object` };
    }

    const type = str(raw.type, "component");
    const d = raw.data;
    if (type === "text") {
      const fontSize = d.fontSize;
      nodes.push({
        id: raw.id,
        type,
        position: { x: pos.x, y: pos.y },
        data: {
          text: str(d.text, ""),
          fontSize:
            fontSize === "sm" || fontSize === "base" || fontSize === "lg"
              ? fontSize
              : undefined,
        },
      });
    } else {
      nodes.push({
        id: raw.id,
        type,
        position: { x: pos.x, y: pos.y },
        data: {
          componentId: str(d.componentId, "custom"),
          label: str(d.label, "Component"),
          icon: str(d.icon, "Box"),
          category: str(d.category, "compute"),
          replicas: num(d.replicas, 1),
          maxQPS: num(d.maxQPS, 1000),
          latencyMs: num(d.latencyMs, 10),
          scalable: d.scalable !== false,
          ...normalizeComponentConfiguration(d),
        },
      });
    }
    nodeIds.add(raw.id);
  }

  const edges: SerializedEdge[] = [];
  for (let i = 0; i < parsed.edges.length; i++) {
    const raw = parsed.edges[i];
    if (!isRecord(raw)) {
      return { ok: false, error: `Edge ${i} is not an object` };
    }
    const source = raw.source;
    const target = raw.target;
    if (typeof source !== "string" || !nodeIds.has(source)) {
      return { ok: false, error: `Edge ${i} has an unknown source node` };
    }
    if (typeof target !== "string" || !nodeIds.has(target)) {
      return { ok: false, error: `Edge ${i} has an unknown target node` };
    }
    const data = isRecord(raw.data) ? raw.data : {};
    edges.push({
      id: str(raw.id, `e-${source}-${target}-${i}`),
      type: str(raw.type, "animated"),
      source,
      target,
      sourceHandle: typeof raw.sourceHandle === "string" ? raw.sourceHandle : null,
      targetHandle: typeof raw.targetHandle === "string" ? raw.targetHandle : null,
      data: {
        label: str(data.label, ""),
        protocol: str(data.protocol, "http"),
        async: data.async === true,
      },
    });
  }

  // Strokes are best-effort: drop anything malformed instead of rejecting.
  const strokes: Stroke[] = Array.isArray(parsed.strokes)
    ? (parsed.strokes as unknown[]).filter((s): s is Stroke => {
        if (!isRecord(s)) return false;
        if (typeof s.id !== "string") return false;
        if (typeof s.color !== "string") return false;
        if (typeof s.width !== "number" || !Number.isFinite(s.width)) return false;
        return (
          Array.isArray(s.points) &&
          s.points.every(
            (p) =>
              Array.isArray(p) &&
              p.length === 2 &&
              typeof p[0] === "number" &&
              typeof p[1] === "number" &&
              Number.isFinite(p[0]) &&
              Number.isFinite(p[1])
          )
        );
      })
    : [];

  let simulationConfig: SimulationConfig | undefined;
  if (parsed.simulationConfig !== undefined) {
    if (!isRecord(parsed.simulationConfig)) {
      return { ok: false, error: "Invalid simulationConfig object" };
    }
    const config = parsed.simulationConfig;
    if (
      typeof config.requestsPerSec !== "number" || !Number.isFinite(config.requestsPerSec) || config.requestsPerSec <= 0 ||
      typeof config.durationSec !== "number" || !Number.isFinite(config.durationSec) || config.durationSec <= 0 ||
      typeof config.rampUp !== "boolean" || !isRecord(config.faults) || !Array.isArray(config.requestProfiles) ||
      config.requestProfiles.length === 0
    ) {
      return { ok: false, error: "Invalid simulationConfig values" };
    }
    const faults: SimulationConfig["faults"] = {};
    for (const [nodeId, rawFault] of Object.entries(config.faults)) {
      if (!nodeIds.has(nodeId) || !isRecord(rawFault)) {
        return { ok: false, error: `Invalid simulation fault for node "${nodeId}"` };
      }
      if (rawFault.mode === "down") {
        faults[nodeId] = { mode: "down" };
      } else if (
        rawFault.mode === "degraded" &&
        typeof rawFault.capacityFactor === "number" && Number.isFinite(rawFault.capacityFactor) && rawFault.capacityFactor > 0 && rawFault.capacityFactor <= 1 &&
        typeof rawFault.latencyMultiplier === "number" && Number.isFinite(rawFault.latencyMultiplier) && rawFault.latencyMultiplier >= 1
      ) {
        faults[nodeId] = {
          mode: "degraded",
          capacityFactor: rawFault.capacityFactor,
          latencyMultiplier: rawFault.latencyMultiplier,
        };
      } else {
        return { ok: false, error: `Invalid simulation fault for node "${nodeId}"` };
      }
    }
    const requestProfiles: SimulationConfig["requestProfiles"] = [];
    for (const [index, rawProfile] of config.requestProfiles.entries()) {
      if (!isRecord(rawProfile) || !isRecord(rawProfile.attributes)) {
        return { ok: false, error: `Invalid request profile ${index + 1}` };
      }
      const { name, trafficWeight, attributes, cacheHitRate } = rawProfile;
      if (
        typeof trafficWeight !== "number" || !Number.isFinite(trafficWeight) || trafficWeight < 0 ||
        Object.values(attributes).some((value) =>
          !["string", "number", "boolean"].includes(typeof value) ||
          (typeof value === "number" && !Number.isFinite(value))
        ) ||
        (cacheHitRate !== undefined && (
          typeof cacheHitRate !== "number" || !Number.isFinite(cacheHitRate) || cacheHitRate < 0 || cacheHitRate > 1
        ))
      ) {
        return { ok: false, error: `Invalid request profile ${index + 1}` };
      }
      requestProfiles.push({
        name: str(name, `Profile ${index + 1}`),
        trafficWeight,
        attributes: attributes as SimulationConfig["requestProfiles"][number]["attributes"],
        ...(typeof cacheHitRate === "number" ? { cacheHitRate } : {}),
      });
    }
    if (requestProfiles.every((profile) => profile.trafficWeight === 0)) {
      return { ok: false, error: "At least one request profile must have positive traffic weight" };
    }
    simulationConfig = {
      requestsPerSec: config.requestsPerSec,
      durationSec: config.durationSec,
      rampUp: config.rampUp,
      faults,
      requestProfiles,
    };
  }

  return {
    ok: true,
    name: str(parsed.name, "Untitled design"),
    problemId: typeof parsed.problemId === "string" ? parsed.problemId : null,
    nodes,
    edges,
    strokes,
    simulationConfig,
  };
}

export const useSavedDesignsStore = create<SavedDesignsState>()(
  persist(
    (set, get) => ({
      designs: [],

      saveDesign: (name: string) => {
        const { nodes, edges } = useCanvasStore.getState();
        const { strokes } = usePenStore.getState();
        const problemId = useAppStore.getState().selectedProblemId;
        const now = new Date().toISOString();
        const id = `design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const design: SavedDesign = {
          id,
          name,
          problemId,
          nodes: serializeNodes(nodes),
          edges: serializeEdges(edges),
          annotations: [],
          strokes,
          simulationConfig: useSimulationStore.getState().config,
          createdAt: now,
          updatedAt: now,
        };

        set((s) => ({ designs: [design, ...s.designs] }));
        useAppStore.getState().showToast(`Design "${name}" saved`, "success");
      },

      loadDesign: (id: string) => {
        const design = get().designs.find((d) => d.id === id);
        if (!design) return;

        // Restore canvas state
        const restoredNodes: Node[] = design.nodes.map((n) => {
          if (n.type === "text") {
            const textData = n.data as SerializedTextData;
            return {
              id: n.id,
              type: n.type,
              position: n.position,
              connectable: false,
              data: { text: textData.text ?? "", fontSize: textData.fontSize },
            };
          }
          return {
            id: n.id,
            type: n.type,
            position: n.position,
            data: { ...n.data } as ComponentNodeData,
          };
        });

        const restoredEdges = design.edges.map((e) => ({
          id: e.id,
          type: e.type,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          targetHandle: e.targetHandle ?? undefined,
          data: {
            label: e.data?.label ?? "",
            protocol: e.data?.protocol ?? "http",
            async: e.data?.async ?? false,
          },
        }));

        // Route through the tab system so a read-only reference tab is never
        // clobbered: loading always (re)targets the "My Design" tab. addTab
        // also clears node/edge selection and the undo history.
        useCanvasStore.getState().addTab({
          id: "my-design",
          label: "My Design",
          nodes: restoredNodes,
          edges: restoredEdges,
        });

        // Stale simulation metrics/score refer to the previous canvas.
        useSimulationStore.getState().reset();
        if (design.simulationConfig) {
          useSimulationStore.getState().setConfig(design.simulationConfig);
        }

        usePenStore.getState().setStrokes(design.strokes ?? []);

        // Restore problem selection if it exists
        if (design.problemId) {
          useAppStore.getState().setSelectedProblem(design.problemId);
        }

        useAppStore.getState().showToast(`Loaded "${design.name}"`, "success");
      },

      deleteDesign: (id: string) => {
        set((s) => ({ designs: s.designs.filter((d) => d.id !== id) }));
      },

      renameDesign: (id: string, name: string) => {
        set((s) => ({
          designs: s.designs.map((d) =>
            d.id === id
              ? { ...d, name, updatedAt: new Date().toISOString() }
              : d
          ),
        }));
      },

      exportDesign: (id: string) => {
        const design = get().designs.find((d) => d.id === id);
        if (!design) return "{}";
        return JSON.stringify({ schemaVersion: 1, ...design }, null, 2);
      },

      importDesign: (json: string): ImportResult => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch {
          useAppStore.getState().showToast("Failed to parse JSON", "error");
          return { ok: false, error: "Failed to parse JSON" };
        }

        const result = normalizeImportedDesign(parsed);
        if (!result.ok) {
          useAppStore
            .getState()
            .showToast(`Invalid design file: ${result.error}`, "error");
          return result;
        }

        const now = new Date().toISOString();
        const design: SavedDesign = {
          id: `design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: `${result.name} (imported)`,
          problemId: result.problemId,
          nodes: result.nodes,
          edges: result.edges,
          annotations: [],
          strokes: result.strokes,
          simulationConfig: result.simulationConfig,
          createdAt: now,
          updatedAt: now,
        };

        set((s) => ({ designs: [design, ...s.designs] }));
        useAppStore.getState().showToast("Design imported", "success");
        return { ok: true, id: design.id };
      },
    }),
    {
      name: "systemsim-saved-designs",
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() => safeLocalStorage),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      migrate: (state) => state as any,
    }
  )
);

/** Helper: get problem title by id (built-in or custom problems). */
export function getProblemTitle(problemId: string | null): string {
  if (!problemId) return "No problem";
  const builtin = PROBLEMS.find((p) => p.id === problemId)?.title;
  if (builtin) return builtin;
  const custom = useCustomProblemsStore
    .getState()
    .problems.find((p) => p.id === problemId)?.title;
  return custom ?? problemId;
}
