"use client";

import { useSimulationStore } from "@/store/simulationStore";
import { useCanvasStore } from "@/store/canvasStore";
import { Activity, AlertTriangle } from "lucide-react";

const STATUS_COLOR: Record<string, string> = {
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-rose-500",
  idle: "bg-zinc-600",
};

/** Compact K/M/B abbreviation for large counts (Grafana-style). */
function abbrev(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n >= 1e9) return (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1) + "K";
  return String(Math.round(n));
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${Math.round(n)} B`;
}

export function MetricsDisplay() {
  const result = useSimulationStore((s) => s.result);
  const nodes = useCanvasStore((s) => s.nodes);

  if (!result || !(result.nodeMetrics instanceof Map)) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 border border-zinc-700">
          <Activity className="h-4 w-4 text-zinc-500" />
        </div>
        <div>
          <p className="text-xs font-medium text-zinc-300">No simulation data</p>
          <p className="mt-1 max-w-[200px] text-xs text-zinc-500">
            Configure load above and click <span className="text-cyan-500">Run Simulation</span> to see metrics
          </p>
        </div>
      </div>
    );
  }

  const sortedMetrics = [...result.nodeMetrics.values()].sort(
    (a, b) => b.utilization - a.utilization
  );

  return (
    <div className="space-y-3">
      {/* Summary — big tabular value, dimmed inline unit, muted uppercase label */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-zinc-800/70 px-3 py-2.5">
          <p className="metric-label text-[10px]">Throughput</p>
          <p className="metric-value mt-1 font-mono text-2xl font-semibold leading-none text-zinc-50">
            {abbrev(result.throughput)}
            <span className="ml-1 align-baseline text-xs font-normal text-zinc-500">req/s</span>
          </p>
        </div>
        <div className="rounded-lg bg-zinc-800/70 px-3 py-2.5">
          <p className="metric-label text-[10px]">Total Latency</p>
          <p className="metric-value mt-1 font-mono text-2xl font-semibold leading-none text-zinc-50">
            {result.totalLatencyMs.toFixed(0)}
            <span className="ml-1 align-baseline text-xs font-normal text-zinc-500">ms</span>
          </p>
          <p className="mt-1 text-[10px] text-zinc-500">longest path</p>
        </div>
        <div className="rounded-lg bg-zinc-800/70 px-3 py-2.5">
          <p className="metric-label text-[10px]">Failed operations</p>
          <p className="metric-value mt-1 font-mono text-2xl font-semibold leading-none text-rose-300">
            {abbrev(result.failedOperationsPerSec)}
            <span className="ml-1 align-baseline text-xs font-normal text-zinc-500">ops/s</span>
          </p>
          <p className="mt-1 text-[10px] text-zinc-500">after retries / capacity rejection</p>
        </div>
        <div className="rounded-lg bg-zinc-800/70 px-3 py-2.5">
          <p className="metric-label text-[10px]">Rejected requests</p>
          <p className="metric-value mt-1 font-mono text-2xl font-semibold leading-none text-amber-300">
            {abbrev(result.rejectedRequestsPerSec)}
            <span className="ml-1 align-baseline text-xs font-normal text-zinc-500">req/s</span>
          </p>
        </div>
      </div>

      {result.bottleneckNodes.length > 0 && (
        <div className="rounded-md border border-rose-500/20 bg-rose-950/30 px-2.5 py-2">
          <p className="text-xs font-medium text-rose-400">
            {result.bottleneckNodes.length} Bottleneck{result.bottleneckNodes.length > 1 ? "s" : ""} Detected
          </p>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-500/20 bg-amber-950/20 px-2.5 py-2">
          {result.warnings.map((warning, index) => (
            <p key={`${index}-${warning}`} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      )}

      {/* Per-node metrics */}
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Per-Node Metrics
      </p>

      {/* Plain overflow container: the base-ui ScrollArea viewport needs a
          definite height, so max-h on the root never actually scrolled. */}
      <div className="max-h-[300px] overflow-y-auto">
        <div className="space-y-1.5">
          {sortedMetrics.map((m) => {
            const node = nodes.find((n) => n.id === m.nodeId);
            const label = (node?.data as Record<string, unknown>)?.label as string ?? m.nodeId;
            return (
              <div
                key={m.nodeId}
                className="rounded-md bg-zinc-800 px-2.5 py-2"
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <div className={`h-1.5 w-1.5 rounded-full ${STATUS_COLOR[m.status]}`} />
                  <span className="text-xs font-medium text-zinc-300">
                    {label}
                  </span>
                  {m.isBottleneck && (
                    <span className="ml-auto text-[11px] font-medium text-rose-400" style={{ animation: 'status-pulse 2s infinite' }}>
                      BOTTLENECK
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <p className="metric-label text-[9px]">QPS</p>
                    <p className="font-mono text-xs tabular-nums text-zinc-200">
                      {abbrev(m.incomingQPS)}
                    </p>
                  </div>
                  <div>
                    <p className="metric-label text-[9px]">Util</p>
                    <div className="flex items-center gap-1">
                      <div className="h-1 w-8 overflow-hidden rounded-full bg-zinc-700">
                        <div
                          className={`h-full rounded-full ${
                            m.utilization > 0.8 ? "bg-rose-500" :
                            m.utilization > 0.5 ? "bg-amber-500" : "bg-emerald-500"
                          }`}
                          style={{ width: `${Math.min(m.utilization * 100, 100)}%` }}
                        />
                      </div>
                      <p className={`font-mono text-xs ${
                        m.utilization > 0.8 ? "text-rose-400" :
                        m.utilization > 0.5 ? "text-amber-400" : "text-emerald-400"
                      }`}>
                        {(m.utilization * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="metric-label text-[9px]">Latency</p>
                    <p className="font-mono text-xs tabular-nums text-zinc-200">
                      {m.latencyMs.toFixed(0)}ms
                    </p>
                  </div>
                  <div>
                    <p className="metric-label text-[9px]">Failed ops/s</p>
                    <p className={`font-mono text-xs tabular-nums ${(m.failedQPS ?? 0) > 0 ? "text-rose-300" : "text-zinc-200"}`}>
                      {abbrev(m.failedQPS ?? 0)}
                    </p>
                  </div>
                </div>
                {m.databaseReadWorkQPS !== undefined && (
                  <div className="mt-2 space-y-1 border-t border-zinc-700 pt-1.5">
                    <p className="text-[10px] font-medium text-cyan-300">Modeled database work</p>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-zinc-400">Read work</span>
                      <span className="font-mono tabular-nums text-zinc-200">{abbrev(m.databaseReadWorkQPS)} work/s</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-zinc-400">Write work</span>
                      <span className="font-mono tabular-nums text-zinc-200">{abbrev(m.databaseWriteWorkQPS ?? 0)} work/s</span>
                    </div>
                    <p className="text-[10px] leading-relaxed text-zinc-500">
                      Abstract modeled operations, including configured retry attempts and index cost; not a count of successful commits or physical I/O.
                    </p>
                  </div>
                )}
                {m.estimatedReadReplicaWorkCapacity !== undefined && (
                  <div className="mt-2 space-y-1 border-t border-zinc-700 pt-1.5">
                    {m.estimatedPrimaryDatabaseWorkQPS !== undefined && (
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-zinc-400">Estimated primary work / capacity</span>
                        <span className="font-mono tabular-nums text-zinc-200">
                          {abbrev(m.estimatedPrimaryDatabaseWorkQPS)} / {abbrev(m.estimatedPrimaryDatabaseWorkCapacity ?? 0)} work/s
                          {` · ${((m.estimatedPrimaryDatabaseUtilization ?? 0) * 100).toFixed(0)}%`}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-violet-300">Estimated copy read work / capacity</span>
                      <span className="font-mono tabular-nums text-zinc-200">
                        {abbrev(m.estimatedReadReplicaReadWorkQPS ?? m.databaseReadWorkQPS ?? 0)} / {abbrev(m.estimatedReadReplicaWorkCapacity)} work/s
                        {` · ${((m.estimatedReadReplicaUtilization ?? 0) * 100).toFixed(0)}%`}
                      </span>
                    </div>
                    <p className="text-[10px] leading-relaxed text-zinc-500">
                      Hypothetical work split and per-copy capacity comparison only. Actual requests remain on the simulated database path; replication overhead, freshness, and availability are not modeled. These estimates do not change actual DB utilization or throughput.
                    </p>
                  </div>
                )}
                {m.estimatedDatabasePartitionWork && m.estimatedDatabasePartitionWork.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-zinc-700 pt-1.5">
                    <p className="text-[10px] font-medium text-cyan-300">Estimated hash-shard work</p>
                    {m.estimatedDatabasePartitionWork.map((estimate) => (
                      <div key={estimate.tableName} className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="min-w-0 truncate text-zinc-400" title={estimate.tableName}>
                          {estimate.tableName}: hot {abbrev(estimate.estimatedHotShardWorkQPS)} / uniform {abbrev(estimate.estimatedUniformShardWorkQPS)} work/s
                        </span>
                        {estimate.estimatedHotShardUtilization !== undefined && (
                          <span className={`shrink-0 font-mono tabular-nums ${estimate.estimatedHotShardUtilization > 1 ? "text-amber-300" : "text-zinc-200"}`}>
                            {(estimate.estimatedHotShardUtilization * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    ))}
                    <p className="text-[10px] leading-relaxed text-zinc-500">
                      Directional table-work estimate from the configured hot-key share; this does not route queries or change aggregate database throughput.
                    </p>
                  </div>
                )}
                {(m.rejectedQPS ?? 0) > 0 && (
                  <p className="mt-1 text-[10px] text-amber-300">
                    {abbrev(m.rejectedQPS ?? 0)} requests/sec rejected
                  </p>
                )}
                {m.queueDepth !== undefined && (
                  <div className="mt-2 flex items-center justify-between border-t border-zinc-700 pt-1.5 text-[10px]">
                    <span className="text-zinc-500" title="Constant-rate projection from an empty backlog, not broker state or a time series.">Projected backlog</span>
                    <span className={`font-mono ${m.queueBacklogQPS && m.queueBacklogQPS > 0 ? "text-amber-300" : "text-zinc-300"}`}>
                      {abbrev(m.queueDepth)} messages
                      {m.queueBacklogQPS !== undefined && ` · +${abbrev(m.queueBacklogQPS)}/s`}
                    </span>
                  </div>
                )}
                {m.estimatedQueueTopicBacklog && m.estimatedQueueTopicBacklog.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-zinc-700 pt-1.5">
                    <p className="text-[10px] font-medium text-cyan-300">Projected backlog by topic</p>
                    {m.estimatedQueueTopicBacklog.map((estimate) => (
                      <div key={estimate.topicName} className="space-y-0.5 text-[10px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-zinc-400" title={estimate.topicName}>{estimate.topicName}</span>
                          <span className={`shrink-0 font-mono tabular-nums ${estimate.estimatedBacklogGrowthPerSec > 0 ? "text-amber-300" : "text-zinc-200"}`}>
                            +{abbrev(estimate.estimatedBacklogGrowthPerSec)}/s · {abbrev(estimate.estimatedBacklogDepth)} messages
                          </span>
                        </div>
                        <p className="text-zinc-500">
                          {abbrev(estimate.acceptedMessagesPerSec)} accepted/s · {abbrev(estimate.estimatedProcessedMessagesPerSec)} estimated processed/s
                          {estimate.estimatedBacklogPayloadBytes !== undefined && ` · ${formatBytes(estimate.estimatedBacklogPayloadBytes)} logical payload`}
                        </p>
                        {estimate.estimatedDeliveryAttemptsPerSec !== undefined && (
                          <p className="text-violet-300">
                            Retry estimate: {abbrev(estimate.estimatedRetryAttemptsPerSec ?? 0)} retry attempts/s · {abbrev(estimate.estimatedSuccessfulDeliveriesPerSec ?? 0)} successful/s · {abbrev(estimate.estimatedExhaustedDeliveriesPerSec ?? 0)} exhausted/s
                            {estimate.estimatedRetryWaitMsPerDelivery !== undefined && ` · ${estimate.estimatedRetryWaitMsPerDelivery.toFixed(1)} ms expected retry wait/delivery`}
                          </p>
                        )}
                      </div>
                    ))}
                    <p className="text-[10px] leading-relaxed text-zinc-500">
                      Constant-rate projection from an empty backlog for configured topics only; payload uses the assumed average message size and excludes broker overhead. Retry figures assume independent, constant per-attempt failures; any wait estimate assumes the same fixed delay per retry. Retry work does not feed capacity/backlog, exhausted messages are not routed to a DLQ, and acknowledgments, offsets, retry schedules, ordering, duplicate effects, consumer lag, and broker state are not modeled. No delivery guarantee is implied.
                    </p>
                  </div>
                )}
                {m.estimatedQueueTopicStorage && m.estimatedQueueTopicStorage.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-zinc-700 pt-1.5">
                    <p className="text-[10px] font-medium text-cyan-300">Estimated retained payload</p>
                    {m.estimatedQueueTopicStorage.map((estimate) => (
                      <div key={estimate.topicName} className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="min-w-0 truncate text-zinc-400" title={estimate.topicName}>
                          {estimate.topicName} · {abbrev(estimate.acceptedMessagesPerSec)}/s × {abbrev(estimate.estimatedAverageMessageSizeBytes)} B × {estimate.retentionHours}h
                        </span>
                        <span className="shrink-0 font-mono tabular-nums text-zinc-200">
                          {formatBytes(estimate.estimatedRetainedPayloadBytes)}
                        </span>
                      </div>
                    ))}
                    <p className="text-[10px] leading-relaxed text-zinc-500">
                      Constant accepted-rate payload estimate only; excludes replicas, compression, indexes, metadata, and segment overhead. No broker storage is simulated.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
