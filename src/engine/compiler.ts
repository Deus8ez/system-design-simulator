import type { Edge, Node } from "@xyflow/react";
import type { ComponentNodeData, CustomEdgeData } from "@/store/canvasStore";
import type {
  CacheConfiguration,
  CacheEvictionPolicy,
  DatabaseTable,
  EndpointDefinition,
  EndpointFieldDefinition,
  EndpointFieldType,
  EndpointLogicKind,
  EndpointLogicStep,
  GatewayRouteDefinition,
  QueueConfiguration,
  RateLimitAlgorithm,
  RateLimitKey,
  RateLimiterConfiguration,
} from "@/types/component";
import type { CompileResult, DesignDiagnostic } from "@/types/compiler";
import type { RequestProfile } from "@/types/simulation";

const DATABASE_COMPONENTS = new Set(["sql-db", "nosql-db"]);
const TARGET_TYPES: Partial<Record<EndpointLogicKind, Set<string>>> = {
  "cache-read": new Set(["cache"]),
  "cache-invalidate": new Set(["cache"]),
  "database-read": DATABASE_COMPONENTS,
  "database-write": DATABASE_COMPONENTS,
  "publish-event": new Set(["message-queue", "pub-sub"]),
};
const TARGET_REQUIRED = new Set<EndpointLogicKind>([
  "cache-read", "database-read", "database-write", "cache-invalidate", "publish-event", "route",
]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const CACHE_EVICTION_POLICIES = new Set<CacheEvictionPolicy>([
  "noeviction", "allkeys-lru", "allkeys-lfu", "volatile-lru", "volatile-ttl",
]);
const RATE_LIMIT_ALGORITHMS = new Set<RateLimitAlgorithm>(["token-bucket", "sliding-window"]);
const RATE_LIMIT_KEYS = new Set<RateLimitKey>(["global", "client-id", "ip", "api-key"]);

const CONDITION_TOKEN = /\s*(>=|<=|==|!=|&&|\|\||[()!<>]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|-?(?:\d+\.?\d*|\.\d+)|[A-Za-z_][A-Za-z0-9_.-]*)/y;
const ENDPOINT_FIELD_TYPES = new Set<EndpointFieldType>(["string", "number", "boolean"]);
const REQUEST_FIELD_LOCATIONS = new Set(["path", "query", "body"]);

function isValidCondition(condition: string): boolean {
  const tokens: string[] = [];
  let offset = 0;
  while (offset < condition.length) {
    CONDITION_TOKEN.lastIndex = offset;
    const match = CONDITION_TOKEN.exec(condition);
    if (!match) return condition.slice(offset).trim() === "" && tokens.length > 0;
    tokens.push(match[1]);
    offset = CONDITION_TOKEN.lastIndex;
  }
  if (!tokens.length) return false;

  let position = 0;
  const peek = () => tokens[position];
  const consume = () => tokens[position++];
  const isValue = (token: string | undefined) => Boolean(token && (
    token.startsWith("'") || token.startsWith('"') ||
    /^-?(?:\d+\.?\d*|\.\d+)$/.test(token) ||
    /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(token)
  ));

  const parsePrimary = (): boolean => {
    if (peek() === "(") {
      consume();
      if (!parseOr() || peek() !== ")") return false;
      consume();
      return true;
    }
    if (!isValue(peek())) return false;
    consume();
    return true;
  };
  const parseComparison = (): boolean => {
    if (!parsePrimary()) return false;
    if (["==", "!=", ">", ">=", "<", "<="].includes(peek() ?? "")) {
      consume();
      return parsePrimary();
    }
    return true;
  };
  const parseNot = (): boolean => {
    if (peek() === "!") {
      consume();
      return parseNot();
    }
    return parseComparison();
  };
  const parseAnd = (): boolean => {
    if (!parseNot()) return false;
    while (peek() === "&&") {
      consume();
      if (!parseNot()) return false;
    }
    return true;
  };
  function parseOr(): boolean {
    if (!parseAnd()) return false;
    while (peek() === "||") {
      consume();
      if (!parseAnd()) return false;
    }
    return true;
  }

  return parseOr() && position === tokens.length;
}

function getConditionIdentifiers(condition: string): string[] {
  const identifiers: string[] = [];
  let offset = 0;
  while (offset < condition.length) {
    CONDITION_TOKEN.lastIndex = offset;
    const match = CONDITION_TOKEN.exec(condition);
    if (!match) break;
    const token = match[1];
    if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(token) && !["true", "false"].includes(token.toLowerCase())) {
      identifiers.push(token);
    }
    offset = CONDITION_TOKEN.lastIndex;
  }
  return [...new Set(identifiers)];
}

