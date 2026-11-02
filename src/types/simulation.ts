export type NodeStatus = "healthy" | "warning" | "critical" | "idle";

export interface QueueTopicStorageEstimate {
  topicName: string;
  acceptedMessagesPerSec: number;
  estimatedAverageMessageSizeBytes: number;
  retentionHours: number;
  estimatedRetainedPayloadBytes: number;
}

export interface QueueTopicBacklogEstimate {
  topicName: string;
  acceptedMessagesPerSec: number;
  estimatedProcessedMessagesPerSec: number;
  estimatedBacklogGrowthPerSec: number;
  estimatedBacklogDepth: number;
  estimatedBacklogPayloadBytes?: number;
  estimatedDeliveryAttemptsPerSec?: number;
  estimatedRetryAttemptsPerSec?: number;
  estimatedSuccessfulDeliveriesPerSec?: number;
  estimatedExhaustedDeliveriesPerSec?: number;
  estimatedRetryWaitMsPerDelivery?: number;
}

export interface DatabasePartitionWorkEstimate {
  tableName: string;
  modeledReadWorkQPS: number;
  modeledWriteWorkQPS: number;
  estimatedHotShardWorkQPS: number;
  estimatedUniformShardWorkQPS: number;
  estimatedHotShardUtilization?: number;
}

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
  databaseReadWorkQPS?: number;
  databaseWriteWorkQPS?: number;
  /** Estimated primary reads plus writes under a configured hypothetical read-copy share. */
  estimatedPrimaryDatabaseWorkQPS?: number;
  estimatedPrimaryDatabaseWorkCapacity?: number;
  /** Estimated primary work divided by one database copy's configured QPS; estimate only. */
  estimatedPrimaryDatabaseUtilization?: number;
  /** Estimated modeled read work assigned to the extra copies; this does not route traffic. */
  estimatedReadReplicaReadWorkQPS?: number;
  estimatedReadReplicaWorkCapacity?: number;
  estimatedReadReplicaUtilization?: number;
  estimatedQueueTopicStorage?: QueueTopicStorageEstimate[];
  estimatedQueueTopicBacklog?: QueueTopicBacklogEstimate[];
  estimatedDatabasePartitionWork?: DatabasePartitionWorkEstimate[];
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
