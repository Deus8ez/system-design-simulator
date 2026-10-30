export type ComponentCategory =
  | "networking"
  | "compute"
  | "storage"
  | "messaging"
  | "infrastructure";

export interface SystemComponent {
  id: string;
  label: string;
  category: ComponentCategory;
  icon: string; // lucide icon name
  maxQPS: number;
  latencyMs: number;
  scalable: boolean;
  stateful: boolean;
  description: string;
}

export type EndpointMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type EndpointLogicKind =
  | "authenticate"
  | "validate"
  | "cache-read"
  | "database-read"
  | "database-write"
  | "cache-invalidate"
  | "publish-event"
  | "route"
  | "respond";

/** One ordered operation in an endpoint's request pipeline. */
export interface EndpointLogicStep {
  id: string;
  kind: EndpointLogicKind;
  /** Canvas node ID for the downstream component that performs this operation. */
  targetNodeId?: string;
  target?: string;
  condition?: string;
  /** Cache hit probability in the range [0, 1], used by cache-read steps. */
  cacheHitRate?: number;
  /** Fraction of remaining route traffic matched by this route step. */
  matchRate?: number;
  /** Additional attempts after the first; bounded by the simulator. */
  retryAttempts?: number;
  /** Per-attempt failure probability in the range [0, 1]. */
  retryFailureRate?: number;
}

export interface EndpointDefinition {
  id: string;
  method: EndpointMethod;
  path: string;
  /** Relative request volume; endpoint weights are normalized per app server. */
  trafficWeight?: number;
  steps: EndpointLogicStep[];
}

export interface DatabaseColumn {
  id: string;
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface DatabaseIndex {
  id: string;
  name: string;
  columns: string[];
  unique: boolean;
}

export interface DatabaseTable {
  id: string;
  name: string;
  /** Approximate row count used to scale simulated scan and index work. */
  estimatedRows?: number;
  columns: DatabaseColumn[];
  indexes: DatabaseIndex[];
}

export type QueueDeliveryMode = "broadcast" | "competing";
