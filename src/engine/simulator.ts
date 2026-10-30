import type { Node, Edge } from "@xyflow/react";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { ComponentFault, NodeMetrics, NodeStatus, RequestProfile, SimulationResult } from "@/types/simulation";
import type { DatabaseTable, EndpointDefinition } from "@/types/component";
import {
  UTILIZATION_WARNING,
  UTILIZATION_CRITICAL,
  LATENCY_SPIKE_THRESHOLD,
  LATENCY_SPIKE_MULTIPLIER,
} from "./constants";

/** Components that distribute work rather than broadcasting it to every child. */
const LOAD_BALANCING_COMPONENTS = new Set(["load-balancer", "api-gateway"]);
const CACHE_COMPONENT_ID = "cache";
const CACHE_HIT_RATE = 0.9;
const FULL_SCAN_COST = 5;
const BASELINE_TABLE_ROWS = 1000;
const INDEX_WRITE_COST = 0.1;

interface TrafficAllocation {
  qps: number;
  workQPS: number;
  successQPS?: number;
  failedQPS?: number;
}

type TrafficDistribution = Map<string, TrafficAllocation>;

function getStatus(utilization: number): NodeStatus {
  if (utilization >= UTILIZATION_CRITICAL) return "critical";
  if (utilization >= UTILIZATION_WARNING) return "warning";
  return "healthy";
}

function computeLatency(baseLatency: number, utilization: number): number {
  if (utilization >= LATENCY_SPIKE_THRESHOLD) {
    return baseLatency * (1 + Math.max(0, utilization - LATENCY_SPIKE_THRESHOLD) * LATENCY_SPIKE_MULTIPLIER);
  }
  return baseLatency;
}

/** Sanitize a raw maxQPS spec: finite positive number, otherwise 0. */
function sanitizeMaxQPS(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Sanitize a raw replicas spec: integer >= 1 (NaN/negative/fractional inputs clamp to 1). */
function sanitizeReplicas(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, n);
}

function expectedAttempts(retries: number | undefined, failureRate: number): number {
  const maxRetries = typeof retries === "number" && Number.isFinite(retries)
    ? Math.min(5, Math.max(0, Math.floor(retries)))
    : 0;
  const probability = Math.min(1, Math.max(0, failureRate));
  let expected = 1;
  let attemptFailureProbability = probability;
  for (let retry = 0; retry < maxRetries; retry += 1) {
    expected += attemptFailureProbability;
    attemptFailureProbability *= probability;
  }
  return expected;
}

function exhaustedFailureRate(retries: number | undefined, failureRate: number): number {
  const maxRetries = typeof retries === "number" && Number.isFinite(retries)
    ? Math.min(5, Math.max(0, Math.floor(retries)))
    : 0;
  const probability = Number.isFinite(failureRate)
    ? Math.min(1, Math.max(0, failureRate))
    : 0;
  return probability ** (maxRetries + 1);
}