function validateEndpointFields(
  app: Node<ComponentNodeData>,
  endpoint: EndpointDefinition,
  diagnostics: DesignDiagnostic[],
  requestProfiles?: RequestProfile[]
): void {
  const validateFields = (fields: EndpointFieldDefinition[], label: string, request: boolean) => {
    const names = new Set<string>();
    for (const field of fields) {
      const location = { nodeId: app.id, endpointId: endpoint.id, fieldName: field.name };
      if (!field.name.trim() || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.name)) {
        report(diagnostics, {
          code: "ENDPOINT_FIELD_NAME_INVALID",
          severity: "error",
          message: `${endpoint.method} ${endpoint.path} has an invalid ${label} field name "${field.name}".`,
          remediation: "Use a non-empty identifier containing letters, digits, or underscores, starting with a letter or underscore.",
          ...location,
        });
      }
      if (names.has(field.name)) {
        report(diagnostics, {
          code: "ENDPOINT_FIELD_DUPLICATE",
          severity: "error",
          message: `${endpoint.method} ${endpoint.path} declares ${label} field "${field.name}" more than once.`,
          remediation: "Give each field a unique name within its request or response contract.",
          ...location,
        });
      }
      names.add(field.name);
      if (!ENDPOINT_FIELD_TYPES.has(field.type)) {
        report(diagnostics, {
          code: "ENDPOINT_FIELD_TYPE_INVALID",
          severity: "error",
          message: `${endpoint.method} ${endpoint.path} field "${field.name}" has unsupported type "${field.type}".`,
          remediation: "Choose string, number, or boolean.",
          ...location,
        });
      }
      if (request && field.location !== undefined && !REQUEST_FIELD_LOCATIONS.has(field.location)) {
        report(diagnostics, {
          code: "ENDPOINT_REQUEST_FIELD_LOCATION_INVALID",
          severity: "error",
          message: `${endpoint.method} ${endpoint.path} request field "${field.name}" has an unsupported location.`,
          remediation: "Choose path, query, or body.",
          ...location,
        });
      }
    }
    return names;
  };

  const requestFieldsDeclared = Array.isArray(endpoint.requestFields);
  const requestNames = validateFields(endpoint.requestFields ?? [], "request", true);
  validateFields(endpoint.responseFields ?? [], "response", false);

  // Legacy endpoints without a declared request schema remain valid. Once a
  // schema is provided, conditions may only reference declared request fields.
  if (!requestFieldsDeclared) return;
  for (const step of endpoint.steps) {
    if ((step.kind !== "validate" && step.kind !== "route") || !step.condition?.trim() || !isValidCondition(step.condition)) {
      continue;
    }
    for (const fieldName of getConditionIdentifiers(step.condition)) {
      const location = {
        nodeId: app.id,
        endpointId: endpoint.id,
        stepId: step.id,
        fieldName,
      };
      if (!requestNames.has(fieldName)) {
        report(diagnostics, {
          code: "ENDPOINT_CONDITION_FIELD_UNKNOWN",
          severity: "error",
          message: `${endpoint.method} ${endpoint.path} condition references undeclared request field "${fieldName}".`,
          remediation: "Declare the field in this endpoint's request contract or correct the condition identifier.",
          ...location,
        });
        continue;
      }
      for (const profile of requestProfiles ?? []) {
        if (profile.trafficWeight <= 0 || Object.hasOwn(profile.attributes ?? {}, fieldName)) continue;
        report(diagnostics, {
          code: "REQUEST_PROFILE_FIELD_MISSING",
          severity: "warning",
          message: `Request profile "${profile.name}" does not provide "${fieldName}" used by ${endpoint.method} ${endpoint.path}.`,
          remediation: "Add the attribute to this sample profile; the endpoint contract remains valid and simulation uses its documented fallback behavior when values are absent.",
          ...location,
          profileName: profile.name,
        });
      }
    }
  }
}

function getTables(node: Node<ComponentNodeData>): DatabaseTable[] {
  return Array.isArray(node.data.tables) ? node.data.tables as DatabaseTable[] : [];
}

function report(diagnostics: DesignDiagnostic[], diagnostic: DesignDiagnostic): void {
  diagnostics.push(diagnostic);
}

function validateSchema(node: Node<ComponentNodeData>, diagnostics: DesignDiagnostic[]): void {
  const tableNames = new Set<string>();
  for (const table of getTables(node)) {
    if (!table.name.trim() || tableNames.has(table.name)) {
      report(diagnostics, {
        code: table.name.trim() ? "DB_TABLE_NAME_DUPLICATE" : "DB_TABLE_NAME_REQUIRED",
        severity: "error",
        message: table.name.trim()
          ? `${node.data.label} contains duplicate table "${table.name}".`
          : `${node.data.label} contains a table with no name.`,
        remediation: "Give every table a non-empty, unique name.",
        nodeId: node.id,
        tableName: table.name,
      });
    }
    tableNames.add(table.name);

    const columnNames = new Set<string>();
    for (const column of table.columns) {
      if (!column.name.trim() || columnNames.has(column.name)) {
        report(diagnostics, {
          code: column.name.trim() ? "DB_COLUMN_NAME_DUPLICATE" : "DB_COLUMN_NAME_REQUIRED",
          severity: "error",
          message: column.name.trim()
            ? `Table "${table.name}" contains duplicate column "${column.name}".`
            : `Table "${table.name}" contains a column with no name.`,
          remediation: "Give every column a non-empty, unique name.",
          nodeId: node.id,
          tableName: table.name,
          columnName: column.name,
        });
      }
      columnNames.add(column.name);
    }

    const indexNames = new Set<string>();
    for (const index of table.indexes) {
      if (!index.name.trim() || indexNames.has(index.name)) {
        report(diagnostics, {
          code: index.name.trim() ? "DB_INDEX_NAME_DUPLICATE" : "DB_INDEX_NAME_REQUIRED",
          severity: "error",
          message: `Table "${table.name}" has an empty or duplicate index name "${index.name}".`,
          remediation: "Give each index a non-empty, unique name.",
          nodeId: node.id,
          tableName: table.name,
        });
      }
      indexNames.add(index.name);
      for (const columnName of index.columns) {
        if (!columnNames.has(columnName)) {
          report(diagnostics, {
            code: "DB_INDEX_COLUMN_MISSING",
            severity: "error",
            message: `Index "${index.name}" references missing column "${columnName}" on table "${table.name}".`,
            remediation: "Add the column or remove it from the index definition.",
            nodeId: node.id,
            tableName: table.name,
            columnName,
          });
        }
      }
    }
  }
}

