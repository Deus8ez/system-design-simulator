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
export type EndpointFieldType = "string" | "number" | "boolean";
export type RequestFieldLocation = "path" | "query" | "body";

export interface EndpointFieldDefinition {
  id: string;
  name: string;
  type: EndpointFieldType;
  location?: RequestFieldLocation;
}

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
  /** Optional typed contract; when omitted, legacy endpoints remain untyped. */
  requestFields?: EndpointFieldDefinition[];
  responseFields?: EndpointFieldDefinition[];
  steps: EndpointLogicStep[];
}

/** Exact HTTP method/path mapping from an API Gateway to a service endpoint. */
export interface GatewayRouteDefinition {
  id: string;
  method: EndpointMethod;
  path: string;
  /** Connected App Server node that owns the matching endpoint. */
  backendNodeId?: string;
  /** Relative share for selecting among distinct backend services. */
  trafficWeight?: number;
}

export type CacheEvictionPolicy =
  | "noeviction"
  | "allkeys-lru"
  | "allkeys-lfu"
  | "volatile-lru"
  | "volatile-ttl";

/** Redis settings currently validated/documented but not used in estimates. */
export interface CacheConfiguration {
  maxMemoryMB?: number;
  defaultTtlSeconds?: number;
  evictionPolicy?: CacheEvictionPolicy;
}

export type RateLimitAlgorithm = "token-bucket" | "sliding-window";
export type RateLimitKey = "global" | "client-id" | "ip" | "api-key";

/** Aggregate sustained-rate estimate for a limiter; burst timing is not simulated. */
export interface RateLimiterConfiguration {
  algorithm?: RateLimitAlgorithm;
  keyBy?: RateLimitKey;
  requestsPerWindow?: number;
  windowSeconds?: number;
  /** Estimated concurrent keys used to scale a per-key quota into aggregate QPS. */
  estimatedDistinctKeys?: number;
  /** Token capacity metadata; single-load simulations do not model transient bursts. */
  burstCapacity?: number;
}

export interface QueueTopicDefinition {
  id: string;
  name: string;
  retentionHours?: number;
}

export interface QueueConsumerSubscription {
  id: string;
  consumerNodeId: string;
  topicName: string;
}

export interface QueueConfiguration {
  topics: QueueTopicDefinition[];
  /** Optional explicit topic-to-consumer contracts; absent on legacy designs. */
  subscriptions?: QueueConsumerSubscription[];
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