function evaluateEndpointCondition(
  condition: string,
  attributes: Record<string, string | number | boolean>
): boolean | undefined {
  const tokenPattern = /\s*(>=|<=|==|!=|&&|\|\||[()!<>]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|-?(?:\d+\.?\d*|\.\d+)|[A-Za-z_][A-Za-z0-9_.-]*)/y;
  const tokens: string[] = [];
  let offset = 0;
  while (offset < condition.length) {
    tokenPattern.lastIndex = offset;
    const token = tokenPattern.exec(condition);
    if (!token) {
      if (condition.slice(offset).trim() === "") break;
      return undefined;
    }
    tokens.push(token[1]);
    offset = tokenPattern.lastIndex;
  }
  if (tokens.length === 0) return undefined;

  type Value = string | number | boolean | undefined;
  let position = 0;
  const peek = () => tokens[position];
  const consume = () => tokens[position++];

  const parseValue = (): Value => {
    const token = consume();
    if (!token) return undefined;
    if (token.startsWith('"') || token.startsWith("'")) {
      const body = token.slice(1, -1);
      return body.replace(/\\([\\'"\\])/g, "$1");
    }
    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(token)) return Number(token);
    if (token.toLowerCase() === "true") return true;
    if (token.toLowerCase() === "false") return false;
    return Object.hasOwn(attributes, token) ? attributes[token] : undefined;
  };

  const parseOr = (): boolean | undefined => {
    let value = parseAnd();
    while (peek() === "||") {
      consume();
      const right = parseAnd();
      value = value === true || right === true
        ? true
        : value === false && right === false
          ? false
          : undefined;
    }
    return value;
  };

  const parseAnd = (): boolean | undefined => {
    let value = parseNot();
    while (peek() === "&&") {
      consume();
      const right = parseNot();
      value = value === false || right === false
        ? false
        : value === true && right === true
          ? true
          : undefined;
    }
    return value;
  };

  const parseNot = (): boolean | undefined => {
    if (peek() === "!") {
      consume();
      const value = parseNot();
      return value === undefined ? undefined : !value;
    }
    return parseComparison();
  };

  const parsePrimary = (): Value => {
    if (peek() !== "(") return parseValue();
    consume();
    const value = parseOr();
    if (peek() !== ")") return undefined;
    consume();
    return value;
  };

  const parseComparison = (): boolean | undefined => {
    const left = parsePrimary();
    const operator = peek();
    if (!operator || !["==", "!=", ">", ">=", "<", "<="].includes(operator)) {
      return typeof left === "boolean" ? left : undefined;
    }
    consume();
    const right = parsePrimary();
    if (left === undefined || right === undefined) return undefined;

    let comparison: number;
    if (typeof left === "boolean" || typeof right === "boolean") {
      if (typeof left !== "boolean" || typeof right !== "boolean") return false;
      comparison = Number(left) - Number(right);
    } else if (typeof left === "number" || typeof right === "number") {
      const leftNumber = typeof left === "number" ? left : Number(left);
      const rightNumber = typeof right === "number" ? right : Number(right);
      if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
      comparison = leftNumber - rightNumber;
    } else {
      comparison = left.localeCompare(right);
    }

    switch (operator) {
      case "==": return comparison === 0;
      case "!=": return comparison !== 0;
      case ">": return comparison > 0;
      case ">=": return comparison >= 0;
      case "<": return comparison < 0;
      case "<=": return comparison <= 0;
      default: return undefined;
    }
  };

  const result = parseOr();
  return position === tokens.length ? result : undefined;
}

function getDatabaseReadCost(nodeId: string, accessPattern: string | undefined, nodes: Map<string, Node<ComponentNodeData>>): number {
  if (!accessPattern) return FULL_SCAN_COST;
  const [tableName, rawColumns] = accessPattern.split(".", 2);
  const queryColumns = rawColumns?.split(",").map((column) => column.trim()).filter(Boolean) ?? [];
  if (!tableName) return FULL_SCAN_COST;

  const tables = nodes.get(nodeId)?.data.tables as DatabaseTable[] | undefined;
  const table = tables?.find((candidate) => candidate.name === tableName);
  if (!table) return FULL_SCAN_COST;
  if (queryColumns.length === 0) return getSequentialScanCost(table.estimatedRows);
  if (queryColumns.some((queryColumn) => !table.columns.some((column) => column.name === queryColumn))) {
    return getSequentialScanCost(table.estimatedRows);
  }

  const leadingColumn = queryColumns[0];
  const hasIndex = table.columns.some((column) => column.name === leadingColumn && column.primaryKey) ||
    table.indexes.some((index) => index.columns[0] === leadingColumn);
  if (!hasIndex) return getSequentialScanCost(table.estimatedRows);

  const rows = sanitizeEstimatedRows(table.estimatedRows);
  return Math.max(1, 1 + Math.log10(rows / BASELINE_TABLE_ROWS));
}

function sanitizeEstimatedRows(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1_000_000_000_000, Math.max(1, value))
    : BASELINE_TABLE_ROWS;
}

function getSequentialScanCost(estimatedRows: number | undefined): number {
  const rows = sanitizeEstimatedRows(estimatedRows);
  return Math.min(1_000_000, FULL_SCAN_COST * Math.max(1, rows / BASELINE_TABLE_ROWS));
}

function getDatabaseWriteCost(nodeId: string, tableName: string | undefined, nodes: Map<string, Node<ComponentNodeData>>): number {
  if (!tableName) return 1;
  const table = (nodes.get(nodeId)?.data.tables as DatabaseTable[] | undefined)
    ?.find((candidate) => candidate.name === tableName);
  if (!table) return 1;
  const indexDepthFactor = Math.max(
    1,
    Math.log10(sanitizeEstimatedRows(table.estimatedRows) / BASELINE_TABLE_ROWS)
  );
  const maintainedIndexes = table.indexes.filter((index) => index.columns.length > 0).length;
  return 1 + maintainedIndexes * INDEX_WRITE_COST * indexDepthFactor;
}

export function runSimulation(
  nodes: Node<ComponentNodeData>[],
  edges: Edge[],
  requestsPerSec: number,
  faults: Record<string, ComponentFault> = {},
  durationSec = 10,
  requestProfiles: RequestProfile[] = [{ name: "Default", trafficWeight: 1, attributes: {} }]
): SimulationResult {
  const warnings: string[] = [];
  const warnedConditions = new Set<string>();
  const validationRejectedQPS = new Map<string, number>();
  const nodeMetrics = new Map<string, NodeMetrics>();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const sustainedDurationSec = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 10;
  const validProfiles = requestProfiles.filter((profile) =>
    Number.isFinite(profile.trafficWeight) && profile.trafficWeight >= 0
  );
  const totalProfileWeight = validProfiles.reduce((sum, profile) => sum + profile.trafficWeight, 0);
  const normalizedProfiles = totalProfileWeight > 0
    ? validProfiles.map((profile) => ({ ...profile, trafficWeight: profile.trafficWeight / totalProfileWeight }))
    : [{ name: "Default", trafficWeight: 1, attributes: {} }];

  // Sanitized effective capacity per node (maxQPS * replicas)
  const capacity = new Map<string, number>();
  for (const node of nodes) {
    const baseCapacity =
      sanitizeMaxQPS(node.data.maxQPS) * sanitizeReplicas(node.data.replicas);
    const fault = faults[node.id];
    const effectiveCapacity = fault?.mode === "down"
      ? 0
      : fault?.mode === "degraded"
        ? baseCapacity * Math.min(1, Math.max(0.01, fault.capacityFactor))
        : baseCapacity;
    capacity.set(
      node.id,
      effectiveCapacity
    );
    if (fault?.mode === "down") {
      warnings.push(`${node.data.label} is unavailable; incoming traffic is dropped.`);
    } else if (fault?.mode === "degraded") {
      warnings.push(`${node.data.label} is degraded; capacity and latency are reduced by the injected fault.`);
    }
  }

  // Build adjacency list and in-degree map.
  // - Edges whose endpoints aren't known component nodes (e.g. text nodes) are skipped,
  //   otherwise they'd inflate in-degree and falsely flag cycles.
  // - Duplicate parallel edges A->B are deduped so traffic isn't double-counted.
  // - Async edges still carry QPS, but are excluded from the latency graph:
  //   queue/notification/monitoring hops aren't user-facing latency.
  const adjacency = new Map<string, string[]>();
  const syncAdjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
    syncAdjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  }
  const seenPairs = new Set<string>();
  const seenSyncPairs = new Set<string>();
  let validEdgeCount = 0;
  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    const key = `${edge.source}->${edge.target}`;
    if (!seenPairs.has(key)) {
      seenPairs.add(key);
      validEdgeCount++;
      adjacency.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
    if (edge.data?.async !== true && !seenSyncPairs.has(key)) {
      seenSyncPairs.add(key);
      syncAdjacency.get(edge.source)!.push(edge.target);
    }
  }

  // Entry nodes: in-degree 0 AND at least one outgoing edge, so disconnected
  // nodes don't steal traffic from the real request path. When the canvas has
  // no (valid) edges at all, fall back to treating every root as an entry.
  const hasEdges = validEdgeCount > 0;
  const entryNodes = nodes.filter(
    (n) =>
      (inDegree.get(n.id) ?? 0) === 0 &&
      (!hasEdges || (adjacency.get(n.id)?.length ?? 0) > 0)
  );

  // Initialize incoming QPS for entry nodes
  const incomingQPS = new Map<string, number>();
  const incomingWorkQPS = new Map<string, number>();
  const incomingSuccessQPS = new Map<string, number>();
  const incomingFailedQPS = new Map<string, number>();
  const qpsPerEntry = entryNodes.length > 0 ? requestsPerSec / entryNodes.length : 0;
  for (const entry of entryNodes) {
    incomingQPS.set(entry.id, qpsPerEntry);
    incomingWorkQPS.set(entry.id, qpsPerEntry);
    incomingSuccessQPS.set(entry.id, qpsPerEntry);
  }

  const bottleneckNodes: string[] = [];
  const deliveredQPS = new Map<string, number>();
  const processed = new Set<string>();

  // Compute metrics for a node from its accumulated incoming QPS; returns delivered QPS.
  const processNode = (nodeId: string): number => {
    const node = nodeMap.get(nodeId)!;
    const data = node.data;
    const incoming = incomingQPS.get(nodeId) ?? 0;
    const workQPS = incomingWorkQPS.get(nodeId) ?? incoming;
    const successQPS = incomingSuccessQPS.get(nodeId) ?? incoming;
    const failedQPS = incomingFailedQPS.get(nodeId) ?? 0;
    const effectiveQPS = capacity.get(nodeId) ?? 0;
    const fault = faults[nodeId];
    const averageWorkPerRequest = incoming > 0 ? workQPS / incoming : 1;
    // A node with no usable capacity that still receives traffic is fully
    // saturated (it black-holes everything downstream) — not "healthy".
    const utilization =
      effectiveQPS <= 0 ? (incoming > 0 ? 2 : 0) : workQPS / effectiveQPS;
    const injectedLatencyMultiplier = fault?.mode === "degraded"
      ? Math.min(20, Math.max(1, fault.latencyMultiplier))
      : 1;
    const latency = computeLatency(
      data.latencyMs * averageWorkPerRequest * injectedLatencyMultiplier,
      utilization
    );
    const status = getStatus(utilization);
    const isBottleneck = utilization > UTILIZATION_CRITICAL;

    if (isBottleneck) bottleneckNodes.push(nodeId);

    const capacityDeliveryRatio = workQPS > 0
      ? Math.min(1, effectiveQPS / workQPS)
      : 1;
    const delivered = Math.min(successQPS, successQPS * capacityDeliveryRatio);
    const capacityRejectedQPS = Math.max(0, successQPS - delivered);
    deliveredQPS.set(nodeId, delivered);

    nodeMetrics.set(nodeId, {
      nodeId,
      incomingQPS: incoming,
      effectiveQPS,
      utilization: Math.min(utilization, 2), // cap at 200% for display
      latencyMs: latency,
      status,
      isBottleneck,
      failedQPS: failedQPS + capacityRejectedQPS,
    });
    return delivered;
  };

  const distributeTrafficToChildren = (nodeId: string, output: number): TrafficDistribution => {
    const children = adjacency.get(nodeId) ?? [];
    if (children.length === 0) return new Map();

    const nodeComponentId = nodeMap.get(nodeId)?.data.componentId;
    const endpoints = nodeMap.get(nodeId)?.data.endpoints as EndpointDefinition[] | undefined;
    const configuredEndpoints = nodeComponentId === "app-server" && Array.isArray(endpoints)
      ? endpoints
      : [];

    // When endpoint steps target connected nodes, they define the request flow
    // for this app server instead of the generic graph fan-out. Endpoint weights
    // are normalized, and a cache-read reduces later database-read traffic by
    // the configured hit rate while still sending every lookup to the cache.
    const hasModeledEndpointBehavior = configuredEndpoints.some((endpoint) =>
      endpoint.steps.some((step) =>
        step.kind === "validate" || Boolean(step.targetNodeId && children.includes(step.targetNodeId))
      )
    );
    if (hasModeledEndpointBehavior) {
      const result: TrafficDistribution = new Map(
        children.map((childId) => [childId, { qps: 0, workQPS: 0 }])
      );
      const weights = configuredEndpoints.map((endpoint) =>
        typeof endpoint.trafficWeight === "number" && Number.isFinite(endpoint.trafficWeight)
          ? Math.max(0, endpoint.trafficWeight)
          : 1
      );
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      const effectiveTotalWeight = totalWeight > 0 ? totalWeight : configuredEndpoints.length;

      configuredEndpoints.forEach((endpoint, endpointIndex) => {
        const weight = totalWeight > 0 ? weights[endpointIndex] : 1;
        const endpointQPS = output * weight / effectiveTotalWeight;
        const hasTargetedSteps = endpoint.steps.some(
          (step) => Boolean(step.targetNodeId && children.includes(step.targetNodeId))
        );
        let unmatchedRouteQPS = 0;

        for (const profile of normalizedProfiles) {
          const profileQPS = endpointQPS * profile.trafficWeight;
          let activeQPS = profileQPS;
          let remainingReadFraction = 1;
          let remainingRouteQPS = profileQPS;

          for (const step of endpoint.steps) {
            if (step.kind === "validate") {
              if (!step.condition?.trim()) continue;
              const conditionResult = evaluateEndpointCondition(step.condition, profile.attributes);
              if (conditionResult === undefined) {
                if (!warnedConditions.has(step.id)) {
                  warnedConditions.add(step.id);
                  warnings.push(`Validation condition "${step.condition}" could not be evaluated; requests pass through.`);
                }
              } else if (!conditionResult && activeQPS > 0) {
                const rejected = activeQPS;
                validationRejectedQPS.set(nodeId, (validationRejectedQPS.get(nodeId) ?? 0) + rejected);
                activeQPS = 0;
                remainingRouteQPS = 0;
              }
              continue;
            }

            const targetId = step.targetNodeId;
            if (!targetId || !children.includes(targetId) || activeQPS <= 0) continue;

            let operationQPS = activeQPS;
            let workPerRequest = 1;
            if (step.kind === "database-read") {
              operationQPS *= remainingReadFraction;
              workPerRequest = getDatabaseReadCost(targetId, step.target, nodeMap);
            } else if (step.kind === "cache-read") {
              const hitRate = typeof step.cacheHitRate === "number" && Number.isFinite(step.cacheHitRate)
                ? Math.min(1, Math.max(0, step.cacheHitRate))
                : CACHE_HIT_RATE;
              remainingReadFraction *= 1 - hitRate;
            } else if (step.kind === "database-write") {
              workPerRequest = getDatabaseWriteCost(targetId, step.target?.split(".")[0], nodeMap);
            } else if (step.kind === "route") {
              const conditionResult = step.condition?.trim()
                ? evaluateEndpointCondition(step.condition, profile.attributes)
                : undefined;
              const configuredMatchRate = typeof step.matchRate === "number" && Number.isFinite(step.matchRate)
                ? Math.min(1, Math.max(0, step.matchRate))
                : 1;
              const matchRate = conditionResult === undefined ? configuredMatchRate : conditionResult ? 1 : 0;
              if (step.condition?.trim() && conditionResult === undefined && !warnedConditions.has(step.id)) {
                warnedConditions.add(step.id);
                warnings.push(`Route condition "${step.condition}" could not be evaluated; using its configured match share.`);
              }
              operationQPS = remainingRouteQPS * matchRate;
              remainingRouteQPS -= operationQPS;
            }

            const targetFault = faults[targetId];
            const failureRate = targetFault?.mode === "down"
              ? 1
              : typeof step.retryFailureRate === "number" && Number.isFinite(step.retryFailureRate)
                ? Math.min(1, Math.max(0, step.retryFailureRate))
                : 0;
            const attempts = expectedAttempts(step.retryAttempts, failureRate);
            const operationFailureRate = exhaustedFailureRate(step.retryAttempts, failureRate);
            workPerRequest *= attempts;

            const current = result.get(targetId) ?? { qps: 0, workQPS: 0 };
            result.set(targetId, {
              qps: current.qps + operationQPS,
              workQPS: current.workQPS + operationQPS * workPerRequest,
              successQPS: (current.successQPS ?? current.qps) + operationQPS * (1 - operationFailureRate),
              failedQPS: (current.failedQPS ?? 0) + operationQPS * operationFailureRate,
            });
            // Exhausted retries terminate this request's pipeline; later steps
            // should only see the requests that succeeded at this operation.
            activeQPS = Math.max(0, activeQPS - operationQPS * operationFailureRate);
          }

          unmatchedRouteQPS += remainingRouteQPS;

          // Validation-only pipelines still pass accepted traffic onward using
          // the ordinary graph fan-out. In mixed endpoint designs, endpoints
          // without explicit targets retain that same fallback behavior.
          if (!hasTargetedSteps && activeQPS > 0) {
            const cacheChildren = children.filter(
              (childId) => nodeMap.get(childId)?.data.componentId === CACHE_COMPONENT_ID
            );
            const nonCacheChildren = children.filter(
              (childId) => nodeMap.get(childId)?.data.componentId !== CACHE_COMPONENT_ID
            );
            for (const childId of children) {
              let childQPS = activeQPS;
              if (cacheChildren.length > 0 && nonCacheChildren.length > 0) {
                childQPS = cacheChildren.includes(childId)
                  ? activeQPS * CACHE_HIT_RATE / cacheChildren.length
                  : activeQPS * (1 - CACHE_HIT_RATE) / nonCacheChildren.length;
              }
              const current = result.get(childId) ?? { qps: 0, workQPS: 0 };
              result.set(childId, {
                qps: current.qps + childQPS,
                workQPS: current.workQPS + childQPS,
                successQPS: (current.successQPS ?? current.qps) + childQPS,
                failedQPS: current.failedQPS ?? 0,
              });
            }
          }
        }

        const hasConfiguredRoutes = endpoint.steps.some(
          (step) => step.kind === "route" && step.targetNodeId && children.includes(step.targetNodeId)
        );
        if (hasConfiguredRoutes && unmatchedRouteQPS > 0.01) {
          warnings.push(`${endpoint.method} ${endpoint.path} leaves about ${Math.ceil(unmatchedRouteQPS)} requests/sec without a matching route.`);
        }
      });

      return result;
    }

    const cacheChildren = children.filter((childId) => nodeMap.get(childId)?.data.componentId === CACHE_COMPONENT_ID);
    const nonCacheChildren = children.filter((childId) => nodeMap.get(childId)?.data.componentId !== CACHE_COMPONENT_ID);

    if (cacheChildren.length > 0 && nonCacheChildren.length > 0) {
      if (nodeComponentId === CACHE_COMPONENT_ID) {
        const missTraffic = output * (1 - CACHE_HIT_RATE);
        const qpsPerMissChild = missTraffic / nonCacheChildren.length;
        const result: TrafficDistribution = new Map();
        for (const childId of nonCacheChildren) {
          const current = result.get(childId) ?? { qps: 0, workQPS: 0 };
          result.set(childId, { qps: current.qps + qpsPerMissChild, workQPS: current.workQPS + qpsPerMissChild });
        }
        return result;
      }

      const cacheTraffic = output * CACHE_HIT_RATE;
      const missTraffic = output * (1 - CACHE_HIT_RATE);
      const result: TrafficDistribution = new Map();
      const qpsPerCacheChild = cacheTraffic / Math.max(1, cacheChildren.length);
      const qpsPerMissChild = missTraffic / Math.max(1, nonCacheChildren.length);

      for (const childId of cacheChildren) {
        result.set(childId, { qps: qpsPerCacheChild, workQPS: qpsPerCacheChild });
      }
      for (const childId of nonCacheChildren) {
        result.set(childId, { qps: qpsPerMissChild, workQPS: qpsPerMissChild });
      }
      return result;
    }

    const isQueueConsumerGroup =
      nodeComponentId === "message-queue" &&
      nodeMap.get(nodeId)?.data.queueDeliveryMode === "competing";
    const isSplitter = LOAD_BALANCING_COMPONENTS.has(nodeComponentId ?? "") || isQueueConsumerGroup;
    const qpsToChild = isSplitter && children.length > 0 ? output / children.length : output;
    const result: TrafficDistribution = new Map();
    for (const childId of children) {
      result.set(childId, { qps: qpsToChild, workQPS: qpsToChild });
    }
    return result;
  };

  // Push a node's output QPS to its (not yet processed) children.
  const propagateToUnprocessedChildren = (nodeId: string, output: number) => {
    const childQPS = distributeTrafficToChildren(nodeId, output);
    for (const [childId, allocation] of childQPS.entries()) {
      if (processed.has(childId)) continue;
      incomingQPS.set(childId, (incomingQPS.get(childId) ?? 0) + allocation.qps);
      incomingWorkQPS.set(childId, (incomingWorkQPS.get(childId) ?? 0) + allocation.workQPS);
      incomingSuccessQPS.set(childId, (incomingSuccessQPS.get(childId) ?? 0) + (allocation.successQPS ?? allocation.qps));
      incomingFailedQPS.set(childId, (incomingFailedQPS.get(childId) ?? 0) + (allocation.failedQPS ?? 0));
    }
  };

  // --- Kahn's algorithm for topological-order QPS propagation ---
  // Clone inDegree so we can decrement without corrupting the original
  const remaining = new Map(inDegree);
  const queue: string[] = entryNodes.map((n) => n.id);
  let head = 0;

  while (head < queue.length) {
    const nodeId = queue[head++];
    if (processed.has(nodeId)) continue;
    processed.add(nodeId);

    const output = processNode(nodeId);

    // Load balancers and configured competing-consumer queues split traffic;
    // other components retain the existing fan-out behavior.
    const childQPS = distributeTrafficToChildren(nodeId, output);

    for (const [childId, allocation] of childQPS.entries()) {
      incomingQPS.set(childId, (incomingQPS.get(childId) ?? 0) + allocation.qps);
      incomingWorkQPS.set(childId, (incomingWorkQPS.get(childId) ?? 0) + allocation.workQPS);
      incomingSuccessQPS.set(childId, (incomingSuccessQPS.get(childId) ?? 0) + (allocation.successQPS ?? allocation.qps));
      incomingFailedQPS.set(childId, (incomingFailedQPS.get(childId) ?? 0) + (allocation.failedQPS ?? 0));

      // Decrement in-degree; enqueue when all predecessors processed
      const newDeg = (remaining.get(childId) ?? 1) - 1;
      remaining.set(childId, newDeg);
      if (newDeg === 0) {
        queue.push(childId);
      }
    }
  }

  // --- Cycle handling ---
  // Unprocessed nodes with inbound edges are either ON a cycle or strictly
  // DOWNSTREAM of one. Distinguish them by repeatedly peeling zero-out-degree
  // nodes within the unresolved subgraph: survivors are on (or feed back into)
  // a cycle, peeled nodes are merely downstream of it.
  const unresolved = nodes.filter(
    (n) => !processed.has(n.id) && (inDegree.get(n.id) ?? 0) > 0
  );

  if (unresolved.length > 0) {
    const unresolvedSet = new Set(unresolved.map((n) => n.id));
    const outDeg = new Map<string, number>();
    const revAdj = new Map<string, string[]>();
    for (const id of unresolvedSet) {
      outDeg.set(id, 0);
      revAdj.set(id, []);
    }
    for (const id of unresolvedSet) {
      for (const child of adjacency.get(id) ?? []) {
        if (unresolvedSet.has(child)) {
          outDeg.set(id, (outDeg.get(id) ?? 0) + 1);
          revAdj.get(child)!.push(id);
        }
      }
    }
    const peelQueue: string[] = [];
    for (const [id, deg] of outDeg) {
      if (deg === 0) peelQueue.push(id);
    }
    const peeled = new Set<string>();
    let peelHead = 0;
    while (peelHead < peelQueue.length) {
      const id = peelQueue[peelHead++];
      peeled.add(id);
      for (const pred of revAdj.get(id) ?? []) {
        const newDeg = (outDeg.get(pred) ?? 1) - 1;
        outDeg.set(pred, newDeg);
        if (newDeg === 0) peelQueue.push(pred);
      }
    }
    const cycleIds = unresolved.filter((n) => !peeled.has(n.id)).map((n) => n.id);
    const downstreamIds = unresolved.filter((n) => peeled.has(n.id)).map((n) => n.id);

    if (cycleIds.length > 0) {
      warnings.push(
        `Cycle detected involving node(s): ${cycleIds.join(", ")}. Processing with accumulated QPS.`
      );
    }
    if (downstreamIds.length > 0) {
      warnings.push(
        `Node(s) downstream of a cycle: ${downstreamIds.join(", ")}. Traffic propagated after resolving the cycle.`
      );
    }

    // Process cycle members in traffic-flow order: start from members that
    // already accumulated QPS from the acyclic portion, and let each push its
    // output one step onward (around the cycle and out of it), so nodes
    // downstream of the cycle aren't black-holed.
    const cycleSet = new Set(cycleIds);
    const cycleQueue: string[] = cycleIds.filter((id) => (incomingQPS.get(id) ?? 0) > 0);
    const processCycleMember = (nodeId: string) => {
      processed.add(nodeId);
      const output = processNode(nodeId);
      const children = adjacency.get(nodeId) ?? [];
      if (children.length === 0) return;
      const childQPS = distributeTrafficToChildren(nodeId, output);
      for (const [childId, allocation] of childQPS.entries()) {
        if (processed.has(childId)) continue;
        incomingQPS.set(childId, (incomingQPS.get(childId) ?? 0) + allocation.qps);
        incomingWorkQPS.set(childId, (incomingWorkQPS.get(childId) ?? 0) + allocation.workQPS);
        incomingSuccessQPS.set(childId, (incomingSuccessQPS.get(childId) ?? 0) + (allocation.successQPS ?? allocation.qps));
        incomingFailedQPS.set(childId, (incomingFailedQPS.get(childId) ?? 0) + (allocation.failedQPS ?? 0));
        if (cycleSet.has(childId)) cycleQueue.push(childId);
      }
    };
    let cycleHead = 0;
    while (cycleHead < cycleQueue.length) {
      const nodeId = cycleQueue[cycleHead++];
      if (processed.has(nodeId)) continue;
      processCycleMember(nodeId);
    }
    // Cycle members that never saw any traffic still need metrics
    for (const nodeId of cycleIds) {
      if (!processed.has(nodeId)) processCycleMember(nodeId);
    }

    // Topological pass over the downstream-of-cycle subgraph (acyclic by construction).
    const downstreamSet = new Set(downstreamIds);
    const dsInDeg = new Map<string, number>();
    for (const id of downstreamSet) dsInDeg.set(id, 0);
    for (const id of downstreamSet) {
      for (const child of adjacency.get(id) ?? []) {
        if (downstreamSet.has(child)) {
          dsInDeg.set(child, (dsInDeg.get(child) ?? 0) + 1);
        }
      }
    }
    const dsQueue: string[] = [];
    for (const [id, deg] of dsInDeg) {
      if (deg === 0) dsQueue.push(id);
    }
    let dsHead = 0;
    while (dsHead < dsQueue.length) {
      const nodeId = dsQueue[dsHead++];
      if (processed.has(nodeId)) continue;
      processed.add(nodeId);
      const output = processNode(nodeId);
      propagateToUnprocessedChildren(nodeId, output);
      for (const childId of adjacency.get(nodeId) ?? []) {
        if (!downstreamSet.has(childId)) continue;
        const newDeg = (dsInDeg.get(childId) ?? 1) - 1;
        dsInDeg.set(childId, newDeg);
        if (newDeg === 0) dsQueue.push(childId);
      }
    }
  }

  // Disconnected/idle nodes get their base latency, not 0
  for (const node of nodes) {
    if (!nodeMetrics.has(node.id)) {
      nodeMetrics.set(node.id, {
        nodeId: node.id,
        incomingQPS: 0,
        effectiveQPS: capacity.get(node.id) ?? 0,
        utilization: 0,
        latencyMs: node.data.latencyMs, // base latency, not 0
        status: "idle",
        isBottleneck: false,
        failedQPS: 0,
      });
    }
    nodeMetrics.get(node.id)!.rejectedQPS = validationRejectedQPS.get(node.id) ?? 0;
  }

  // Estimate queue accumulation for a sustained interval. This is a
  // deterministic rate projection, not a time-series broker simulation.
  for (const node of nodes) {
    if (node.data.componentId !== "message-queue") continue;
    const acceptedQPS = deliveredQPS.get(node.id) ?? 0;
    const consumers = adjacency.get(node.id) ?? [];
    const consumerDelivered = consumers.map((childId) => deliveredQPS.get(childId) ?? 0);
    const queueMode = node.data.queueDeliveryMode === "competing" ? "competing" : "broadcast";
    const processedQPS = queueMode === "competing"
      ? Math.min(acceptedQPS, consumerDelivered.reduce((sum, qps) => sum + qps, 0))
      : consumers.length > 0
        ? Math.min(acceptedQPS, ...consumerDelivered)
        : 0;
    const backlogGrowthQPS = Math.max(0, acceptedQPS - processedQPS);
    const metric = nodeMetrics.get(node.id);
    if (!metric) continue;

    metric.queueBacklogQPS = backlogGrowthQPS;
    metric.queueDepth = backlogGrowthQPS * sustainedDurationSec;
    if (backlogGrowthQPS > 0) {
      warnings.push(
        `${node.data.label} backlog grows by ${Math.ceil(backlogGrowthQPS)} messages/sec (about ${Math.ceil(metric.queueDepth)} messages over ${sustainedDurationSec}s).`
      );
    }
  }

  // User-facing latency: longest synchronous path from an entry node
  // (async hops — queues, notifications, monitoring — are excluded).
  const totalLatencyMs = computeLongestPathLatency(
    entryNodes.map((n) => n.id),
    syncAdjacency,
    nodeMetrics
  );

  // Throughput is the aggregate accepted load at the leaves of the reachable
  // request graph. Taking a single min() across bottleneck nodes breaks fan-out
  // topologies, where different branches can each be constrained independently
  // while the total system throughput is still the sum of those branch outputs.
  let throughput: number;
  if (nodes.length === 0 || entryNodes.length === 0) {
    throughput = 0;
  } else {
    throughput = computeAggregateThroughput(entryNodes.map((n) => n.id), adjacency, deliveredQPS, requestsPerSec);
  }
  const failedOperationsPerSec = [...nodeMetrics.values()].reduce(
    (sum, metric) => sum + (metric.failedQPS ?? 0),
    0
  );
  const rejectedRequestsPerSec = [...validationRejectedQPS.values()].reduce((sum, qps) => sum + qps, 0);
  if (failedOperationsPerSec > 0) {
    warnings.push(`About ${Math.ceil(failedOperationsPerSec)} operations/sec fail after retries or are rejected by capacity.`);
  }
  if (rejectedRequestsPerSec > 0) {
    warnings.push(`About ${Math.ceil(rejectedRequestsPerSec)} requests/sec are rejected by endpoint validation.`);
  }

  return {
    nodeMetrics,
    totalLatencyMs,
    bottleneckNodes,
    throughput,
    failedOperationsPerSec,
    rejectedRequestsPerSec,
    timestamp: Date.now(),
    warnings,
  };
}