function validateCacheConfig(node: Node<ComponentNodeData>, diagnostics: DesignDiagnostic[]): void {
  const config = node.data.cacheConfig as CacheConfiguration | undefined;
  if (!config) return;
  if (config.maxMemoryMB !== undefined && (!Number.isFinite(config.maxMemoryMB) || config.maxMemoryMB <= 0)) {
    report(diagnostics, {
      code: "CACHE_MEMORY_INVALID",
      severity: "error",
      message: `${node.data.label} must have a positive finite max-memory value.`,
      remediation: "Set max memory above 0 MB or clear the setting.",
      nodeId: node.id,
    });
  }
  if (config.defaultTtlSeconds !== undefined && (!Number.isFinite(config.defaultTtlSeconds) || config.defaultTtlSeconds < 0)) {
    report(diagnostics, {
      code: "CACHE_TTL_INVALID",
      severity: "error",
      message: `${node.data.label} default TTL must be a non-negative finite number of seconds.`,
      remediation: "Set TTL to 0 or greater, or clear the setting.",
      nodeId: node.id,
    });
  }
  if (config.evictionPolicy !== undefined && !CACHE_EVICTION_POLICIES.has(config.evictionPolicy)) {
    report(diagnostics, {
      code: "CACHE_EVICTION_POLICY_INVALID",
      severity: "error",
      message: `${node.data.label} has an unsupported eviction policy.`,
      remediation: "Choose noeviction, allkeys-lru, allkeys-lfu, volatile-lru, or volatile-ttl.",
      nodeId: node.id,
    });
  }
}

function validateRateLimiterConfig(node: Node<ComponentNodeData>, diagnostics: DesignDiagnostic[]): void {
  const config = node.data.rateLimiterConfig as RateLimiterConfiguration | undefined;
  if (!config) return;

  if (!config.algorithm || !RATE_LIMIT_ALGORITHMS.has(config.algorithm)) {
    report(diagnostics, {
      code: "RATE_LIMIT_ALGORITHM_INVALID",
      severity: "error",
      message: `${node.data.label} must use a supported rate limit algorithm.`,
      remediation: "Choose token bucket or sliding window.",
      nodeId: node.id,
    });
  }
  if (!config.keyBy || !RATE_LIMIT_KEYS.has(config.keyBy)) {
    report(diagnostics, {
      code: "RATE_LIMIT_KEY_INVALID",
      severity: "error",
      message: `${node.data.label} must define how requests are grouped for limiting.`,
      remediation: "Choose global, client ID, IP address, or API key.",
      nodeId: node.id,
    });
  }
  if (!Number.isFinite(config.requestsPerWindow) || (config.requestsPerWindow ?? 0) <= 0) {
    report(diagnostics, {
      code: "RATE_LIMIT_QUOTA_INVALID",
      severity: "error",
      message: `${node.data.label} quota must be a positive finite request count.`,
      remediation: "Set requests per window to a value greater than zero.",
      nodeId: node.id,
    });
  }
  if (!Number.isFinite(config.windowSeconds) || (config.windowSeconds ?? 0) <= 0) {
    report(diagnostics, {
      code: "RATE_LIMIT_WINDOW_INVALID",
      severity: "error",
      message: `${node.data.label} window duration must be positive and finite.`,
      remediation: "Set a window duration greater than zero seconds.",
      nodeId: node.id,
    });
  }
  if (
    config.keyBy !== "global" &&
    (!Number.isInteger(config.estimatedDistinctKeys) || (config.estimatedDistinctKeys ?? 0) <= 0)
  ) {
    report(diagnostics, {
      code: "RATE_LIMIT_KEY_COUNT_INVALID",
      severity: "error",
      message: `${node.data.label} per-key policy needs a positive integer estimate of distinct keys.`,
      remediation: "Set the estimated concurrent client, IP, or API key count to at least 1.",
      nodeId: node.id,
    });
  }
  if (
    config.burstCapacity !== undefined &&
    (!Number.isInteger(config.burstCapacity) || config.burstCapacity <= 0)
  ) {
    report(diagnostics, {
      code: "RATE_LIMIT_BURST_INVALID",
      severity: "error",
      message: `${node.data.label} burst capacity must be a positive integer when specified.`,
      remediation: "Set token capacity to at least 1 or clear the optional field.",
      nodeId: node.id,
    });
  }
}

