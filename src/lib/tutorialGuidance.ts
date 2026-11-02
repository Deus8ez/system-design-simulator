import type { TutorialGuidanceStep, TutorialStep } from "@/types/tutorial";

/**
 * Turn each objective into practical UI directions. Objective evaluation stays
 * independent: these directions help learners find controls but never complete
 * a step or mutate their design on the learner's behalf.
 */
export function getTutorialGuidance(step: TutorialStep): TutorialGuidanceStep[] {
  if (step.detailedSteps?.length) return step.detailedSteps;

  const objective = step.objective;
  switch (objective.kind) {
    case "components-and-edges":
      return [
        ...objective.components.map(({ componentId }) => ({
          instruction: `Check the canvas first. If ${componentId.replaceAll("-", " ")} is missing, open Components and add it by dragging the palette row or tapping its + button; otherwise reuse the existing node.`,
          target: { kind: "palette" as const, componentId },
        })),
        ...(objective.edges ?? []).map(({ sourceComponentId, targetComponentId }) => ({
          instruction: `Connect ${sourceComponentId.replaceAll("-", " ")} to ${targetComponentId.replaceAll("-", " ")} by dragging from the source node's right handle to the target node's left handle.`,
          target: { kind: "node" as const, componentId: sourceComponentId },
        })),
      ];
    case "endpoint-contracts":
      return [
        { instruction: "Click the App Server on the canvas, then open the Props tab on the right.", target: { kind: "node", componentId: objective.serviceComponentId } },
        ...objective.contracts.flatMap((contract, contractIndex) => [
          { instruction: `In Service endpoints, click Add route${contractIndex === 0 ? "" : ` again to create route ${contractIndex + 1}`}.`, target: { kind: "control" as const, id: "endpoint-add", componentId: objective.serviceComponentId } },
          { instruction: `For this route, choose ${contract.method} in the method dropdown.`, target: { kind: "control" as const, id: `endpoint-method-${contractIndex}`, componentId: objective.serviceComponentId }, value: contract.method },
          { instruction: `Enter ${contract.path} in the path field for the ${contract.method} endpoint.`, target: { kind: "control" as const, id: `endpoint-path-${contractIndex}`, componentId: objective.serviceComponentId }, value: contract.path },
          ...contract.steps.flatMap((pipelineStep, stepIndex) => {
            const targetName = pipelineStep.targetComponentId?.replaceAll("-", " ");
            return [
              { instruction: `In ${contract.method} ${contract.path}, click Add logic step${stepIndex === 0 ? "" : ` again to add step ${stepIndex + 1}`}.`, target: { kind: "control" as const, id: `endpoint-step-add-${contractIndex}`, componentId: objective.serviceComponentId } },
              { instruction: `Set pipeline step ${stepIndex + 1} to “${pipelineStep.kind}”.`, target: { kind: "control" as const, id: `endpoint-step-kind-${contractIndex}-${stepIndex}`, componentId: objective.serviceComponentId }, value: pipelineStep.kind },
              ...(pipelineStep.targetComponentId
                ? [{ instruction: `Choose ${targetName} in the downstream component dropdown.`, target: { kind: "control" as const, id: `endpoint-step-target-${contractIndex}-${stepIndex}`, componentId: objective.serviceComponentId } }]
                : []),
              ...(pipelineStep.target ? [{ instruction: `Enter “${pipelineStep.target}” in the resource or topic field for this pipeline step.`, target: { kind: "control" as const, id: `endpoint-step-resource-${contractIndex}-${stepIndex}`, componentId: objective.serviceComponentId }, value: pipelineStep.target }] : []),
            ];
          }),
        ]),
        ...(objective.gatewayComponentId ? [
          { instruction: `Click the API Gateway on the canvas, then open Props. Add routes matching the service endpoints: ${objective.contracts.map((contract) => `${contract.method} ${contract.path}`).join(", ")}.`, target: { kind: "node" as const, componentId: objective.gatewayComponentId } },
          ...objective.contracts.flatMap((contract, routeIndex) => [
            { instruction: `In Gateway routes, click Add route${routeIndex === 0 ? "" : ` again to create route ${routeIndex + 1}`}.`, target: { kind: "control" as const, id: "gateway-route-add", componentId: objective.gatewayComponentId } },
            { instruction: `Choose ${contract.method} in this gateway route's method dropdown.`, target: { kind: "control" as const, id: `gateway-route-method-${routeIndex}`, componentId: objective.gatewayComponentId }, value: contract.method },
            { instruction: `Enter ${contract.path} in this gateway route's path field.`, target: { kind: "control" as const, id: `gateway-route-path-${routeIndex}`, componentId: objective.gatewayComponentId }, value: contract.path },
            { instruction: "Choose the connected App Server in the backend dropdown.", target: { kind: "control" as const, id: `gateway-route-backend-${routeIndex}`, componentId: objective.gatewayComponentId } },
          ]),
        ] : []),
      ];
    case "database-schema": {
      const tableIndex = 0;
      return [
        { instruction: `Click ${objective.databaseComponentId.replaceAll("-", " ")} on the canvas, open Props, and click Add table (or Add collection for NoSQL).`, target: { kind: "control", id: "database-table-add", componentId: objective.databaseComponentId } },
        { instruction: `Type ${objective.tableName} in the table name field.`, target: { kind: "control", id: `database-table-name-${tableIndex}`, componentId: objective.databaseComponentId }, value: objective.tableName },
        ...objective.columns.flatMap((column, index) => [
          { instruction: `The new ${objective.tableName} starts with an id primary-key column. Use Add column, then enter ${column} in the new name field.`, target: { kind: "control" as const, id: `database-column-add-${tableIndex}`, componentId: objective.databaseComponentId } },
          { instruction: `Set Column ${index + 2} name to ${column}.`, target: { kind: "control" as const, id: "database-column-name", componentId: objective.databaseComponentId, occurrence: index + 1 }, value: column },
        ]),
        ...(objective.indexedColumns?.length ? [
          { instruction: `Click Add index in the ${objective.tableName} schema.`, target: { kind: "control" as const, id: "database-index-add-0", componentId: objective.databaseComponentId } },
          { instruction: `In Index 1 columns, enter ${objective.indexedColumns.join(", ")} exactly, then press Enter or leave the field to save.`, target: { kind: "control" as const, id: "database-index-columns", componentId: objective.databaseComponentId }, value: objective.indexedColumns.join(", ") },
        ] : []),
      ];
    }
    case "cache-behavior": {
      const readEndpointIndex = objective.readEndpoint.method === "GET" ? 0 : 1;
      const writeEndpointIndex = objective.writeEndpoint.method === "GET" ? 0 : 1;
      const cacheReadStepIndex = 1;
      const cacheInvalidateStepIndex = 1;
      return [
        { instruction: `If Cache / Redis is not on the canvas, open Components and add it from the palette.`, target: { kind: "palette", componentId: objective.cacheComponentId } },
        { instruction: `Connect ${objective.serviceComponentId.replaceAll("-", " ")} to ${objective.cacheComponentId.replaceAll("-", " ")} by dragging from the App Server's right handle to the Cache's left handle.`, target: { kind: "node", componentId: objective.serviceComponentId } },
        { instruction: "Select the App Server, open Props, and find the read endpoint. Add Cache read; it is appended after the existing database read, so move it up one position afterward.", target: { kind: "node", componentId: objective.serviceComponentId } },
        { instruction: `Select ${objective.readEndpoint.method} ${objective.readEndpoint.path}, then click Add logic step.`, target: { kind: "control", id: `endpoint-step-add-${readEndpointIndex}`, componentId: objective.serviceComponentId } },
        { instruction: "Set the appended pipeline step to Cache read.", target: { kind: "control", id: `endpoint-step-kind-${readEndpointIndex}-${cacheReadStepIndex}`, componentId: objective.serviceComponentId }, value: "cache-read" },
        { instruction: "Choose the connected Cache / Redis in the downstream component dropdown.", target: { kind: "control", id: `endpoint-step-target-${readEndpointIndex}-${cacheReadStepIndex}`, componentId: objective.serviceComponentId } },
        { instruction: "Enter the cache key pattern requested by the tutorial prompt in the resource field.", target: { kind: "control", id: `endpoint-step-resource-${readEndpointIndex}-${cacheReadStepIndex}`, componentId: objective.serviceComponentId } },
        { instruction: "If the database read is above Cache read, use the Cache read row's Move step up button until Cache read comes first.", target: { kind: "control", id: `endpoint-step-up-${readEndpointIndex}-${cacheReadStepIndex}`, componentId: objective.serviceComponentId } },
        { instruction: `Select Cache / Redis, open Props, and enter ${objective.ttlSeconds ?? "the requested"} in Default TTL (seconds).`, target: { kind: "control", id: "cache-ttl", componentId: objective.cacheComponentId }, value: objective.ttlSeconds?.toString() },
        ...(objective.requireInvalidation ? [
          { instruction: `Select ${objective.writeEndpoint.method} ${objective.writeEndpoint.path}, then click Add logic step to append cache invalidation after its database write.`, target: { kind: "control" as const, id: `endpoint-step-add-${writeEndpointIndex}`, componentId: objective.serviceComponentId } },
          { instruction: "Set the appended pipeline step to Cache invalidate.", target: { kind: "control" as const, id: `endpoint-step-kind-${writeEndpointIndex}-${cacheInvalidateStepIndex}`, componentId: objective.serviceComponentId }, value: "cache-invalidate" },
          { instruction: "Choose the same connected Cache / Redis in the downstream component dropdown.", target: { kind: "control" as const, id: `endpoint-step-target-${writeEndpointIndex}-${cacheInvalidateStepIndex}`, componentId: objective.serviceComponentId } },
          { instruction: "Enter the same cache key pattern used by the read endpoint.", target: { kind: "control" as const, id: `endpoint-step-resource-${writeEndpointIndex}-${cacheInvalidateStepIndex}`, componentId: objective.serviceComponentId } },
        ] : []),
      ];
    }
    case "queue-setup":
    case "queue-contract": {
      const queueId = objective.queueComponentId;
      const consumerId = objective.consumerComponentId;
      const producerId = objective.kind === "queue-contract" ? objective.serviceComponentId : undefined;
      const topicName = objective.topicName;
      const producerEndpointIndex = objective.kind === "queue-contract" && objective.producerEndpoint?.method
        ? objective.producerEndpoint.method === "GET" ? 0 : 1
        : 1;
      const producerPipelineStepIndex = 1;
      return [
        ...[queueId, consumerId].map((componentId) => ({
          instruction: `Check the canvas first. If ${componentId.replaceAll("-", " ")} is missing, open Components and add it using its + button or by dragging it; otherwise reuse the existing node.`,
          target: { kind: "palette" as const, componentId },
        })),
        ...(producerId ? [{ instruction: `Use the existing ${producerId.replaceAll("-", " ")} node. Connect it to Message Queue, then connect Message Queue to ${consumerId.replaceAll("-", " ")} by dragging from each source node's right handle to the target node's left handle.`, target: { kind: "node" as const, componentId: producerId } }] : []),
        { instruction: `Select Message Queue → Props. Under Topics, click Add topic.`, target: { kind: "control", id: "queue-topic-add", componentId: queueId } },
        { instruction: `Type “${topicName}” in the Queue topic name field. Use exactly this spelling so the publisher and consumer agree.`, target: { kind: "control", id: "queue-topic-name", componentId: queueId }, value: topicName },
        { instruction: `Under Consumer subscriptions, click Add subscription. Choose ${consumerId.replaceAll("-", " ")} as the consumer and “${topicName}” as the topic.`, target: { kind: "control", id: "queue-subscription-add", componentId: queueId }, value: topicName },
        ...(objective.deliveryMode ? [{ instruction: `Set Queue consumer delivery mode to ${objective.deliveryMode === "competing" ? "Competing consumer group" : "Broadcast to each consumer"}.`, target: { kind: "control" as const, id: "queue-delivery-mode", componentId: queueId }, value: objective.deliveryMode }] : []),
        ...(producerId ? [
          { instruction: `Select ${objective.kind === "queue-contract" ? `${objective.producerEndpoint?.method ?? "POST"} ${objective.producerEndpoint?.path ?? "the producer endpoint"}` : "the producer endpoint"}, then click Add logic step.`, target: { kind: "control" as const, id: `endpoint-step-add-${producerEndpointIndex}`, componentId: producerId } },
          { instruction: "Set the new pipeline step to Publish event.", target: { kind: "control" as const, id: `endpoint-step-kind-${producerEndpointIndex}-${producerPipelineStepIndex}`, componentId: producerId }, value: "publish-event" },
          { instruction: `Enter “${topicName}” in the topic field for this step.`, target: { kind: "control" as const, id: `endpoint-step-resource-${producerEndpointIndex}-${producerPipelineStepIndex}`, componentId: producerId }, value: topicName },
          { instruction: "Choose the connected Message Queue in the downstream component dropdown.", target: { kind: "control" as const, id: `endpoint-step-target-${producerEndpointIndex}-${producerPipelineStepIndex}`, componentId: producerId } },
          { instruction: "Click the producer → queue connection on the canvas. In Edge Properties, choose Async so publishing does not block the request response.", target: { kind: "edge" as const, sourceComponentId: producerId, targetComponentId: queueId } },
        ] : []),
      ];
    }
    case "rate-limit-policy":
      return [
        { instruction: `Select the Rate Limiter and open Props. Choose ${objective.algorithm} in Algorithm and ${objective.keyBy} in Key by.`, target: { kind: "node", componentId: objective.componentId } },
        { instruction: `Enter ${objective.minimumRequestsPerWindow} for Requests per window and ${objective.windowSeconds} for Window (seconds). If required, set estimated distinct keys and increase replicas.`, target: { kind: "control", id: "rate-limit-policy", componentId: objective.componentId } },
        ...(objective.requiredEdges ?? []).map(({ sourceComponentId, targetComponentId }) => ({ instruction: `Connect ${sourceComponentId.replaceAll("-", " ")} → ${targetComponentId.replaceAll("-", " ")} using the canvas handles.`, target: { kind: "node" as const, componentId: sourceComponentId } })),
      ];
    case "replicas":
      return objective.components.map(({ componentId, minimum }) => ({
        instruction: `Select ${componentId.replaceAll("-", " ")} on the canvas, open Props, and set Replicas to at least ${minimum}.`,
        target: { kind: "control" as const, id: "replicas", componentId },
        value: String(minimum),
      }));
    case "compile-ready":
      return [{ instruction: "Open the Simulate tab on the right. Resolve each blocking diagnostic there, then return to this coach and check the step.", target: { kind: "control", id: "simulation-tab" } }];
    case "simulation-checkpoint":
      return [{ instruction: `Click Run ${objective.requestsPerSec.toLocaleString()} req/s in this tutorial coach. When the run finishes, click Check step.`, target: { kind: "control", id: "tutorial-run" }, value: objective.requestsPerSec.toLocaleString() }];
  }
}