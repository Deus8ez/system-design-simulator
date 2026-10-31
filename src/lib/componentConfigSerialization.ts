import type {
  CacheConfiguration,
  CacheEvictionPolicy,
  DatabaseColumn,
  DatabaseIndex,
  DatabaseTable,
  EndpointDefinition,
  EndpointFieldDefinition,
  EndpointFieldType,
  EndpointLogicKind,
  EndpointLogicStep,
  EndpointMethod,
  GatewayRouteDefinition,
  QueueConsumerSubscription,
  QueueConfiguration,
  QueueDeliveryMode,
  QueueTopicDefinition,
  RateLimitAlgorithm,
  RateLimitKey,
  RateLimiterConfiguration,
} from "@/types/component";

export interface SerializedComponentConfiguration {
  endpoints?: EndpointDefinition[];
  routes?: GatewayRouteDefinition[];
  cacheConfig?: CacheConfiguration;
  tables?: DatabaseTable[];
  queueConfig?: QueueConfiguration;
  queueDeliveryMode?: QueueDeliveryMode;
  rateLimiterConfig?: RateLimiterConfiguration;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

const ENDPOINT_METHODS = new Set<EndpointMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ENDPOINT_FIELD_TYPES = new Set<EndpointFieldType>(["string", "number", "boolean"]);
const REQUEST_FIELD_LOCATIONS = new Set(["path", "query", "body"]);
const ENDPOINT_LOGIC_KINDS = new Set<EndpointLogicKind>([
  "authenticate", "validate", "cache-read", "database-read", "database-write",
  "cache-invalidate", "publish-event", "route", "respond",
]);
const CACHE_EVICTION_POLICIES = new Set<CacheEvictionPolicy>([
  "noeviction", "allkeys-lru", "allkeys-lfu", "volatile-lru", "volatile-ttl",
]);
const RATE_LIMIT_ALGORITHMS = new Set<RateLimitAlgorithm>(["token-bucket", "sliding-window"]);
const RATE_LIMIT_KEYS = new Set<RateLimitKey>(["global", "client-id", "ip", "api-key"]);

function normalizeEndpoints(raw: unknown): EndpointDefinition[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(isRecord).map((endpoint, endpointIndex) => {
    const rawSteps = Array.isArray(endpoint.steps) ? endpoint.steps : [];
    const steps: EndpointLogicStep[] = rawSteps.filter(isRecord).flatMap((step, stepIndex) => {
      if (typeof step.kind !== "string" || !ENDPOINT_LOGIC_KINDS.has(step.kind as EndpointLogicKind)) return [];
      return [{
        id: str(step.id, `step-${endpointIndex}-${stepIndex}`),
        kind: step.kind as EndpointLogicKind,
        targetNodeId: typeof step.targetNodeId === "string" ? step.targetNodeId : undefined,
        target: typeof step.target === "string" ? step.target : undefined,
        condition: typeof step.condition === "string" ? step.condition : undefined,
        cacheHitRate: typeof step.cacheHitRate === "number" && Number.isFinite(step.cacheHitRate)
          ? Math.min(1, Math.max(0, step.cacheHitRate))
          : undefined,
        matchRate: typeof step.matchRate === "number" && Number.isFinite(step.matchRate)
          ? Math.min(1, Math.max(0, step.matchRate))
          : undefined,
        retryAttempts: typeof step.retryAttempts === "number" && Number.isFinite(step.retryAttempts)
          ? Math.min(5, Math.max(0, Math.floor(step.retryAttempts)))
          : undefined,
        retryFailureRate: typeof step.retryFailureRate === "number" && Number.isFinite(step.retryFailureRate)
          ? Math.min(1, Math.max(0, step.retryFailureRate))
          : undefined,
      }];
    });
    const method = typeof endpoint.method === "string" && ENDPOINT_METHODS.has(endpoint.method as EndpointMethod)
      ? endpoint.method as EndpointMethod
      : "GET";
    const normalizeFields = (value: unknown, includeLocation: boolean): EndpointFieldDefinition[] | undefined => {
      if (!Array.isArray(value)) return undefined;
      return value.filter(isRecord).map((field, fieldIndex) => ({
        id: str(field.id, `field-${endpointIndex}-${fieldIndex}`),
        name: str(field.name, ""),
        type: typeof field.type === "string" && ENDPOINT_FIELD_TYPES.has(field.type as EndpointFieldType)
          ? field.type as EndpointFieldType
          : typeof field.type === "string"
            ? field.type as EndpointFieldType
            : "string",
        ...(includeLocation ? {
          location: typeof field.location === "string" && REQUEST_FIELD_LOCATIONS.has(field.location)
            ? field.location as EndpointFieldDefinition["location"]
            : typeof field.location === "string"
              ? field.location as EndpointFieldDefinition["location"]
              : "body" as const,
        } : {}),
      }));
    };
    return {
      id: str(endpoint.id, `endpoint-${endpointIndex}`),
      method,
      path: str(endpoint.path, "/"),
      trafficWeight: typeof endpoint.trafficWeight === "number" && Number.isFinite(endpoint.trafficWeight)
        ? Math.max(0.01, endpoint.trafficWeight)
        : 1,
      requestFields: normalizeFields(endpoint.requestFields, true),
      responseFields: normalizeFields(endpoint.responseFields, false),
      steps,
    };
  });
}

function normalizeGatewayRoutes(raw: unknown): GatewayRouteDefinition[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(isRecord).map((route, index) => ({
    id: str(route.id, `gateway-route-${index}`),
    method: str(route.method, "") as EndpointMethod,
    path: str(route.path, ""),
    backendNodeId: typeof route.backendNodeId === "string" ? route.backendNodeId : undefined,
    trafficWeight: typeof route.trafficWeight === "number" && Number.isFinite(route.trafficWeight)
      ? route.trafficWeight
      : undefined,
  }));
}

function normalizeCacheConfiguration(raw: unknown): CacheConfiguration | undefined {
  if (!isRecord(raw)) return undefined;
  return {
    maxMemoryMB: typeof raw.maxMemoryMB === "number" ? raw.maxMemoryMB : undefined,
    defaultTtlSeconds: typeof raw.defaultTtlSeconds === "number" ? raw.defaultTtlSeconds : undefined,
    evictionPolicy: typeof raw.evictionPolicy === "string" && CACHE_EVICTION_POLICIES.has(raw.evictionPolicy as CacheEvictionPolicy)
      ? raw.evictionPolicy as CacheEvictionPolicy
      : raw.evictionPolicy === undefined
        ? undefined
        : raw.evictionPolicy as CacheEvictionPolicy,
  };
}

function normalizeQueueConfiguration(raw: unknown): QueueConfiguration | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.topics)) return undefined;
  const topics: QueueTopicDefinition[] = raw.topics.filter(isRecord).map((topic, index) => ({
    id: str(topic.id, `topic-${index}`),
    name: str(topic.name, ""),
    retentionHours: typeof topic.retentionHours === "number" ? topic.retentionHours : undefined,
  }));
  const subscriptions = Array.isArray(raw.subscriptions)
    ? raw.subscriptions.map((candidate, index) => {
        const subscription = isRecord(candidate) ? candidate : {};
        return {
          id: str(subscription.id, `subscription-${index}`),
          consumerNodeId: str(subscription.consumerNodeId, ""),
          topicName: str(subscription.topicName, ""),
        };
      })
    : raw.subscriptions as QueueConsumerSubscription[] | undefined;
  return {
    topics,
    // Keep malformed entries visible as empty fields so the compiler can
    // diagnose them and the editor can offer a repair path.
    subscriptions,
  };
}