function validateQueueConfig(
  node: Node<ComponentNodeData>,
  diagnostics: DesignDiagnostic[],
  nodesById: Map<string, Node<ComponentNodeData>>,
  connectedTargets: Set<string>
): void {
  const config = node.data.queueConfig as QueueConfiguration | undefined;
  if (!config) return;
  if (!Array.isArray(config.topics)) {
    report(diagnostics, {
      code: "QUEUE_TOPICS_INVALID",
      severity: "error",
      message: `${node.data.label} topic configuration must be a list.`,
      remediation: "Repair or remove the queue topic configuration.",
      nodeId: node.id,
    });
    return;
  }
  const topicNames = new Set<string>();
  for (const candidate of config.topics as unknown[]) {
    const topic = candidate as { name?: unknown; retentionHours?: unknown } | null;
    if (!topic || typeof topic.name !== "string") {
      report(diagnostics, {
        code: "QUEUE_TOPIC_INVALID",
        severity: "error",
        message: `${node.data.label} contains a malformed topic entry.`,
        remediation: "Repair or remove the malformed topic.",
        nodeId: node.id,
      });
      continue;
    }
    if (!topic.name.trim() || topicNames.has(topic.name)) {
      report(diagnostics, {
        code: topic.name.trim() ? "QUEUE_TOPIC_DUPLICATE" : "QUEUE_TOPIC_NAME_REQUIRED",
        severity: "error",
        message: topic.name.trim()
          ? `${node.data.label} contains duplicate topic "${topic.name}".`
          : `${node.data.label} contains a topic with no name.`,
        remediation: "Give every topic a non-empty, unique name.",
        nodeId: node.id,
        topicName: topic.name,
      });
    }
    topicNames.add(topic.name);
    if (topic.retentionHours !== undefined && (typeof topic.retentionHours !== "number" || !Number.isFinite(topic.retentionHours) || topic.retentionHours <= 0)) {
      report(diagnostics, {
        code: "QUEUE_RETENTION_INVALID",
        severity: "error",
        message: `Topic "${topic.name}" must have positive finite retention in hours.`,
        remediation: "Set retention above 0 hours or clear the setting.",
        nodeId: node.id,
        topicName: topic.name,
      });
    } else if (typeof topic.retentionHours === "number" && topic.retentionHours < 24) {
      report(diagnostics, {
        code: "QUEUE_RETENTION_SHORT",
        severity: "warning",
        message: `Topic "${topic.name}" retains messages for less than 24 hours.`,
        remediation: "Confirm the retention window is long enough for consumer recovery and replay.",
        nodeId: node.id,
        topicName: topic.name,
      });
    }
  }

  if (config.subscriptions === undefined) return;
  if (!Array.isArray(config.subscriptions)) {
    report(diagnostics, {
      code: "QUEUE_SUBSCRIPTIONS_INVALID",
      severity: "error",
      message: `${node.data.label} consumer subscriptions must be a list.`,
      remediation: "Repair or remove the queue subscription configuration.",
      nodeId: node.id,
    });
    return;
  }

  const subscriptionKeys = new Set<string>();
  const subscribedTopics = new Set<string>();
  for (const candidate of config.subscriptions as unknown[]) {
    const subscription = candidate as { consumerNodeId?: unknown; topicName?: unknown } | null;
    if (!subscription || typeof subscription.consumerNodeId !== "string" || typeof subscription.topicName !== "string") {
      report(diagnostics, {
        code: "QUEUE_SUBSCRIPTION_INVALID",
        severity: "error",
        message: `${node.data.label} contains a malformed consumer subscription.`,
        remediation: "Choose a connected consumer and a configured topic for every subscription.",
        nodeId: node.id,
      });
      continue;
    }
    const consumerNodeId = subscription.consumerNodeId.trim();
    const topicName = subscription.topicName.trim();
    if (!consumerNodeId || !topicName) {
      report(diagnostics, {
        code: "QUEUE_SUBSCRIPTION_INVALID",
        severity: "error",
        message: `${node.data.label} has a subscription with no consumer or topic.`,
        remediation: "Choose a connected consumer and a configured topic for every subscription.",
        nodeId: node.id,
        topicName: topicName || undefined,
      });
      continue;
    }

    const key = `${consumerNodeId}\u0000${topicName}`;
    if (subscriptionKeys.has(key)) {
      report(diagnostics, {
        code: "QUEUE_SUBSCRIPTION_DUPLICATE",
        severity: "error",
        message: `${node.data.label} has duplicate subscriptions for ${consumerNodeId} on topic "${topicName}".`,
        remediation: "Keep one subscription for each consumer/topic pair.",
        nodeId: node.id,
        topicName,
      });
      continue;
    }
    subscriptionKeys.add(key);
    subscribedTopics.add(topicName);

    if (!topicNames.has(topicName)) {
      report(diagnostics, {
        code: "QUEUE_SUBSCRIPTION_TOPIC_NOT_FOUND",
        severity: "error",
        message: `${node.data.label} subscribes a consumer to unknown topic "${topicName}".`,
        remediation: "Add the topic to this queue or correct the subscription.",
        nodeId: node.id,
        topicName,
      });
    }
    const consumerNode = nodesById.get(consumerNodeId);
    if (!consumerNode) {
      report(diagnostics, {
        code: "QUEUE_SUBSCRIPTION_CONSUMER_NOT_FOUND",
        severity: "error",
        message: `${node.data.label} subscription references missing consumer ${consumerNodeId}.`,
        remediation: "Select an existing downstream component as the consumer.",
        nodeId: node.id,
        topicName,
      });
    } else if (consumerNode.type !== "component") {
      report(diagnostics, {
        code: "QUEUE_SUBSCRIPTION_CONSUMER_INVALID_TYPE",
        severity: "error",
        message: `${node.data.label} subscription targets a non-component canvas node.`,
        remediation: "Choose a connected infrastructure component as the consumer.",
        nodeId: node.id,
        topicName,
      });
    } else if (!connectedTargets.has(consumerNodeId)) {
      report(diagnostics, {
        code: "QUEUE_SUBSCRIPTION_CONSUMER_NOT_CONNECTED",
        severity: "error",
        message: `${node.data.label} subscription references a consumer that is not directly connected.`,
        remediation: "Connect the queue to this consumer or choose one of its connected components.",
        nodeId: node.id,
        topicName,
      });
    }
  }

  for (const candidate of config.topics as unknown[]) {
    const topic = candidate as { name?: unknown } | null;
    if (typeof topic?.name !== "string" || !topic.name.trim() || subscribedTopics.has(topic.name.trim())) continue;
    report(diagnostics, {
      code: "QUEUE_TOPIC_NO_SUBSCRIBERS",
      severity: "warning",
      message: `${node.data.label} topic "${topic.name}" has no configured consumer subscriptions.`,
      remediation: "Add a subscription for a connected consumer if this topic should be processed.",
      nodeId: node.id,
      topicName: topic.name,
    });
  }
  for (const consumerNodeId of connectedTargets) {
    if (config.subscriptions.some((candidate) => {
      const subscription = candidate as { consumerNodeId?: unknown } | null;
      return subscription?.consumerNodeId === consumerNodeId;
    })) continue;
    report(diagnostics, {
      code: "QUEUE_CONSUMER_NO_SUBSCRIPTIONS",
      severity: "warning",
      message: `${node.data.label} consumer ${nodesById.get(consumerNodeId)?.data.label ?? consumerNodeId} has no explicit topic subscription.`,
      remediation: "Add a topic subscription or remove the unused queue connection.",
      nodeId: node.id,
    });
  }
}

