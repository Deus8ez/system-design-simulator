import type { ReferenceLoadTier, ReferenceSolution, ReferenceVariant } from "@/types/problem";

type TierSpec = {
  requestsPerSec: number;
  summary: string;
  replicas: Partial<Record<string, number>>;
  addNodes?: ReferenceSolution["nodes"];
  removeComponents?: string[];
  removeEdges?: Array<{ source: string; target: string }>;
  addEdges?: ReferenceSolution["edges"];
};

type SystemTierSpecs = Record<ReferenceLoadTier, TierSpec>;

// Independently authored low-load starting graphs. Medium and high tiers evolve
// these graphs with explicit topology deltas as new bottlenecks emerge.
const BASE_TOPOLOGIES: Record<string, ReferenceSolution> = {
  "url-shortener": { nodes: [{ componentId: "dns", x: 80, y: 240 }, { componentId: "load-balancer", x: 280, y: 240 }, { componentId: "api-gateway", x: 480, y: 240 }, { componentId: "app-server", x: 680, y: 240 }, { componentId: "nosql-db", x: 900, y: 240 }], edges: [{ source: "dns", target: "load-balancer" }, { source: "load-balancer", target: "api-gateway" }, { source: "api-gateway", target: "app-server" }, { source: "app-server", target: "nosql-db" }] },
  "video-streaming": { nodes: [{ componentId: "dns", x: 60, y: 250 }, { componentId: "cdn", x: 260, y: 90 }, { componentId: "load-balancer", x: 260, y: 260 }, { componentId: "api-gateway", x: 460, y: 260 }, { componentId: "app-server", x: 660, y: 260 }, { componentId: "sql-db", x: 900, y: 260 }, { componentId: "object-storage", x: 460, y: 80 }], edges: [{ source: "dns", target: "cdn" }, { source: "cdn", target: "object-storage" }, { source: "dns", target: "load-balancer" }, { source: "load-balancer", target: "api-gateway" }, { source: "api-gateway", target: "app-server" }, { source: "app-server", target: "sql-db" }] },
  "rate-limiter": { nodes: [{ componentId: "dns", x: 60, y: 240 }, { componentId: "load-balancer", x: 250, y: 240 }, { componentId: "rate-limiter", x: 450, y: 240 }, { componentId: "api-gateway", x: 650, y: 240 }, { componentId: "app-server", x: 850, y: 240 }], edges: [{ source: "dns", target: "load-balancer" }, { source: "load-balancer", target: "rate-limiter" }, { source: "rate-limiter", target: "api-gateway" }, { source: "api-gateway", target: "app-server" }] },
  "notification-system": { nodes: [{ componentId: "dns", x: 60, y: 240 }, { componentId: "load-balancer", x: 240, y: 240 }, { componentId: "api-gateway", x: 420, y: 240 }, { componentId: "app-server", x: 620, y: 240 }, { componentId: "sql-db", x: 850, y: 100 }, { componentId: "nosql-db", x: 850, y: 260 }, { componentId: "message-queue", x: 620, y: 430 }, { componentId: "notification-service", x: 850, y: 430 }], edges: [{ source: "dns", target: "load-balancer" }, { source: "load-balancer", target: "api-gateway" }, { source: "api-gateway", target: "app-server" }, { source: "app-server", target: "sql-db" }, { source: "app-server", target: "nosql-db" }, { source: "app-server", target: "message-queue", data: { protocol: "pubsub", async: true } }, { source: "message-queue", target: "notification-service", data: { protocol: "pubsub", async: true } }, { source: "notification-service", target: "nosql-db" }] },
  "parking-lot": { nodes: [{ componentId: "dns", x: 60, y: 240 }, { componentId: "load-balancer", x: 240, y: 240 }, { componentId: "api-gateway", x: 420, y: 240 }, { componentId: "app-server", x: 620, y: 240 }, { componentId: "sql-db", x: 850, y: 240 }, { componentId: "cache", x: 620, y: 80 }], edges: [{ source: "dns", target: "load-balancer" }, { source: "load-balancer", target: "api-gateway" }, { source: "api-gateway", target: "app-server" }, { source: "app-server", target: "cache" }, { source: "app-server", target: "sql-db" }] },
  instagram: { nodes: [{ componentId: "dns", x: 60, y: 250 }, { componentId: "cdn", x: 250, y: 90 }, { componentId: "load-balancer", x: 250, y: 250 }, { componentId: "api-gateway", x: 440, y: 250 }, { componentId: "app-server", x: 640, y: 250 }, { componentId: "nosql-db", x: 880, y: 250 }, { componentId: "object-storage", x: 440, y: 80 }], edges: [{ source: "dns", target: "cdn" }, { source: "cdn", target: "object-storage" }, { source: "dns", target: "load-balancer" }, { source: "load-balancer", target: "api-gateway" }, { source: "api-gateway", target: "app-server" }, { source: "app-server", target: "nosql-db" }] },
  "music-streaming": { nodes: [{ componentId: "dns", x: 60, y: 250 }, { componentId: "cdn", x: 250, y: 90 }, { componentId: "load-balancer", x: 250, y: 250 }, { componentId: "api-gateway", x: 440, y: 250 }, { componentId: "app-server", x: 640, y: 250 }, { componentId: "nosql-db", x: 880, y: 250 }, { componentId: "object-storage", x: 440, y: 80 }], edges: [{ source: "dns", target: "cdn" }, { source: "cdn", target: "object-storage" }, { source: "dns", target: "load-balancer" }, { source: "load-balancer", target: "api-gateway" }, { source: "api-gateway", target: "app-server" }, { source: "app-server", target: "nosql-db" }, { source: "app-server", target: "object-storage" }] },
};