function normalizeRateLimiterConfiguration(raw: unknown): RateLimiterConfiguration | undefined {
  if (!isRecord(raw)) return undefined;
  return {
    algorithm: typeof raw.algorithm === "string" && RATE_LIMIT_ALGORITHMS.has(raw.algorithm as RateLimitAlgorithm)
      ? raw.algorithm as RateLimitAlgorithm
      : raw.algorithm === undefined
        ? undefined
        : raw.algorithm as RateLimitAlgorithm,
    keyBy: typeof raw.keyBy === "string" && RATE_LIMIT_KEYS.has(raw.keyBy as RateLimitKey)
      ? raw.keyBy as RateLimitKey
      : raw.keyBy === undefined
        ? undefined
        : raw.keyBy as RateLimitKey,
    requestsPerWindow: typeof raw.requestsPerWindow === "number" ? raw.requestsPerWindow : undefined,
    windowSeconds: typeof raw.windowSeconds === "number" ? raw.windowSeconds : undefined,
    estimatedDistinctKeys: typeof raw.estimatedDistinctKeys === "number" ? raw.estimatedDistinctKeys : undefined,
    burstCapacity: typeof raw.burstCapacity === "number" ? raw.burstCapacity : undefined,
  };
}

function normalizeTables(raw: unknown): DatabaseTable[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(isRecord).map((table, tableIndex) => {
    const columns: DatabaseColumn[] = (Array.isArray(table.columns) ? table.columns : [])
      .filter(isRecord)
      .map((column, columnIndex) => ({
        id: str(column.id, `column-${tableIndex}-${columnIndex}`),
        name: str(column.name, `column_${columnIndex + 1}`),
        dataType: str(column.dataType, "TEXT"),
        nullable: column.nullable !== false,
        primaryKey: column.primaryKey === true,
      }));
    const columnNames = new Set(columns.map((column) => column.name));
    const indexes: DatabaseIndex[] = (Array.isArray(table.indexes) ? table.indexes : [])
      .filter(isRecord)
      .map((index, indexNumber) => ({
        id: str(index.id, `index-${tableIndex}-${indexNumber}`),
        name: str(index.name, `idx_${str(table.name, `table_${tableIndex + 1}`)}_${indexNumber + 1}`),
        columns: Array.isArray(index.columns)
          ? index.columns.filter((name): name is string => typeof name === "string" && columnNames.has(name))
          : [],
        unique: index.unique === true,
      }))
      .filter((index) => index.columns.length > 0);
    return {
      id: str(table.id, `table-${tableIndex}`),
      name: str(table.name, `table_${tableIndex + 1}`),
      estimatedRows: typeof table.estimatedRows === "number" && Number.isFinite(table.estimatedRows)
        ? Math.min(1_000_000_000_000, Math.max(1, Math.floor(table.estimatedRows)))
        : 1000,
      columns,
      indexes,
    };
  });
}