function validateStep(
  app: Node<ComponentNodeData>,
  endpoint: EndpointDefinition,
  step: EndpointLogicStep,
  stepIndex: number,
  nodesById: Map<string, Node<ComponentNodeData>>,
  connectedTargets: Set<string>,
  diagnostics: DesignDiagnostic[]
): void {
  const location = { nodeId: app.id, endpointId: endpoint.id, stepId: step.id };
  if ((step.kind === "validate" || step.kind === "route") && step.condition?.trim() && !isValidCondition(step.condition)) {
    report(diagnostics, {
      code: "ENDPOINT_CONDITION_INVALID",
      severity: "error",
      message: `${endpoint.method} ${endpoint.path} has an invalid condition: "${step.condition}".`,
      remediation: "Use complete operands with comparisons, !, &&, ||, and parentheses.",
      ...location,
    });
  }

  if (TARGET_REQUIRED.has(step.kind) && !step.targetNodeId) {
    report(diagnostics, {
      code: "ENDPOINT_TARGET_REQUIRED",
      severity: "error",
      message: `${endpoint.method} ${endpoint.path}, step ${stepIndex + 1} (${step.kind}) has no target component.`,
      remediation: "Connect the required component and select it as this step's target.",
      ...location,
    });
    return;
  }
  if (!step.targetNodeId) return;

  const target = nodesById.get(step.targetNodeId);
  if (!target) {
    report(diagnostics, {
      code: "ENDPOINT_TARGET_MISSING",
      severity: "error",
      message: `${endpoint.method} ${endpoint.path} references a component that no longer exists.`,
      remediation: "Select an existing target or remove this step.",
      ...location,
    });
    return;
  }
  if (!connectedTargets.has(target.id)) {
    report(diagnostics, {
      code: "ENDPOINT_TARGET_NOT_CONNECTED",
      severity: "error",
      message: `${endpoint.method} ${endpoint.path} targets ${target.data.label}, but they are not directly connected.`,
      remediation: "Connect this App Server to the selected target on the canvas.",
      ...location,
    });
  }
  const allowedTypes = TARGET_TYPES[step.kind];
  if (allowedTypes && !allowedTypes.has(target.data.componentId)) {
    report(diagnostics, {
      code: "ENDPOINT_TARGET_TYPE_MISMATCH",
      severity: "error",
      message: `Step ${stepIndex + 1} (${step.kind}) targets incompatible component ${target.data.label}.`,
      remediation: `Choose a compatible target: ${[...allowedTypes].join(" or ")}.`,
      ...location,
    });
  }
  if (step.kind === "publish-event" && target.data.componentId === "message-queue" && target.data.queueConfig) {
    const topicName = step.target?.trim() ?? "";
    const queueConfig = target.data.queueConfig as QueueConfiguration;
    const configuredTopics = Array.isArray(queueConfig.topics) ? queueConfig.topics : [];
    if (!topicName || !configuredTopics.some((topic) => topic?.name === topicName)) {
      report(diagnostics, {
        code: "QUEUE_TOPIC_NOT_FOUND",
        severity: "error",
        message: `${endpoint.method} ${endpoint.path} publishes to topic "${topicName || "(empty)"}", which is not configured on ${target.data.label}.`,
        remediation: "Add the topic to the queue configuration or correct the publish-event target.",
        ...location,
        topicName,
      });
    }
  }
  if (step.kind === "route" && target.data.category !== "compute") {
    report(diagnostics, {
      code: "ENDPOINT_ROUTE_TARGET_TYPE",
      severity: "error",
      message: `${endpoint.method} ${endpoint.path} routes to a non-compute component.`,
      remediation: "Choose a connected compute service as the route destination.",
      ...location,
    });
  }

  if ((step.kind !== "database-read" && step.kind !== "database-write") || !DATABASE_COMPONENTS.has(target.data.componentId)) return;
  const [tableName, rawColumns] = (step.target ?? "").trim().split(".", 2);
  if (!tableName) {
    report(diagnostics, {
      code: "DB_RESOURCE_REQUIRED",
      severity: "error",
      message: `${endpoint.method} ${endpoint.path} database step has no table mapping.`,
      remediation: step.kind === "database-read"
        ? "Set its resource to table.column (for example urls.urlshort)."
        : "Set its resource to a table name (for example urls).",
      ...location,
    });
    return;
  }
  const table = getTables(target).find((candidate) => candidate.name === tableName);
  if (!table) {
    report(diagnostics, {
      code: "DB_TABLE_NOT_FOUND",
      severity: "error",
      message: `${endpoint.method} ${endpoint.path} references table "${tableName}", which does not exist on ${target.data.label}.`,
      remediation: "Add the table to the database schema or correct the table name.",
      ...location,
      tableName,
    });
    return;
  }

  const columns = (rawColumns ?? "").split(",").map((column) => column.trim()).filter(Boolean);
  if (!columns.length) {
    report(diagnostics, {
      code: step.kind === "database-read" ? "DB_READ_COLUMNS_REQUIRED" : "DB_WRITE_COLUMNS_REQUIRED",
      severity: "error",
      message: `${endpoint.method} ${endpoint.path} database ${step.kind === "database-read" ? "read" : "write"} must identify at least one column.`,
      remediation: "Use an explicit mapping such as urls.urlshort or urls.urlshort,urllong.",
      ...location,
      tableName,
    });
    return;
  }
  for (const columnName of columns) {
    if (!table.columns.some((column) => column.name === columnName)) {
      report(diagnostics, {
        code: "DB_COLUMN_NOT_FOUND",
        severity: "error",
        message: `${endpoint.method} ${endpoint.path} references missing column "${columnName}" on table "${tableName}".`,
        remediation: "Add the column to the schema or correct the access pattern.",
        ...location,
        tableName,
        columnName,
      });
    }
  }
  if (step.kind !== "database-read") return;
  const firstColumn = columns[0];
  const indexed = table.columns.some((column) => column.name === firstColumn && column.primaryKey)
    || table.indexes.some((index) => index.columns[0] === firstColumn);
  if (!indexed) {
    report(diagnostics, {
      code: "DB_READ_INDEX_MISSING",
      severity: "warning",
      message: `Read of ${tableName}.${firstColumn} has no matching primary-key or leading-column index; the estimate will model a scan.`,
      remediation: `Add an index whose first column is ${firstColumn} for frequent lookups.`,
      ...location,
      tableName,
      columnName: firstColumn,
    });
  }
}