const TIER_SETTINGS: Record<string, SystemTierSpecs> = {
  "url-shortener": {
    low: { requestsPerSec: 1_000, summary: "Single-instance redirect and link-creation baseline.", replicas: { "load-balancer": 1, "api-gateway": 1, "app-server": 1, "nosql-db": 1 } },
    medium: { requestsPerSec: 10_000, summary: "Cache-aside redirects reduce repeated database lookups while link creation remains on the durable write path.", replicas: { "load-balancer": 1, "api-gateway": 2, "app-server": 3, cache: 2, "nosql-db": 2 }, addNodes: [{ componentId: "cache", x: 680, y: 70 }], addEdges: [{ source: "app-server", target: "cache" }] },
    high: { requestsPerSec: 100_000, summary: "High-traffic redirects add edge delivery and abuse protection ahead of the cache-backed redirect path.", replicas: { "load-balancer": 2, "api-gateway": 4, "app-server": 20, cache: 6, "nosql-db": 4, "rate-limiter": 2 }, addNodes: [{ componentId: "cache", x: 680, y: 70 }, { componentId: "cdn", x: 250, y: 70 }, { componentId: "rate-limiter", x: 450, y: 430 }], removeEdges: [{ source: "dns", target: "load-balancer" }, { source: "load-balancer", target: "api-gateway" }], addEdges: [{ source: "dns", target: "cdn" }, { source: "cdn", target: "load-balancer" }, { source: "load-balancer", target: "rate-limiter" }, { source: "rate-limiter", target: "api-gateway" }, { source: "app-server", target: "cache" }] },
  },
  "video-streaming": {
    low: { requestsPerSec: 1_000, summary: "A minimal catalog API serves metadata while media is stored as objects.", replicas: { "load-balancer": 1, "api-gateway": 1, "app-server": 1, "sql-db": 1 } },
    medium: { requestsPerSec: 10_000, summary: "Playback metadata is cached and upload processing is queued to independent workers.", replicas: { "load-balancer": 2, "api-gateway": 2, "app-server": 4, cache: 3, "stream-processor": 4, "sql-db": 2 }, addNodes: [{ componentId: "cache", x: 660, y: 80 }, { componentId: "message-queue", x: 660, y: 440 }, { componentId: "stream-processor", x: 900, y: 440 }], addEdges: [{ source: "app-server", target: "cache" }, { source: "app-server", target: "message-queue", data: { protocol: "pubsub", async: true } }, { source: "message-queue", target: "stream-processor", data: { protocol: "pubsub", async: true } }, { source: "stream-processor", target: "object-storage", data: { protocol: "http", async: true } }] },
    high: { requestsPerSec: 100_000, summary: "Global playback adds a dedicated origin shield; processing and metadata tiers scale independently.", replicas: { "load-balancer": 4, "api-gateway": 5, "app-server": 20, cache: 6, "stream-processor": 10, "sql-db": 4, cdn: 6, "origin-shield": 3, "message-queue": 4 }, addNodes: [{ componentId: "origin-shield", x: 440, y: 70 }, { componentId: "cache", x: 660, y: 80 }, { componentId: "message-queue", x: 660, y: 440 }, { componentId: "stream-processor", x: 900, y: 440 }], addEdges: [{ source: "cdn", target: "origin-shield" }, { source: "origin-shield", target: "object-storage" }, { source: "app-server", target: "cache" }, { source: "app-server", target: "message-queue", data: { protocol: "pubsub", async: true } }, { source: "message-queue", target: "stream-processor", data: { protocol: "pubsub", async: true } }, { source: "stream-processor", target: "object-storage", data: { protocol: "http", async: true } }] },
  },
  "rate-limiter": {
    low: { requestsPerSec: 1_000, summary: "One policy service checks requests before they reach the API.", replicas: { "load-balancer": 1, "rate-limiter": 1, "api-gateway": 1, "app-server": 1 } },
    medium: { requestsPerSec: 10_000, summary: "Limiter instances share policy state through a cache-backed counter tier.", replicas: { "load-balancer": 1, "rate-limiter": 2, "api-gateway": 2, "app-server": 3, cache: 2 }, addNodes: [{ componentId: "cache", x: 450, y: 80 }], addEdges: [{ source: "rate-limiter", target: "cache" }] },
    high: { requestsPerSec: 50_000, summary: "A sharded policy tier and monitoring isolate quota checks from application scaling.", replicas: { "load-balancer": 2, "rate-limiter": 4, "api-gateway": 4, "app-server": 10, cache: 4, monitoring: 2 }, addNodes: [{ componentId: "cache", x: 450, y: 80 }, { componentId: "monitoring", x: 850, y: 80 }], addEdges: [{ source: "rate-limiter", target: "cache" }, { source: "app-server", target: "monitoring" }] },
  },
  "notification-system": {
    low: { requestsPerSec: 1_000, summary: "Notification acceptance persists requests and hands delivery to a worker asynchronously.", replicas: { "load-balancer": 1, "api-gateway": 1, "app-server": 1, "message-queue": 1, "notification-service": 1, "sql-db": 1, "nosql-db": 1 }, removeComponents: ["cache"], addEdges: [{ source: "app-server", target: "message-queue", data: { protocol: "pubsub", async: true } }] },
    medium: { requestsPerSec: 10_000, summary: "Preferences are cached and channel workers consume durable notification jobs independently.", replicas: { "load-balancer": 2, "api-gateway": 2, "app-server": 4, cache: 2, "message-queue": 2, "notification-service": 3, "nosql-db": 2, "sql-db": 2 }, addNodes: [{ componentId: "cache", x: 620, y: 80 }], addEdges: [{ source: "app-server", target: "cache" }, { source: "app-server", target: "message-queue", data: { protocol: "pubsub", async: true } }] },
    high: { requestsPerSec: 100_000, summary: "High-volume intake scales notification delivery independently and adds monitoring for queue and channel-worker health.", replicas: { "load-balancer": 4, "api-gateway": 5, "app-server": 20, cache: 6, "message-queue": 4, "notification-service": 12, "nosql-db": 5, "sql-db": 4, monitoring: 2 }, addNodes: [{ componentId: "cache", x: 620, y: 80 }, { componentId: "monitoring", x: 1080, y: 430 }], addEdges: [{ source: "app-server", target: "cache" }, { source: "app-server", target: "message-queue", data: { protocol: "pubsub", async: true } }, { source: "notification-service", target: "monitoring" }] },
  },
  "parking-lot": {
    low: { requestsPerSec: 1_000, summary: "A reservation API writes authoritative spot state to SQL.", replicas: { "load-balancer": 1, "api-gateway": 1, "app-server": 1, "sql-db": 1 }, removeComponents: ["cache"] },
    medium: { requestsPerSec: 10_000, summary: "Availability reads use the existing cache and occupancy changes flow through a durable event queue.", replicas: { "load-balancer": 2, "api-gateway": 2, "app-server": 3, cache: 2, "message-queue": 2, "sql-db": 2 }, addNodes: [{ componentId: "message-queue", x: 620, y: 430 }], addEdges: [{ source: "app-server", target: "message-queue", data: { protocol: "pubsub", async: true } }, { source: "message-queue", target: "sql-db", data: { protocol: "pubsub", async: true } }] },
    high: { requestsPerSec: 100_000, summary: "High reservation traffic scales the API and durable event path, with monitoring for capacity and occupancy signals.", replicas: { "load-balancer": 4, "api-gateway": 4, "app-server": 20, cache: 6, "message-queue": 4, "sql-db": 4, monitoring: 2 }, addNodes: [{ componentId: "message-queue", x: 620, y: 430 }, { componentId: "monitoring", x: 880, y: 80 }], addEdges: [{ source: "app-server", target: "monitoring" }, { source: "app-server", target: "message-queue", data: { protocol: "pubsub", async: true } }, { source: "message-queue", target: "sql-db", data: { protocol: "pubsub", async: true } }] },
  },
  instagram: {
    low: { requestsPerSec: 1_000, summary: "A compact publishing and feed API stores post metadata and media objects separately.", replicas: { "load-balancer": 1, "api-gateway": 1, "app-server": 1, "nosql-db": 1, "object-storage": 1 } },
    medium: { requestsPerSec: 10_000, summary: "Photo derivatives are processed asynchronously while feed reads use a cache tier.", replicas: { "load-balancer": 2, "api-gateway": 2, "app-server": 4, cache: 3, "message-queue": 2, "stream-processor": 3, "nosql-db": 2, "object-storage": 2 }, addNodes: [{ componentId: "cache", x: 640, y: 80 }, { componentId: "message-queue", x: 640, y: 430 }, { componentId: "stream-processor", x: 880, y: 430 }], addEdges: [{ source: "app-server", target: "cache" }, { source: "app-server", target: "message-queue", data: { protocol: "pubsub", async: true } }, { source: "message-queue", target: "stream-processor", data: { protocol: "pubsub", async: true } }, { source: "stream-processor", target: "object-storage", data: { protocol: "http", async: true } }] },
    high: { requestsPerSec: 100_000, summary: "Global feed delivery scales media-processing workers and adds monitoring around the high-volume publishing path.", replicas: { "load-balancer": 4, "api-gateway": 5, "app-server": 20, cache: 8, "message-queue": 4, "stream-processor": 10, "nosql-db": 5, "object-storage": 4, cdn: 6, monitoring: 3 }, addNodes: [{ componentId: "cache", x: 640, y: 80 }, { componentId: "message-queue", x: 640, y: 430 }, { componentId: "stream-processor", x: 880, y: 430 }, { componentId: "monitoring", x: 1100, y: 80 }], addEdges: [{ source: "app-server", target: "cache" }, { source: "app-server", target: "message-queue", data: { protocol: "pubsub", async: true } }, { source: "message-queue", target: "stream-processor", data: { protocol: "pubsub", async: true } }, { source: "stream-processor", target: "object-storage", data: { protocol: "http", async: true } }, { source: "app-server", target: "monitoring" }] },
  },
  "music-streaming": {
    low: { requestsPerSec: 1_000, summary: "The catalog API and audio objects have separate storage responsibilities.", replicas: { "load-balancer": 1, "api-gateway": 1, "app-server": 1, "nosql-db": 1, "object-storage": 1 } },
    medium: { requestsPerSec: 10_000, summary: "Hot catalog reads use cache and play events are recorded asynchronously.", replicas: { "load-balancer": 2, "api-gateway": 2, "app-server": 4, cache: 3, "message-queue": 2, "nosql-db": 2, "object-storage": 2 }, addNodes: [{ componentId: "cache", x: 640, y: 80 }, { componentId: "message-queue", x: 640, y: 430 }], addEdges: [{ source: "app-server", target: "cache" }, { source: "app-server", target: "message-queue", data: { protocol: "pubsub", async: true } }, { source: "message-queue", target: "nosql-db", data: { protocol: "pubsub", async: true } }] },
    high: { requestsPerSec: 100_000, summary: "Audio delivery uses the existing CDN edge path while dedicated stream processors consume play events independently.", replicas: { "load-balancer": 4, "api-gateway": 5, "app-server": 20, cache: 6, "message-queue": 3, "nosql-db": 4, "object-storage": 4, cdn: 8, "stream-processor": 8 }, addNodes: [{ componentId: "cache", x: 640, y: 80 }, { componentId: "message-queue", x: 640, y: 430 }, { componentId: "stream-processor", x: 880, y: 430 }], addEdges: [{ source: "app-server", target: "cache" }, { source: "app-server", target: "message-queue", data: { protocol: "pubsub", async: true } }, { source: "message-queue", target: "stream-processor", data: { protocol: "pubsub", async: true } }, { source: "stream-processor", target: "nosql-db", data: { protocol: "pubsub", async: true } }] },
  },
};