/**
 * Longest-path latency over the synchronous edge graph, starting from the
 * simulation's entry nodes. Nodes only reachable via async edges don't
 * contribute — async work isn't on the user-facing request path.
 */
function computeAggregateThroughput(
  entryIds: string[],
  adjacency: Map<string, string[]>,
  deliveredQPS: Map<string, number>,
  requestsPerSec: number
): number {
  if (entryIds.length === 0) return 0;

  const reachable = new Set<string>(entryIds);
  const queue: string[] = [...entryIds];
  let head = 0;

  while (head < queue.length) {
    const id = queue[head++];
    for (const childId of adjacency.get(id) ?? []) {
      if (!reachable.has(childId)) {
        reachable.add(childId);
        queue.push(childId);
      }
    }
  }

  const leafIds = [...reachable].filter((id) => (adjacency.get(id) ?? []).length === 0);
  if (leafIds.length > 0) {
    const leafThroughput = leafIds.reduce(
      (sum, id) => sum + (deliveredQPS.get(id) ?? 0),
      0
    );
    return Math.min(requestsPerSec, leafThroughput);
  }

  const aggregateThroughput = [...reachable].reduce(
    (sum, id) => sum + (deliveredQPS.get(id) ?? 0),
    0
  );
  return Math.min(requestsPerSec, aggregateThroughput);
}