function validateGateway(
  gateway: Node<ComponentNodeData>,
  nodesById: Map<string, Node<ComponentNodeData>>,
  connectedTargets: Set<string>,
  diagnostics: DesignDiagnostic[]
): void {
  const routes = Array.isArray(gateway.data.routes)
    ? gateway.data.routes as GatewayRouteDefinition[]
    : [];
  const location = { nodeId: gateway.id };

  if (routes.length === 0) {
    const hasContractedBackend = [...connectedTargets].some((targetId) => {
      const backend = nodesById.get(targetId);
      return backend?.data.componentId === "app-server" && Array.isArray(backend.data.endpoints) && backend.data.endpoints.length > 0;
    });
    report(diagnostics, {
      code: hasContractedBackend ? "GATEWAY_ROUTES_REQUIRED" : "GATEWAY_ROUTES_UNCONFIGURED",
      severity: hasContractedBackend ? "error" : "info",
      message: hasContractedBackend
        ? `${gateway.data.label} has no routes for its connected App Server endpoints.`
        : `${gateway.data.label} has no explicit routes; simulation will distribute traffic evenly across connected services.`,
      remediation: hasContractedBackend
        ? "Add a route for each endpoint this gateway should expose and map it to the connected App Server."
        : "Configure method/path routes when this gateway needs endpoint-aware backend selection.",
      ...location,
    });
    return;
  }

  const routeKeys = new Set<string>();
  const routeIds = new Set<string>();
  for (const route of routes) {
    const routeLocation = { ...location, routeId: route.id };
    const routeKey = `${route.method} ${route.path}`;
    if (!HTTP_METHODS.has(route.method)) {
      report(diagnostics, {
        code: "GATEWAY_METHOD_INVALID",
        severity: "error",
        message: `${gateway.data.label} has a route with unsupported method "${route.method}".`,
        remediation: "Choose GET, POST, PUT, PATCH, or DELETE.",
        ...routeLocation,
      });
    }
    if (!route.path.trim() || !route.path.startsWith("/")) {
      report(diagnostics, {
        code: "GATEWAY_PATH_INVALID",
        severity: "error",
        message: `${routeKey} must have an absolute path beginning with /.`,
        remediation: "Use an exact path such as /urls or /:code.",
        ...routeLocation,
      });
    }
    if (routeKeys.has(routeKey)) {
      report(diagnostics, {
        code: "GATEWAY_ROUTE_DUPLICATE",
        severity: "error",
        message: `${gateway.data.label} defines ${routeKey} more than once.`,
        remediation: "Give each gateway route a unique method and path combination.",
        ...routeLocation,
      });
    }
    routeKeys.add(routeKey);
    if (routeIds.has(route.id)) {
      report(diagnostics, {
        code: "GATEWAY_ROUTE_ID_DUPLICATE",
        severity: "error",
        message: `${gateway.data.label} contains routes with duplicate identifiers.`,
        remediation: "Recreate or uniquely identify the duplicate route.",
        ...routeLocation,
      });
    }
    routeIds.add(route.id);

    if (!route.backendNodeId) {
      report(diagnostics, {
        code: "GATEWAY_BACKEND_REQUIRED",
        severity: "error",
        message: `${routeKey} has no backend service selected.`,
        remediation: "Select a connected App Server that defines this method and path.",
        ...routeLocation,
      });
      continue;
    }
    const backend = nodesById.get(route.backendNodeId);
    if (!backend) {
      report(diagnostics, {
        code: "GATEWAY_BACKEND_MISSING",
        severity: "error",
        message: `${routeKey} references a backend component that no longer exists.`,
        remediation: "Select an existing connected App Server.",
        ...routeLocation,
      });
      continue;
    }
    if (!connectedTargets.has(backend.id)) {
      report(diagnostics, {
        code: "GATEWAY_BACKEND_NOT_CONNECTED",
        severity: "error",
        message: `${routeKey} targets ${backend.data.label}, but there is no direct Gateway → backend connection.`,
        remediation: "Connect the API Gateway directly to the selected backend.",
        ...routeLocation,
      });
    }
    if (backend.data.category !== "compute" || backend.data.componentId !== "app-server") {
      report(diagnostics, {
        code: "GATEWAY_BACKEND_TYPE_INVALID",
        severity: "error",
        message: `${routeKey} targets ${backend.data.label}, which has no compiled HTTP endpoint contract.`,
        remediation: "Choose an App Server with a matching method/path endpoint.",
        ...routeLocation,
      });
      continue;
    }
    const endpoints = Array.isArray(backend.data.endpoints)
      ? backend.data.endpoints as EndpointDefinition[]
      : [];
    if (!endpoints.some((endpoint) => endpoint.method === route.method && endpoint.path === route.path)) {
      report(diagnostics, {
        code: "GATEWAY_BACKEND_ENDPOINT_NOT_FOUND",
        severity: "error",
        message: `${routeKey} has no exact matching endpoint on ${backend.data.label}.`,
        remediation: "Add the same method and path to the App Server, or update this gateway route.",
        ...routeLocation,
      });
    }
    if (route.trafficWeight !== undefined && (!Number.isFinite(route.trafficWeight) || route.trafficWeight <= 0)) {
      report(diagnostics, {
        code: "GATEWAY_TRAFFIC_WEIGHT_INVALID",
        severity: "error",
        message: `${routeKey} must have a positive finite traffic weight.`,
        remediation: "Set the route traffic weight above zero.",
        ...routeLocation,
      });
    }
  }
}