function createVariantSolution(problemId: string, spec: TierSpec): ReferenceSolution {
  const base = BASE_TOPOLOGIES[problemId];
  const removed = new Set(spec.removeComponents ?? []);
  const nodes = [...base.nodes.filter((node) => !removed.has(node.componentId)), ...(spec.addNodes ?? [])]
    .map((node) => ({ ...node, replicas: spec.replicas[node.componentId] ?? node.replicas ?? 1 }));
  const present = new Set(nodes.map(({ componentId }) => componentId));
  const edgeMap = new Map<string, ReferenceSolution["edges"][number]>();
  const removedEdges = new Set((spec.removeEdges ?? []).map(({ source, target }) => `${source}->${target}`));
  for (const edge of [...base.edges, ...(spec.addEdges ?? [])]) {
    if (!present.has(edge.source) || !present.has(edge.target)) continue;
    const key = `${edge.source}->${edge.target}`;
    if (removedEdges.has(key)) {
      edgeMap.delete(key);
      continue;
    }
    const previous = edgeMap.get(key);
    edgeMap.set(key, {
      ...previous,
      ...edge,
      data: previous?.data || edge.data
        ? { ...previous?.data, ...edge.data }
        : undefined,
    });
  }
  const edges = [...edgeMap.values()];
  for (const edge of edges) {
    if (edge.data?.async !== undefined || edge.data?.protocol !== undefined) continue;
    const isVideoProcessingStorageWrite = problemId === "video-streaming" && edge.source === "stream-processor" && edge.target === "object-storage";
    const isAsyncPubSubEdge =
      (problemId === "parking-lot" && edge.source === "message-queue" && edge.target === "sql-db") ||
      (problemId === "music-streaming" && edge.source === "message-queue" && edge.target === "nosql-db") ||
      (problemId === "instagram" && edge.source === "message-queue" && edge.target === "stream-processor") ||
      (problemId === "video-streaming" && edge.source === "message-queue" && edge.target === "stream-processor");
    if (isVideoProcessingStorageWrite) edge.data = { protocol: "http", async: true };
    else if (isAsyncPubSubEdge) edge.data = { protocol: "pubsub", async: true };
  }
  return { nodes, edges };
}

export const REFERENCE_VARIANTS: Partial<Record<string, Partial<Record<ReferenceLoadTier, ReferenceVariant>>>> =
  Object.fromEntries(Object.entries(TIER_SETTINGS).map(([problemId, tiers]) => [problemId,
    Object.fromEntries(Object.entries(tiers).map(([tier, settings]) => [tier, {
      tier: tier as ReferenceLoadTier,
      requestsPerSec: settings.requestsPerSec,
      summary: settings.summary,
      solution: createVariantSolution(problemId, settings),
    }]))
  ]));

export function getReferenceVariant(problemId: string, tier: ReferenceLoadTier): ReferenceVariant | undefined {
  return REFERENCE_VARIANTS[problemId]?.[tier];
}

export function hasCompleteReference(problemId: string): boolean {
  const variants = REFERENCE_VARIANTS[problemId];
  return Boolean(variants?.low && variants.medium && variants.high);
}