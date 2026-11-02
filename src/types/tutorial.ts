import type { EndpointLogicKind, EndpointMethod, RateLimitAlgorithm, RateLimitKey } from "@/types/component";

export type TutorialLevelId = "low" | "medium" | "high";

export interface TutorialEdgeRequirement {
  sourceComponentId: string;
  targetComponentId: string;
}

export type TutorialObjective =
  | {
      kind: "components-and-edges";
      components: Array<{ componentId: string; minimum?: number; replicas?: number }>;
      edges?: TutorialEdgeRequirement[];
      forbiddenEdges?: TutorialEdgeRequirement[];
    }
  | {
      kind: "endpoint-contracts";
      serviceComponentId: string;
      gatewayComponentId?: string;
      asyncEdges?: TutorialEdgeRequirement[];
      contracts: Array<{
        method: EndpointMethod;
        path: string;
        steps: Array<{
          kind: EndpointLogicKind;
          targetComponentId?: string;
          target?: string;
        }>;
      }>;
    }
  | {
      kind: "database-schema";
      databaseComponentId: string;
      tableName: string;
      columns: string[];
      indexedColumns?: string[];
    }
  | {
      kind: "database-partitioning";
      databaseComponentId: string;
      tableName: string;
      keyColumn: string;
      minimumShards: number;
      minimumHotKeyTrafficShare: number;
      minimumEstimatedWorkCapacityPerShard?: number;
    }
  | {
      kind: "database-read-replicas";
      databaseComponentId: string;
      minimumReplicas: number;
      requiredReadTrafficToReplicasShare?: number;
      requiredEstimatedReplicationLagMs?: number;
      requiredMaximumToleratedReadStalenessMs?: number;
    }
  | {
      kind: "cache-behavior";
      serviceComponentId: string;
      cacheComponentId: string;
      readEndpoint: { method: EndpointMethod; path: string };
      writeEndpoint: { method: EndpointMethod; path: string };
      ttlSeconds?: number;
      requireInvalidation?: boolean;
    }
  | {
      kind: "queue-setup";
      queueComponentId: string;
      consumerComponentId: string;
      topicName: string;
      deliveryMode?: "broadcast" | "competing";
    }
  | {
      kind: "queue-retention";
      queueComponentId: string;
      topicName: string;
      minimumRetentionHours: number;
    }
  | {
      kind: "queue-partitions";
      queueComponentId: string;
      topicName: string;
      minimumPartitions: number;
      minimumHotPartitionTrafficShare?: number;
      minimumEstimatedAverageMessageSizeBytes?: number;
    }
  | {
      kind: "queue-retry-estimate";
      queueComponentId: string;
      topicName: string;
      assumedFailureRatePerAttempt: number;
      minimumMaxDeliveryRetries: number;
      assumedRetryBackoffMs: number;
    }
  | {
      kind: "reflection";
      prompt: string;
      limitation: string;
    }
  | {
      kind: "queue-contract";
      serviceComponentId: string;
      queueComponentId: string;
      consumerComponentId: string;
      topicName: string;
      producerEndpoint?: { method: EndpointMethod; path: string };
      deliveryMode?: "broadcast" | "competing";
      requireAsync?: boolean;
    }
  | {
      kind: "rate-limit-policy";
      componentId: string;
      algorithm: RateLimitAlgorithm;
      keyBy: RateLimitKey;
      minimumRequestsPerWindow: number;
      windowSeconds: number;
      minimumDistinctKeys?: number;
      minimumReplicas?: number;
      requiredEdges?: TutorialEdgeRequirement[];
      forbiddenEdges?: TutorialEdgeRequirement[];
    }
  | {
      kind: "replicas";
      components: Array<{ componentId: string; minimum: number }>;
    }
  | { kind: "compile-ready" }
  | { kind: "simulation-checkpoint"; requestsPerSec: number };

export interface TutorialStep {
  id: string;
  title: string;
  prompt: string;
  why: string;
  tradeoff: string;
  hint?: string;
  detailedSteps?: TutorialGuidanceStep[];
  objective: TutorialObjective;
}

export interface TutorialGuidanceStep {
  instruction: string;
  target?:
    | { kind: "palette" | "node"; componentId: string }
    | { kind: "control"; id: string; componentId?: string; occurrence?: number; componentInstance?: number }
    | { kind: "edge"; sourceComponentId: string; targetComponentId: string };
  value?: string;
}

export interface TutorialLevel {
  id: TutorialLevelId;
  title: string;
  trafficLabel: string;
  requestsPerSec: number;
  goal: string;
  steps: TutorialStep[];
}

export interface SystemTutorial {
  problemId: string;
  learningObjectives: string[];
  levels: [TutorialLevel, TutorialLevel, TutorialLevel];
}

export interface TutorialSimulationProof {
  requestsPerSec: number;
  designSignature: string;
  timestamp: number;
}

export interface TutorialCheckResult {
  complete: boolean;
  feedback: string;
}