function findStronglyConnectedComponents(
  reachable: Set<string>,
  adjacency: Map<string, string[]>
): Map<string, number> {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const componentIds = new Map<string, number>();
  let nextIndex = 0;
  let nextComponentId = 0;

  const visit = (nodeId: string) => {
    index.set(nodeId, nextIndex);
    lowLink.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const childId of adjacency.get(nodeId) ?? []) {
      if (!reachable.has(childId)) continue;
      if (!index.has(childId)) {
        visit(childId);
        lowLink.set(
          nodeId,
          Math.min(lowLink.get(nodeId) ?? nextIndex, lowLink.get(childId) ?? nextIndex)
        );
      } else if (onStack.has(childId)) {
        lowLink.set(
          nodeId,
          Math.min(lowLink.get(nodeId) ?? nextIndex, index.get(childId) ?? nextIndex)
        );
      }
    }

    if ((lowLink.get(nodeId) ?? nextIndex) === (index.get(nodeId) ?? nextIndex)) {
      let current: string | undefined;
      do {
        current = stack.pop();
        if (current) {
          onStack.delete(current);
          componentIds.set(current, nextComponentId);
        }
      } while (current !== nodeId);
      nextComponentId += 1;
    }
  };

  for (const nodeId of [...reachable]) {
    if (!index.has(nodeId)) visit(nodeId);
  }

  return componentIds;
}

