export type NodeStatus = "healthy" | "warning" | "critical" | "idle";

export interface NodeMetrics {
  nodeId: string;
  incomingQPS: number;
  effectiveQPS: number;
  utilization: number;
  latencyMs: number;
  status: NodeStatus;
  isBottleneck: boolean;
  failedQPS?: number;
  rejectedQPS?: number;
  queueDepth?: number;
  queueBacklogQPS?: number;
}

export interface SimulationResult {
  nodeMetrics: Map<string, NodeMetrics>;
  totalLatencyMs: number;
  bottleneckNodes: string[];
  throughput: number;
  failedOperationsPerSec: number;
  rejectedRequestsPerSec: number;
  timestamp: number;
  warnings: string[];
}

export interface SimulationConfig {
  requestsPerSec: number;
  durationSec: number;
  rampUp: boolean;
  faults: Record<string, ComponentFault>;
  requestProfiles: RequestProfile[];
}

export interface RequestProfile {
  name: string;
  trafficWeight: number;
  attributes: Record<string, string | number | boolean>;
  /** Optional fraction of cache reads served from cache, from 0 to 1. */
  cacheHitRate?: number;
}

export type ComponentFault =
  | { mode: "down" }
  | { mode: "degraded"; capacityFactor: number; latencyMultiplier: number };