/** Normalize optional runtime-model fields shared by design serialization and imports. */
export function normalizeComponentConfiguration(raw: unknown): SerializedComponentConfiguration {
  const data = isRecord(raw) ? raw : {};
  return {
    endpoints: normalizeEndpoints(data.endpoints),
    routes: normalizeGatewayRoutes(data.routes),
    cacheConfig: normalizeCacheConfiguration(data.cacheConfig),
    tables: normalizeTables(data.tables),
    queueConfig: normalizeQueueConfiguration(data.queueConfig),
    queueDeliveryMode: data.queueDeliveryMode === "competing" ? "competing" : "broadcast",
    rateLimiterConfig: normalizeRateLimiterConfiguration(data.rateLimiterConfig),
  };
}

/** Preserve valid, typed runtime-model fields without serializing unrelated node data. */
export function serializeComponentConfiguration(raw: unknown): SerializedComponentConfiguration {
  const data = isRecord(raw) ? raw : {};
  return {
    endpoints: Array.isArray(data.endpoints) ? data.endpoints as EndpointDefinition[] : undefined,
    routes: Array.isArray(data.routes) ? data.routes as GatewayRouteDefinition[] : undefined,
    cacheConfig: isRecord(data.cacheConfig) ? data.cacheConfig as CacheConfiguration : undefined,
    tables: Array.isArray(data.tables) ? data.tables as DatabaseTable[] : undefined,
    queueConfig: normalizeQueueConfiguration(data.queueConfig),
    queueDeliveryMode: data.queueDeliveryMode === "competing" ? "competing" : "broadcast",
    rateLimiterConfig: isRecord(data.rateLimiterConfig)
      ? data.rateLimiterConfig as RateLimiterConfiguration
      : undefined,
  };
}