/** Validate graph and existing endpoint/schema contracts without mutating input. */
export function compileDesign(
  nodes: Node<ComponentNodeData>[],
  edges: Edge<CustomEdgeData>[],
  requestProfiles?: RequestProfile[]
): CompileResult {
  const diagnostics: DesignDiagnostic[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map(nodes.map((node) => [node.id, new Set<string>()]));

  for (const edge of edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) {
      if (source?.type === "text" || target?.type === "text") continue;
      report(diagnostics, {
        code: "GRAPH_EDGE_ENDPOINT_MISSING",
        severity: "error",
        message: `Connection ${edge.id} references a missing component.`,
        remediation: "Remove the dangling connection or restore its missing endpoint.",
        edgeId: edge.id,
      });
      continue;
    }
    outgoing.get(edge.source)?.add(edge.target);
  }

  const publishedTopicsByQueue = new Map<string, Set<string>>();
  for (const producer of nodes) {
    if (producer.type !== "component" || producer.data.componentId !== "app-server") continue;
    const endpoints = Array.isArray(producer.data.endpoints)
      ? producer.data.endpoints as EndpointDefinition[]
      : [];
    for (const endpoint of endpoints) {
      for (const step of Array.isArray(endpoint.steps) ? endpoint.steps : []) {
        if (
          step.kind !== "publish-event"
          || typeof step.targetNodeId !== "string"
          || typeof step.target !== "string"
          || !step.target.trim()
        ) continue;
        const publishedTopics = publishedTopicsByQueue.get(step.targetNodeId) ?? new Set<string>();
        publishedTopics.add(step.target.trim());
        publishedTopicsByQueue.set(step.targetNodeId, publishedTopics);
      }
    }
  }

  for (const node of nodes) {
    if (node.type === "component" && DATABASE_COMPONENTS.has(node.data.componentId)) {
      validateSchema(node, diagnostics);
    }
    if (node.type === "component" && node.data.componentId === "cache") {
      validateCacheConfig(node, diagnostics);
    }
    if (node.type === "component" && node.data.componentId === "rate-limiter") {
      validateRateLimiterConfig(node, diagnostics);
    }
    if (node.type === "component" && node.data.componentId === "message-queue") {
      validateQueueConfig(node, diagnostics, nodesById, outgoing.get(node.id) ?? new Set());
      const topics = node.data.queueConfig?.topics;
      const publishedTopics = publishedTopicsByQueue.get(node.id) ?? new Set<string>();
      if (Array.isArray(topics)) {
        for (const topic of topics) {
          if (typeof topic?.name !== "string" || !topic.name.trim() || publishedTopics.has(topic.name.trim())) continue;
          report(diagnostics, {
            code: "QUEUE_TOPIC_NO_PRODUCERS",
            severity: "warning",
            message: `${node.data.label} topic "${topic.name}" has no publish-event producer.`,
            remediation: "Add a publish-event step targeting this queue and topic, or remove the unused topic.",
            nodeId: node.id,
            topicName: topic.name,
          });
        }
      }
      if (Array.isArray(topics) && topics.length > 0 && (outgoing.get(node.id)?.size ?? 0) === 0) {
        report(diagnostics, {
          code: "QUEUE_NO_CONSUMERS",
          severity: "warning",
          message: `${node.data.label} has configured topics but no downstream consumers.`,
          remediation: "Connect at least one consumer service if these events should be processed.",
          nodeId: node.id,
        });
      }
    }
  }

  for (const app of nodes) {
    if (app.type !== "component" || app.data.componentId !== "app-server") continue;
    const endpoints = Array.isArray(app.data.endpoints) ? app.data.endpoints as EndpointDefinition[] : [];
    if (!endpoints.length) {
      report(diagnostics, {
        code: "APP_ENDPOINT_REQUIRED",
        severity: "error",
        message: `${app.data.label} has no API endpoints defined.`,
        remediation: "Add at least one endpoint in Props and define its request pipeline.",
        nodeId: app.id,
      });
      continue;
    }

    const routeKeys = new Set<string>();
    const endpointIds = new Set<string>();
    for (const endpoint of endpoints) {
      const routeKey = `${endpoint.method} ${endpoint.path}`;
      if (!HTTP_METHODS.has(endpoint.method)) {
        report(diagnostics, {
          code: "ENDPOINT_METHOD_INVALID",
          severity: "error",
          message: `${app.data.label} has an endpoint with unsupported method "${endpoint.method}".`,
          remediation: "Choose GET, POST, PUT, PATCH, or DELETE.",
          nodeId: app.id,
          endpointId: endpoint.id,
        });
      }
      if (endpointIds.has(endpoint.id)) {
        report(diagnostics, {
          code: "ENDPOINT_ID_DUPLICATE",
          severity: "error",
          message: `${app.data.label} contains endpoints with duplicate identifiers.`,
          remediation: "Recreate or uniquely identify the duplicate endpoint.",
          nodeId: app.id,
          endpointId: endpoint.id,
        });
      }
      endpointIds.add(endpoint.id);
      if (!endpoint.path.trim() || !endpoint.path.startsWith("/")) {
        report(diagnostics, {
          code: "ENDPOINT_PATH_INVALID",
          severity: "error",
          message: `${routeKey} must have an absolute API path beginning with /.`,
          remediation: "Use a path such as /urls or /urls/:code.",
          nodeId: app.id,
          endpointId: endpoint.id,
        });
      }
      if (routeKeys.has(routeKey)) {
        report(diagnostics, {
          code: "ENDPOINT_ROUTE_DUPLICATE",
          severity: "error",
          message: `${app.data.label} defines ${routeKey} more than once.`,
          remediation: "Give each endpoint a unique method and path combination.",
          nodeId: app.id,
          endpointId: endpoint.id,
        });
      }
      routeKeys.add(routeKey);

      if (!endpoint.steps.length) {
        report(diagnostics, {
          code: "ENDPOINT_PIPELINE_REQUIRED",
          severity: "error",
          message: `${routeKey} has no business-logic steps.`,
          remediation: "Add a response, data access, cache, validation, or routing step.",
          nodeId: app.id,
          endpointId: endpoint.id,
        });
      }
      if (!endpoint.steps.some((step) => step.kind === "respond")) {
        report(diagnostics, {
          code: "ENDPOINT_RESPONSE_REQUIRED",
          severity: "error",
          message: `${routeKey} has no response step.`,
          remediation: "Add a Return response step after the endpoint's business logic.",
          nodeId: app.id,
          endpointId: endpoint.id,
        });
      }
      validateEndpointFields(app, endpoint, diagnostics, requestProfiles);
      const stepIds = new Set<string>();
      endpoint.steps.forEach((step, index) => {
        if (stepIds.has(step.id)) {
          report(diagnostics, {
            code: "ENDPOINT_STEP_ID_DUPLICATE",
            severity: "error",
            message: `${routeKey} contains duplicate pipeline step identifiers.`,
            remediation: "Recreate or uniquely identify the duplicate step.",
            nodeId: app.id,
            endpointId: endpoint.id,
            stepId: step.id,
          });
        }
        stepIds.add(step.id);
        validateStep(app, endpoint, step, index, nodesById, outgoing.get(app.id) ?? new Set(), diagnostics);
      });
    }
  }

  for (const gateway of nodes) {
    if (gateway.type !== "component" || gateway.data.componentId !== "api-gateway") continue;
    validateGateway(gateway, nodesById, outgoing.get(gateway.id) ?? new Set(), diagnostics);
  }

  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  return {
    ok: errorCount === 0,
    diagnostics,
    errorCount,
    warningCount: diagnostics.filter((item) => item.severity === "warning").length,
    infoCount: diagnostics.filter((item) => item.severity === "info").length,
  };
}