function computeLongestPathLatency(
  entryIds: string[],
  syncAdjacency: Map<string, string[]>,
  metrics: Map<string, NodeMetrics>
): number {
  if (entryIds.length === 0) return 0;

  const reachable = new Set<string>(entryIds);
  const bfs: string[] = [...entryIds];
  let bfsHead = 0;
  while (bfsHead < bfs.length) {
    const id = bfs[bfsHead++];
    for (const child of syncAdjacency.get(id) ?? []) {
      if (!reachable.has(child)) {
        reachable.add(child);
        bfs.push(child);
      }
    }
  }

  const componentIds = findStronglyConnectedComponents(reachable, syncAdjacency);
  const componentWeight = new Map<number, number>();
  for (const [nodeId, componentId] of componentIds.entries()) {
    const nodeLatency = metrics.get(nodeId)?.latencyMs ?? 0;
    componentWeight.set(
      componentId,
      Math.max(componentWeight.get(componentId) ?? 0, nodeLatency)
    );
  }

  const componentAdjacency = new Map<number, number[]>();
  const componentInDegree = new Map<number, number>();
  const componentSet = new Set(componentIds.values());
  for (const componentId of componentSet) {
    componentAdjacency.set(componentId, []);
    componentInDegree.set(componentId, 0);
  }

  for (const nodeId of reachable) {
    const fromComponent = componentIds.get(nodeId);
    if (fromComponent === undefined) continue;
    for (const childId of syncAdjacency.get(nodeId) ?? []) {
      if (!reachable.has(childId)) continue;
      const toComponent = componentIds.get(childId);
      if (toComponent === undefined || toComponent === fromComponent) continue;
      const nextEdges = componentAdjacency.get(fromComponent) ?? [];
      if (!nextEdges.includes(toComponent)) {
        nextEdges.push(toComponent);
        componentAdjacency.set(fromComponent, nextEdges);
        componentInDegree.set(toComponent, (componentInDegree.get(toComponent) ?? 0) + 1);
      }
    }
  }

  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const entryId of entryIds) {
    const startComponent = componentIds.get(entryId);
    if (startComponent === undefined) continue;
    const startDistance = componentWeight.get(startComponent) ?? 0;
    dist.set(startComponent, Math.max(dist.get(startComponent) ?? 0, startDistance));
    queue.push(startComponent);
  }

  const processed = new Set<number>();
  let head = 0;
  while (head < queue.length) {
    const componentId = queue[head++];
    if (processed.has(componentId)) continue;
    processed.add(componentId);

    const currentDist = dist.get(componentId) ?? 0;
    for (const nextComponent of componentAdjacency.get(componentId) ?? []) {
      const candidate = currentDist + (componentWeight.get(nextComponent) ?? 0);
      if (candidate > (dist.get(nextComponent) ?? 0)) {
        dist.set(nextComponent, candidate);
      }

      const nextInDegree = (componentInDegree.get(nextComponent) ?? 1) - 1;
      componentInDegree.set(nextComponent, nextInDegree);
      if (nextInDegree === 0) {
        queue.push(nextComponent);
      }
    }
  }

  return dist.size === 0 ? 0 : Math.max(0, ...dist.values());
}
