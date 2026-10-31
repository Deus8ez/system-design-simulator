import type { Edge, Node } from "@xyflow/react";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { CompileResult } from "@/types/compiler";
import type { SimulationResult } from "@/types/simulation";
import type { TutorialCheckResult, TutorialObjective } from "@/types/tutorial";

export interface TutorialEvaluationContext {
  nodes: Node<ComponentNodeData>[];
  edges: Edge[];
  compilation?: CompileResult;
  simulation?: {
    result: SimulationResult | null;
    requestsPerSec: number;
    recordedSignature?: string;
    recordedTimestamp?: number;
    currentSignature?: string;
  };
}

export function getTutorialDesignSignature(
  nodes: Node<ComponentNodeData>[],
  edges: Edge[],
): string {
  const structuralNodes = nodes
    .map((node) => {
      const data = { ...node.data };
      delete data.utilization;
      delete data.status;
      delete data.isBottleneck;
      return { id: node.id, type: node.type, data };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const structuralEdges = edges
    .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, data: edge.data }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify({ nodes: structuralNodes, edges: structuralEdges });
}

function componentNodes(nodes: Node<ComponentNodeData>[], componentId: string) {
  return nodes.filter(
    (node) => node.type !== "text" && node.data.componentId === componentId,
  );
}

function componentByNodeId(nodes: Node<ComponentNodeData>[], nodeId: string | undefined) {
  return nodeId ? nodes.find((node) => node.id === nodeId) : undefined;
}

function hasComponentEdge(
  nodes: Node<ComponentNodeData>[],
  edges: Edge[],
  sourceComponentId: string,
  targetComponentId: string,
): boolean {
  return edges.some((edge) =>
    componentNodes(nodes, sourceComponentId).some((source) => source.id === edge.source) &&
    componentNodes(nodes, targetComponentId).some((target) => target.id === edge.target),
  );
}

export function evaluateTutorialObjective(
  objective: TutorialObjective,
  context: TutorialEvaluationContext,
): TutorialCheckResult {
  const { nodes, edges } = context;

  switch (objective.kind) {
    case "components-and-edges": {
      for (const required of objective.components) {
        const minimum = required.minimum ?? 1;
        const instances = componentNodes(nodes, required.componentId);
        if (instances.length < minimum) {
          return {
            complete: false,
            feedback: `Add ${minimum > 1 ? `at least ${minimum} ` : "a "}${required.componentId} component.`,
          };
        }
        if (required.replicas !== undefined && !instances.some((node) => node.data.replicas >= required.replicas!)) {
          return { complete: false, feedback: `Set ${required.componentId} replicas to at least ${required.replicas}.` };
        }
      }
      for (const edge of objective.edges ?? []) {
        if (!hasComponentEdge(nodes, edges, edge.sourceComponentId, edge.targetComponentId)) {
          return {
            complete: false,
            feedback: `Connect ${edge.sourceComponentId} directly to ${edge.targetComponentId}.`,
          };
        }
      }
      for (const edge of objective.forbiddenEdges ?? []) {
        if (hasComponentEdge(nodes, edges, edge.sourceComponentId, edge.targetComponentId)) {
          return {
            complete: false,
            feedback: `Remove the direct ${edge.sourceComponentId} → ${edge.targetComponentId} connection after rerouting traffic.`,
          };
        }
      }
      return { complete: true, feedback: "Required components and connections are in place." };
    }

    case "endpoint-contracts": {
      const services = componentNodes(nodes, objective.serviceComponentId);
      if (services.length === 0) {
        return { complete: false, feedback: `Add ${objective.serviceComponentId} before configuring its API.` };
      }
      for (const contract of objective.contracts) {
        const service = services.find((node) =>
          (node.data.endpoints ?? []).some((endpoint) =>
            endpoint.method === contract.method && endpoint.path === contract.path,
          ),
        );
        const endpoint = service?.data.endpoints?.find((item) =>
          item.method === contract.method && item.path === contract.path,
        );
        if (!endpoint) {
          return { complete: false, feedback: `Configure ${contract.method} ${contract.path} on the App Server.` };
        }
        for (const requiredStep of contract.steps) {
          const operation = endpoint.steps.find((step) => {
            if (step.kind !== requiredStep.kind) return false;
            if (requiredStep.target !== undefined && step.target !== requiredStep.target) return false;
            if (requiredStep.targetComponentId !== undefined) {
              return componentByNodeId(nodes, step.targetNodeId)?.data.componentId === requiredStep.targetComponentId;
            }
            return true;
          });
          if (!operation) {
            return {
              complete: false,
              feedback: `Add a ${requiredStep.kind} operation to ${contract.method} ${contract.path}${requiredStep.target ? ` for “${requiredStep.target}”` : ""}.`,
            };
          }
        }
        if (objective.gatewayComponentId) {
          const gateways = componentNodes(nodes, objective.gatewayComponentId);
          if (!hasComponentEdge(nodes, edges, objective.gatewayComponentId, objective.serviceComponentId)) {
            return { complete: false, feedback: `Connect ${objective.gatewayComponentId} directly to ${objective.serviceComponentId}.` };
          }
          const matchingRoute = gateways.some((gateway) =>
            (gateway.data.routes ?? []).some((route) =>
              route.method === contract.method &&
              route.path === contract.path &&
              componentByNodeId(nodes, route.backendNodeId)?.id === service?.id,
            ),
          );
          if (!matchingRoute) {
            return { complete: false, feedback: `Route ${contract.method} ${contract.path} from the Gateway to the configured App Server.` };
          }
        }
      }
      return { complete: true, feedback: "The requested endpoint contracts and routes are configured." };
    }

    case "database-schema": {
      const databases = componentNodes(nodes, objective.databaseComponentId);
      const table = databases.flatMap((database) => database.data.tables ?? [])
        .find((item) => item.name.toLowerCase() === objective.tableName.toLowerCase());
      if (!table) {
        return { complete: false, feedback: `Add a ${objective.tableName} table to ${objective.databaseComponentId}.` };
      }
      const columnNames = new Set(table.columns.map((column) => column.name.toLowerCase()));
      const missingColumns = objective.columns.filter((name) => !columnNames.has(name.toLowerCase()));
      if (missingColumns.length > 0) {
        return { complete: false, feedback: `Add the required ${objective.tableName} column${missingColumns.length === 1 ? "" : "s"}: ${missingColumns.join(", ")}.` };
      }
      for (const name of objective.indexedColumns ?? []) {
        const indexed = table.indexes.some((index) =>
          index.columns.some((column) => column.toLowerCase() === name.toLowerCase()),
        );
        if (!indexed) return { complete: false, feedback: `Add an index on ${objective.tableName}.${name}.` };
      }
      return { complete: true, feedback: "The required data fields and lookup indexes are present." };
    }

    case "cache-behavior": {
      const caches = componentNodes(nodes, objective.cacheComponentId);
      if (caches.length === 0) return { complete: false, feedback: `Add a ${objective.cacheComponentId} component.` };
      if (!hasComponentEdge(nodes, edges, objective.serviceComponentId, objective.cacheComponentId)) {
        return { complete: false, feedback: `Connect ${objective.serviceComponentId} to ${objective.cacheComponentId}.` };
      }
      const cacheIds = new Set(caches.map((node) => node.id));
      const serviceHasStep = (method: string, path: string, kind: string) =>
        componentNodes(nodes, objective.serviceComponentId).some((service) =>
          (service.data.endpoints ?? []).some((endpoint) =>
            endpoint.method === method && endpoint.path === path &&
            endpoint.steps.some((step) => step.kind === kind && cacheIds.has(step.targetNodeId ?? "")),
          ),
        );
      if (!serviceHasStep(objective.readEndpoint.method, objective.readEndpoint.path, "cache-read")) {
        return { complete: false, feedback: `Add a cache-read step targeting the cache to ${objective.readEndpoint.method} ${objective.readEndpoint.path}.` };
      }
      if (objective.requireInvalidation !== false && !serviceHasStep(objective.writeEndpoint.method, objective.writeEndpoint.path, "cache-invalidate")) {
        return { complete: false, feedback: `Add a cache-invalidate step targeting the cache to ${objective.writeEndpoint.method} ${objective.writeEndpoint.path}.` };
      }
      if (objective.ttlSeconds !== undefined && !caches.some((cache) => cache.data.cacheConfig?.defaultTtlSeconds === objective.ttlSeconds)) {
        return { complete: false, feedback: `Set the cache default TTL to ${objective.ttlSeconds} seconds.` };
      }
      return { complete: true, feedback: "Cache reads and write-path coherence settings are configured." };
    }

    case "queue-contract": {
      const queues = componentNodes(nodes, objective.queueComponentId);
      const consumers = componentNodes(nodes, objective.consumerComponentId);
      const services = componentNodes(nodes, objective.serviceComponentId);
      if (queues.length === 0) return { complete: false, feedback: `Add a ${objective.queueComponentId}.` };
      if (consumers.length === 0) return { complete: false, feedback: `Add a ${objective.consumerComponentId}.` };
      const configured = queues.some((queue) => {
        const config = queue.data.queueConfig;
        return config?.topics?.some((topic) => topic.name === objective.topicName) &&
          config.subscriptions?.some((subscription) =>
            subscription.topicName === objective.topicName &&
            consumers.some((consumer) => consumer.id === subscription.consumerNodeId),
          ) &&
          (!objective.deliveryMode || queue.data.queueDeliveryMode === objective.deliveryMode) &&
          services.some((service) =>
            (service.data.endpoints ?? []).some((endpoint) =>
              (!objective.producerEndpoint || (endpoint.method === objective.producerEndpoint.method && endpoint.path === objective.producerEndpoint.path)) &&
              endpoint.steps.some((step) =>
                step.kind === "publish-event" && step.target === objective.topicName &&
                componentByNodeId(nodes, step.targetNodeId)?.id === queue.id,
              ),
            ),
          ) &&
          hasComponentEdge(nodes, edges, objective.serviceComponentId, objective.queueComponentId) &&
          hasComponentEdge(nodes, edges, objective.queueComponentId, objective.consumerComponentId) &&
          (!objective.requireAsync || edges.some((edge) =>
            edge.data && typeof edge.data === "object" && "async" in edge.data && edge.data.async === true &&
            services.some((service) => service.id === edge.source) && edge.target === queue.id,
          ));
      });
      if (!configured) {
        return {
          complete: false,
          feedback: `Configure topic “${objective.topicName}”, publish it from ${objective.serviceComponentId}, subscribe ${objective.consumerComponentId}, and connect producer → queue → consumer.`,
        };
      }
      return { complete: true, feedback: "The producer, topic, and consumer are connected." };
    }

    case "rate-limit-policy": {
      const limiter = componentNodes(nodes, objective.componentId).find((node) => {
        const config = node.data.rateLimiterConfig;
        return config?.algorithm === objective.algorithm &&
          config.keyBy === objective.keyBy &&
          (config.requestsPerWindow ?? 0) >= objective.minimumRequestsPerWindow &&
          config.windowSeconds === objective.windowSeconds &&
          (objective.minimumReplicas === undefined || node.data.replicas >= objective.minimumReplicas) &&
          (objective.minimumDistinctKeys === undefined ||
            (config.estimatedDistinctKeys ?? 0) >= objective.minimumDistinctKeys);
      });
      if (!limiter) {
        return {
          complete: false,
          feedback: `Configure ${objective.algorithm} with ${objective.keyBy} keys, at least ${objective.minimumRequestsPerWindow} requests per ${objective.windowSeconds}s${objective.minimumDistinctKeys ? ` and at least ${objective.minimumDistinctKeys} estimated keys` : ""}${objective.minimumReplicas ? ` and ${objective.minimumReplicas} limiter replicas` : ""}.`,
        };
      }
      for (const edge of objective.requiredEdges ?? []) {
        if (!hasComponentEdge(nodes, edges, edge.sourceComponentId, edge.targetComponentId)) {
          return { complete: false, feedback: `Connect ${edge.sourceComponentId} directly to ${edge.targetComponentId} so the policy is on the request path.` };
        }
      }
      for (const edge of objective.forbiddenEdges ?? []) {
        if (hasComponentEdge(nodes, edges, edge.sourceComponentId, edge.targetComponentId)) {
          return { complete: false, feedback: `Remove the direct ${edge.sourceComponentId} → ${edge.targetComponentId} connection so requests cannot bypass the limiter.` };
        }
      }
      return { complete: true, feedback: "The sustained rate-limit policy matches the lesson requirements." };
    }

    case "replicas": {
      for (const requirement of objective.components) {
        const hasReplicas = componentNodes(nodes, requirement.componentId)
          .some((item) => item.data.replicas >= requirement.minimum);
        if (!hasReplicas) {
          return { complete: false, feedback: `Set ${requirement.componentId} replicas to at least ${requirement.minimum}.` };
        }
      }
      return { complete: true, feedback: "The required service tiers have the requested replica capacity." };
    }

    case "compile-ready": {
      if (!context.compilation) {
        return { complete: false, feedback: "Run the design compiler from the Simulate tab, then check this step again." };
      }
      if (!context.compilation.ok) {
        const firstError = context.compilation.diagnostics.find((diagnostic) => diagnostic.severity === "error");
        return {
          complete: false,
          feedback: firstError?.remediation ?? firstError?.message ?? "Resolve blocking design diagnostics before continuing.",
        };
      }
      return { complete: true, feedback: "The design compiles without blocking errors." };
    }

    case "simulation-checkpoint": {
      const simulation = context.simulation;
      if (!simulation?.result) {
        return { complete: false, feedback: `Run a simulation at ${objective.requestsPerSec.toLocaleString()} requests/sec, then check this step again.` };
      }
      if (simulation.requestsPerSec !== objective.requestsPerSec) {
        return { complete: false, feedback: `Set the simulation load to ${objective.requestsPerSec.toLocaleString()} requests/sec and run it again.` };
      }
      if (
        simulation.recordedSignature !== simulation.currentSignature ||
        simulation.recordedTimestamp !== simulation.result.timestamp
      ) {
        return { complete: false, feedback: "The design changed after the last run. Run this scenario again to evaluate the current design." };
      }
      return { complete: true, feedback: "The load scenario has completed; compare throughput, bottlenecks, and any rejections before continuing." };
    }
  }
}
