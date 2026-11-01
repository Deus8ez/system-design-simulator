"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useCanvasStore, type ComponentNodeData } from "@/store/canvasStore";
import type {
  CacheConfiguration,
  DatabaseColumn,
  DatabaseIndex,
  DatabaseTable,
  EndpointDefinition,
  EndpointFieldDefinition,
  EndpointLogicKind,
  EndpointMethod,
  GatewayRouteDefinition,
  QueueConsumerSubscription,
  QueueConfiguration,
  QueueTopicDefinition,
  RateLimitAlgorithm,
  RateLimitKey,
  RateLimiterConfiguration,
} from "@/types/component";

const METHODS: EndpointMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const LOGIC_STEPS: { value: EndpointLogicKind; label: string }[] = [
  { value: "authenticate", label: "Authenticate" },
  { value: "validate", label: "Validate request" },
  { value: "cache-read", label: "Read cache" },
  { value: "database-read", label: "Read database" },
  { value: "database-write", label: "Write database" },
  { value: "cache-invalidate", label: "Invalidate cache" },
  { value: "publish-event", label: "Publish event" },
  { value: "route", label: "Route to service" },
  { value: "respond", label: "Return response" },
];
const TARGET_REQUIRED = new Set<EndpointLogicKind>([
  "cache-read",
  "database-read",
  "database-write",
  "cache-invalidate",
  "publish-event",
  "route",
]);
const CONDITION_SUPPORTED = new Set<EndpointLogicKind>(["validate", "route"]);
const RETRYABLE_KINDS = new Set<EndpointLogicKind>([
  "cache-read",
  "database-read",
  "database-write",
  "publish-event",
  "route",
]);

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function inputClass(disabled: boolean): string {
  return `min-w-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-600 disabled:cursor-not-allowed disabled:opacity-50 ${disabled ? "cursor-not-allowed opacity-50" : ""}`;
}

function updateEndpoint(
  endpoints: EndpointDefinition[],
  endpointId: string,
  change: (endpoint: EndpointDefinition) => EndpointDefinition
): EndpointDefinition[] {
  return endpoints.map((endpoint) => endpoint.id === endpointId ? change(endpoint) : endpoint);
}

function EndpointFieldsEditor({
  title,
  fields,
  request = false,
  disabled,
  onChange,
}: {
  title: string;
  fields: EndpointFieldDefinition[];
  request?: boolean;
  disabled: boolean;
  onChange: (fields: EndpointFieldDefinition[]) => void;
}) {
  return (
    <div className="space-y-1.5 rounded border border-zinc-700/70 bg-zinc-950/40 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-zinc-400">{title}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...fields, {
            id: id("field"),
            name: "",
            type: "string",
            ...(request ? { location: "body" as const } : {}),
          }])}
          className="inline-flex items-center gap-1 text-[10px] text-cyan-400 disabled:opacity-50"
        ><Plus className="h-3 w-3" /> Add field</button>
      </div>
      {fields.map((field, index) => (
        <div key={field.id} className={`grid ${request ? "grid-cols-[minmax(0,1fr)_70px_72px_auto]" : "grid-cols-[minmax(0,1fr)_72px_auto]"} gap-1`}>
          <input
            aria-label={`${title} field ${index + 1} name`}
            disabled={disabled}
            value={field.name}
            onChange={(event) => onChange(fields.map((item) => item.id === field.id ? { ...item, name: event.target.value } : item))}
            placeholder="fieldName"
            className={inputClass(disabled)}
          />
          <select
            aria-label={`${title} field ${index + 1} type`}
            disabled={disabled}
            value={field.type}
            onChange={(event) => onChange(fields.map((item) => item.id === field.id
              ? { ...item, type: event.target.value as EndpointFieldDefinition["type"] }
              : item))}
            className={inputClass(disabled)}
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
          </select>
          {request && (
            <select
              aria-label={`Request field ${index + 1} location`}
              disabled={disabled}
              value={field.location ?? "body"}
              onChange={(event) => onChange(fields.map((item) => item.id === field.id
                ? { ...item, location: event.target.value as EndpointFieldDefinition["location"] }
                : item))}
              className={inputClass(disabled)}
            >
              <option value="path">path</option>
              <option value="query">query</option>
              <option value="body">body</option>
            </select>
          )}
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove ${title.toLowerCase()} field`}
            onClick={() => onChange(fields.filter((item) => item.id !== field.id))}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-rose-400 disabled:opacity-50"
          ><Trash2 className="h-3 w-3" /></button>
        </div>
      ))}
    </div>
  );
}

export function RuntimeModelEditor({
  nodeId,
  data,
  disabled = false,
}: {
  nodeId: string;
  data: ComponentNodeData;
  disabled?: boolean;
}) {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const endpoints = (data.endpoints ?? []) as EndpointDefinition[];
  const tables = (data.tables ?? []) as DatabaseTable[];
  const [showDdl, setShowDdl] = useState(false);
  const downstreamIds = new Set(edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target));
  const downstreamTargets = nodes.filter((node) => downstreamIds.has(node.id) && node.type !== "text");

  const saveEndpoints = (next: EndpointDefinition[]) => updateNodeData(nodeId, { endpoints: next });
  const saveRoutes = (next: GatewayRouteDefinition[]) => updateNodeData(nodeId, { routes: next });
  const cacheConfig = (data.cacheConfig ?? {}) as CacheConfiguration;
  const saveCacheConfig = (next: CacheConfiguration) => updateNodeData(nodeId, { cacheConfig: next });
  const queueConfig = (data.queueConfig ?? { topics: [] }) as QueueConfiguration;
  const subscriptions = Array.isArray(queueConfig.subscriptions) ? queueConfig.subscriptions : [];
  const saveQueueConfig = (next: QueueConfiguration) => updateNodeData(nodeId, { queueConfig: next });
  const saveTables = (next: DatabaseTable[]) => updateNodeData(nodeId, { tables: next });

  if (data.componentId === "rate-limiter") {
    const config = data.rateLimiterConfig as RateLimiterConfiguration | undefined;
    const saveConfig = (next: RateLimiterConfiguration) => updateNodeData(nodeId, { rateLimiterConfig: next });
    const configureDefaults = () => saveConfig({
      algorithm: "token-bucket",
      keyBy: "global",
      requestsPerWindow: 50_000,
      windowSeconds: 1,
      estimatedDistinctKeys: 1,
      burstCapacity: 10_000,
    });

    return (
      <section className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/70 p-3">
        <div>
          <h3 className="text-xs font-semibold text-zinc-200">Rate limit policy</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">Configure a sustained request quota and the key used to group traffic.</p>
        </div>
        {!config ? (
          <div className="space-y-2 rounded bg-zinc-800/70 p-2">
            <p className="text-[11px] text-zinc-400">No policy configured. Until one is applied, this component uses its ordinary QPS capacity only.</p>
            <button
              type="button"
              disabled={disabled}
              onClick={configureDefaults}
              className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-cyan-400 hover:bg-zinc-800 disabled:opacity-50"
            >Configure defaults</button>
          </div>
        ) : (
          <>
            <label className="block space-y-1 text-[11px] text-zinc-400">
              Algorithm
              <select
                aria-label="Rate limiter algorithm"
                disabled={disabled}
                value={config.algorithm ?? ""}
                onChange={(event) => saveConfig({ ...config, algorithm: event.target.value as RateLimitAlgorithm })}
                className={`${inputClass(disabled)} w-full`}
              >
                <option value="">Select an algorithm</option>
                <option value="token-bucket">Token bucket</option>
                <option value="sliding-window">Sliding window counter</option>
              </select>
            </label>
            <label className="block space-y-1 text-[11px] text-zinc-400">
              Limit key
              <select
                aria-label="Rate limiter key"
                disabled={disabled}
                value={config.keyBy ?? ""}
                onChange={(event) => saveConfig({ ...config, keyBy: event.target.value as RateLimitKey })}
                className={`${inputClass(disabled)} w-full`}
              >
                <option value="">Select a key</option>
                <option value="global">Global</option>
                <option value="client-id">Client ID</option>
                <option value="ip">IP address</option>
                <option value="api-key">API key</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1 text-[11px] text-zinc-400">
                Requests per window
                <input
                  aria-label="Rate limit requests per window"
                  type="number"
                  min="1"
                  step="1"
                  disabled={disabled}
                  value={config.requestsPerWindow ?? ""}
                  onChange={(event) => saveConfig({ ...config, requestsPerWindow: event.target.value === "" ? undefined : Number(event.target.value) })}
                  className={`${inputClass(disabled)} w-full`}
                />
              </label>
              <label className="block space-y-1 text-[11px] text-zinc-400">
                Window (seconds)
                <input
                  aria-label="Rate limit window seconds"
                  type="number"
                  min="0.01"
                  step="1"
                  disabled={disabled}
                  value={config.windowSeconds ?? ""}
                  onChange={(event) => saveConfig({ ...config, windowSeconds: event.target.value === "" ? undefined : Number(event.target.value) })}
                  className={`${inputClass(disabled)} w-full`}
                />
              </label>
            </div>
            {config.keyBy !== "global" && (
              <label className="block space-y-1 text-[11px] text-zinc-400">
                Estimated distinct keys
                <input
                  aria-label="Rate limit estimated distinct keys"
                  type="number"
                  min="1"
                  step="1"
                  disabled={disabled}
                  value={config.estimatedDistinctKeys ?? ""}
                  onChange={(event) => saveConfig({ ...config, estimatedDistinctKeys: event.target.value === "" ? undefined : Number(event.target.value) })}
                  className={`${inputClass(disabled)} w-full`}
                />
              </label>
            )}
            {config.algorithm === "token-bucket" && (
              <label className="block space-y-1 text-[11px] text-zinc-400">
                Burst capacity (tokens)
                <input
                  aria-label="Rate limiter burst capacity"
                  type="number"
                  min="1"
                  step="1"
                  disabled={disabled}
                  value={config.burstCapacity ?? ""}
                  onChange={(event) => saveConfig({ ...config, burstCapacity: event.target.value === "" ? undefined : Number(event.target.value) })}
                  className={`${inputClass(disabled)} w-full`}
                />
              </label>
            )}
            <p className="rounded bg-zinc-800/70 p-2 text-[10px] leading-relaxed text-zinc-400">
              Simulation applies the sustained aggregate quota ({config.keyBy === "global" ? "one global key" : "per-key quota × estimated distinct keys"}). It does not model token refill timing, window boundaries, distributed counter consistency, or transient bursts.
            </p>
          </>
        )}
      </section>
    );
  }

  if (data.componentId === "api-gateway") {
    const routes = (data.routes ?? []) as GatewayRouteDefinition[];
    const backends = downstreamTargets.filter((node) => {
      const targetData = node.data as ComponentNodeData;
      return targetData.componentId === "app-server";
    });

    return (
      <section className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-zinc-200">Gateway routes</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">Exact method + path mapping to a connected App Server endpoint.</p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => saveRoutes([...routes, { id: id("gateway-route"), method: "GET", path: "/new" }])}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-cyan-400 hover:bg-zinc-800 disabled:opacity-50"
          ><Plus className="h-3 w-3" /> Add route</button>
        </div>

        {routes.length === 0 && (
          <p className="rounded bg-zinc-800/70 p-2 text-[11px] text-zinc-500">No routes configured. Add a route for each App Server endpoint exposed through this gateway.</p>
        )}

        {routes.map((route, routeIndex) => (
          <div key={route.id} className="space-y-2 rounded-md border border-zinc-700/80 bg-zinc-800/50 p-2">
            <div className="flex gap-1.5">
              <select
                aria-label={`Gateway route ${routeIndex + 1} method`}
                disabled={disabled}
                value={route.method}
                onChange={(event) => saveRoutes(routes.map((item) => item.id === route.id
                  ? { ...item, method: event.target.value as EndpointMethod }
                  : item))}
                className={`${inputClass(disabled)} w-[82px] shrink-0`}
              >
                {METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
              </select>
              <input
                aria-label={`Gateway route ${routeIndex + 1} path`}
                disabled={disabled}
                value={route.path}
                onChange={(event) => saveRoutes(routes.map((item) => item.id === route.id
                  ? { ...item, path: event.target.value }
                  : item))}
                placeholder="/urls or /:code"
                className={`${inputClass(disabled)} min-w-0 flex-1`}
              />
              <button
                type="button"
                disabled={disabled}
                aria-label="Remove gateway route"
                onClick={() => saveRoutes(routes.filter((item) => item.id !== route.id))}
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-rose-400 disabled:opacity-50"
              ><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <select
              aria-label={`Gateway route ${routeIndex + 1} backend`}
              disabled={disabled || backends.length === 0}
              value={route.backendNodeId ?? ""}
              onChange={(event) => saveRoutes(routes.map((item) => item.id === route.id
                ? { ...item, backendNodeId: event.target.value || undefined }
                : item))}
              className={`${inputClass(disabled)} w-full`}
            >
              <option value="">Choose connected App Server</option>
              {backends.map((backend) => {
                const backendData = backend.data as ComponentNodeData;
                return <option key={backend.id} value={backend.id}>{backendData.label} · {backend.id.slice(0, 8)}</option>;
              })}
            </select>
            <label className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
              Relative traffic share
              <input
                aria-label={`Gateway route ${routeIndex + 1} traffic share`}
                type="number"
                min="0.01"
                step="0.1"
                disabled={disabled}
                value={route.trafficWeight ?? 1}
                onChange={(event) => saveRoutes(routes.map((item) => item.id === route.id
                  ? { ...item, trafficWeight: Number(event.target.value) || 0 }
                  : item))}
                className={`${inputClass(disabled)} w-20 text-right`}
              />
            </label>
          </div>
        ))}
        <p className="text-[10px] leading-relaxed text-zinc-500">Routes use exact method/path matching at compile time. Traffic share distributes modeled load across distinct backend services; service endpoint weights split traffic within each App Server.</p>
      </section>
    );
  }

  if (data.componentId === "app-server") {
    return (
      <section className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-zinc-200">Service endpoints</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">Build an ordered request pipeline with weighted routes and retry policies.</p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => saveEndpoints([...endpoints, { id: id("endpoint"), method: "GET", path: "/new", steps: [] }])}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-cyan-400 hover:bg-zinc-800 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" /> Add route
          </button>
        </div>

        {endpoints.length === 0 && <p className="rounded bg-zinc-800/70 p-2 text-[11px] text-zinc-500">No endpoints yet. Add a route, then define its request steps.</p>}

        {endpoints.map((endpoint, endpointIndex) => (
          <div key={endpoint.id} className="space-y-2 rounded-md border border-zinc-700/80 bg-zinc-800/50 p-2">
            <div className="flex gap-1.5">
              <select
                aria-label={`Endpoint ${endpointIndex + 1} method`}
                disabled={disabled}
                value={endpoint.method}
                onChange={(event) => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({ ...current, method: event.target.value as EndpointMethod })))}
                className={`${inputClass(disabled)} w-[82px] shrink-0`}
              >
                {METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
              </select>
              <input
                aria-label={`Endpoint ${endpointIndex + 1} path`}
                disabled={disabled}
                value={endpoint.path}
                onChange={(event) => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({ ...current, path: event.target.value })))}
                placeholder="/users/:id"
                className={`${inputClass(disabled)} flex-1`}
              />
              <button
                type="button"
                disabled={disabled}
                aria-label="Remove endpoint"
                onClick={() => saveEndpoints(endpoints.filter((item) => item.id !== endpoint.id))}
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-rose-400 disabled:opacity-50"
              ><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <label className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
              Traffic weight
              <input
                aria-label={`Endpoint ${endpointIndex + 1} traffic weight`}
                type="number"
                min="0.01"
                step="0.1"
                disabled={disabled}
                value={endpoint.trafficWeight ?? 1}
                onChange={(event) => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({
                  ...current,
                  trafficWeight: Math.max(0.01, Number(event.target.value) || 0.01),
                })))}
                className={`${inputClass(disabled)} w-20 text-right`}
              />
            </label>

            <div className="space-y-1 text-[10px] text-zinc-500">
              <p>Optional request contract. Declared fields are checked against validation and route conditions; response fields are documentation-only.</p>
              <EndpointFieldsEditor
                title="Request fields"
                fields={endpoint.requestFields ?? []}
                request
                disabled={disabled}
                onChange={(requestFields) => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({ ...current, requestFields })))}
              />
              <EndpointFieldsEditor
                title="Response fields"
                fields={endpoint.responseFields ?? []}
                disabled={disabled}
                onChange={(responseFields) => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({ ...current, responseFields })))}
              />
            </div>

            <div className="space-y-1.5">
              {endpoint.steps.map((step, stepIndex) => (
                <div key={step.id} className="relative ml-2 border-l border-cyan-700/50 pb-1 pl-2.5 last:border-l-transparent">
                  <span className="absolute -left-[4px] top-2 h-1.5 w-1.5 rounded-full bg-cyan-500" />
                  <div className="flex gap-1.5">
                    <select
                      aria-label={`Pipeline step ${stepIndex + 1}`}
                      disabled={disabled}
                      value={step.kind}
                      onChange={(event) => {
                        const kind = event.target.value as EndpointLogicKind;
                        saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({
                          ...current,
                          steps: current.steps.map((item) => item.id === step.id ? { ...item, kind } : item),
                        })));
                      }}
                      className={`${inputClass(disabled)} min-w-0 flex-1`}
                    >
                      {LOGIC_STEPS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                    <button
                      type="button"
                      disabled={disabled || stepIndex === 0}
                      aria-label="Move step up"
                      onClick={() => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => {
                        const steps = [...current.steps];
                        [steps[stepIndex - 1], steps[stepIndex]] = [steps[stepIndex], steps[stepIndex - 1]];
                        return { ...current, steps };
                      }))}
                      className="rounded px-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-30"
                    ><ChevronUp className="h-3 w-3" /></button>
                    <button
                      type="button"
                      disabled={disabled || stepIndex === endpoint.steps.length - 1}
                      aria-label="Move step down"
                      onClick={() => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => {
                        const steps = [...current.steps];
                        [steps[stepIndex], steps[stepIndex + 1]] = [steps[stepIndex + 1], steps[stepIndex]];
                        return { ...current, steps };
                      }))}
                      className="rounded px-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-30"
                    ><ChevronDown className="h-3 w-3" /></button>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label="Remove pipeline step"
                      onClick={() => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({
                        ...current,
                        steps: current.steps.filter((item) => item.id !== step.id),
                      })))}
                      className="rounded px-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-rose-400 disabled:opacity-50"
                    ><Trash2 className="h-3 w-3" /></button>
                  </div>
                  {TARGET_REQUIRED.has(step.kind) && (
                    <>
                      <input
                        aria-label={`${step.kind} resource`}
                        disabled={disabled}
                        value={step.target ?? ""}
                        onChange={(event) => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({
                          ...current,
                          steps: current.steps.map((item) => item.id === step.id ? { ...item, target: event.target.value } : item),
                        })))}
                        placeholder={step.kind.startsWith("database-") ? "table.column[,column...]" : step.kind.startsWith("cache-") ? "Cache key pattern" : "Topic or service target"}
                        className={`${inputClass(disabled)} mt-1 w-full`}
                      />
                      <select
                        aria-label={`${step.kind} downstream component`}
                        disabled={disabled || downstreamTargets.length === 0}
                        value={step.targetNodeId ?? ""}
                        onChange={(event) => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({
                          ...current,
                          steps: current.steps.map((item) => item.id === step.id ? { ...item, targetNodeId: event.target.value || undefined } : item),
                        })))}
                        className={`${inputClass(disabled)} mt-1 w-full`}
                      >
                        <option value="">Choose connected component</option>
                        {downstreamTargets
                          .filter((targetNode) => {
                            const targetData = targetNode.data as ComponentNodeData;
                            if (step.kind.startsWith("cache-")) return targetData.componentId === "cache";
                            if (step.kind.startsWith("database-")) return ["sql-db", "nosql-db"].includes(targetData.componentId);
                            if (step.kind === "publish-event") return ["message-queue", "pub-sub"].includes(targetData.componentId);
                            return targetData.category === "compute";
                          })
                          .map((targetNode) => {
                            const targetData = targetNode.data as ComponentNodeData;
                            return <option key={targetNode.id} value={targetNode.id}>{targetData.label} · {targetNode.id.slice(0, 8)}</option>;
                          })}
                      </select>
                      <p className="mt-0.5 text-[10px] text-zinc-500">Only wired downstream components are eligible targets.</p>
                    </>
                  )}
                  {step.kind === "cache-read" && (
                    <label className="mt-1 flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                      Cache hit rate
                      <span className="flex items-center gap-1">
                        <input
                          aria-label="Cache hit rate percent"
                          type="number"
                          min="0"
                          max="100"
                          disabled={disabled}
                          value={Math.round((step.cacheHitRate ?? 0.9) * 100)}
                          onChange={(event) => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({
                            ...current,
                            steps: current.steps.map((item) => item.id === step.id ? {
                              ...item,
                              cacheHitRate: Math.min(100, Math.max(0, Number(event.target.value) || 0)) / 100,
                            } : item),
                          })))}
                          className={`${inputClass(disabled)} w-16 text-right`}
                        />%
                      </span>
                    </label>
                  )}
                  {CONDITION_SUPPORTED.has(step.kind) && (
                    <input
                      aria-label={`${step.kind} condition`}
                      disabled={disabled}
                      value={step.condition ?? ""}
                      onChange={(event) => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({
                        ...current,
                        steps: current.steps.map((item) => item.id === step.id ? { ...item, condition: event.target.value } : item),
                      })))}
                      placeholder={step.kind === "route" ? "Condition, e.g. region == 'eu'" : "Validation predicate, e.g. email != ''"}
                      className={`${inputClass(disabled)} mt-1 w-full`}
                    />
                  )}
                  {step.kind === "route" && (
                    <>
                      <label className="mt-1 flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                        Matched traffic share
                        <span className="flex items-center gap-1">
                          <input
                            aria-label="Route matched traffic percentage"
                            type="number"
                            min="0"
                            max="100"
                            disabled={disabled}
                            value={Math.round((step.matchRate ?? 1) * 100)}
                            onChange={(event) => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({
                              ...current,
                              steps: current.steps.map((item) => item.id === step.id ? {
                                ...item,
                                matchRate: Math.min(100, Math.max(0, Number(event.target.value) || 0)) / 100,
                              } : item),
                            })))}
                            className={`${inputClass(disabled)} w-16 text-right`}
                          />%
                        </span>
                      </label>
                      <p className="mt-0.5 text-[10px] text-zinc-500">Compound conditions are evaluated per cohort; unsupported expressions fall back to this match share. Unmatched traffic continues to the next route.</p>
                    </>
                  )}
                  {RETRYABLE_KINDS.has(step.kind) && (
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <label className="space-y-1 text-[10px] text-zinc-400">
                        Max retries
                        <input
                          aria-label="Maximum retries"
                          type="number"
                          min="0"
                          max="5"
                          disabled={disabled}
                          value={step.retryAttempts ?? 0}
                          onChange={(event) => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({
                            ...current,
                            steps: current.steps.map((item) => item.id === step.id ? {
                              ...item,
                              retryAttempts: Math.min(5, Math.max(0, Math.floor(Number(event.target.value) || 0))),
                            } : item),
                          })))}
                          className={`${inputClass(disabled)} w-full`}
                        />
                      </label>
                      <label className="space-y-1 text-[10px] text-zinc-400">
                        Failure rate (%)
                        <input
                          aria-label="Per-attempt failure rate percent"
                          type="number"
                          min="0"
                          max="100"
                          disabled={disabled}
                          value={Math.round((step.retryFailureRate ?? 0) * 100)}
                          onChange={(event) => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({
                            ...current,
                            steps: current.steps.map((item) => item.id === step.id ? {
                              ...item,
                              retryFailureRate: Math.min(100, Math.max(0, Number(event.target.value) || 0)) / 100,
                            } : item),
                          })))}
                          className={`${inputClass(disabled)} w-full`}
                        />
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              disabled={disabled}
              onClick={() => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({
                ...current,
                steps: [...current.steps, { id: id("step"), kind: "validate" }],
              })))}
              className="inline-flex items-center gap-1 px-1 text-[11px] text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
            ><Plus className="h-3 w-3" /> Add logic step</button>
          </div>
        ))}
      </section>
    );
  }

  if (data.componentId === "sql-db" || data.componentId === "nosql-db") {
    const isSqlDatabase = data.componentId === "sql-db";
    return (
      <section className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-zinc-200">
              {isSqlDatabase ? "Relational schema" : "Collection schema"}
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {isSqlDatabase
                ? "At 1,000 rows, scans cost 5 work units and indexed reads 1; costs scale with table size and leading index columns."
                : "Define document fields and lookup indexes for the collection. Indexed reads reduce modeled lookup work as the collection grows."}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => saveTables([...tables, {
              id: id("table"),
              name: `${isSqlDatabase ? "table" : "collection"}_${tables.length + 1}`,
              estimatedRows: 1000,
              columns: [{ id: id("column"), name: "id", dataType: "UUID", nullable: false, primaryKey: true }],
              indexes: [],
            }])}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-cyan-400 hover:bg-zinc-800 disabled:opacity-50"
          ><Plus className="h-3 w-3" /> {isSqlDatabase ? "Add table" : "Add collection"}</button>
        </div>

        {tables.length === 0 && (
          <p className="rounded bg-zinc-800/70 p-2 text-[11px] text-zinc-500">
            {isSqlDatabase
              ? "No tables yet. Add a table and define its access keys."
              : "No collections yet. Add a collection and define its fields and lookup indexes."}
          </p>
        )}

        {tables.map((table, tableIndex) => (
          <div key={table.id} className="space-y-2 rounded-md border border-zinc-700/80 bg-zinc-800/50 p-2">
            <div className="flex gap-1.5">
              <input
                aria-label={`Table ${tableIndex + 1} name`}
                disabled={disabled}
                value={table.name}
                onChange={(event) => saveTables(tables.map((item) => item.id === table.id ? { ...item, name: event.target.value } : item))}
                className={`${inputClass(disabled)} flex-1 font-mono`}
              />
              <button
                type="button"
                disabled={disabled}
                aria-label="Remove table"
                onClick={() => saveTables(tables.filter((item) => item.id !== table.id))}
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-rose-400 disabled:opacity-50"
              ><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <label className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
              Estimated rows
              <input
                aria-label={`Table ${tableIndex + 1} estimated row count`}
                type="number"
                min="1"
                max="1000000000000"
                step="1000"
                disabled={disabled}
                value={table.estimatedRows ?? 1000}
                onChange={(event) => saveTables(tables.map((item) => item.id === table.id ? {
                  ...item,
                  estimatedRows: Math.min(1_000_000_000_000, Math.max(1, Math.floor(Number(event.target.value) || 1))),
                } : item))}
                className={`${inputClass(disabled)} w-32 text-right font-mono`}
              />
            </label>

            <div className="space-y-1.5">
              {table.columns.map((column, columnIndex) => (
                <ColumnEditor
                  key={column.id}
                  column={column}
                  disabled={disabled}
                  onChange={(next) => updateTableColumn(tables, table, column.id, next, saveTables)}
                  onDelete={() => saveTables(tables.map((item) => item.id === table.id ? {
                    ...item,
                    columns: item.columns.filter((current) => current.id !== column.id),
                    indexes: item.indexes
                      .map((index) => ({ ...index, columns: index.columns.filter((name) => name !== column.name) }))
                      .filter((index) => index.columns.length > 0),
                  } : item))}
                  label={`Column ${columnIndex + 1}`}
                />
              ))}
            </div>

            <button
              type="button"
              disabled={disabled}
              onClick={() => saveTables(tables.map((item) => item.id === table.id ? {
                ...item,
                columns: [...item.columns, { id: id("column"), name: `column_${item.columns.length + 1}`, dataType: "TEXT", nullable: true, primaryKey: false }],
              } : item))}
              className="inline-flex items-center gap-1 px-1 text-[11px] text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
            ><Plus className="h-3 w-3" /> Add column</button>

            <div className="space-y-1.5 border-t border-zinc-700 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-zinc-400">Indexes</span>
                <button
                  type="button"
                  disabled={disabled || table.columns.length === 0}
                  onClick={() => {
                    const firstColumn = table.columns[0]?.name;
                    if (!firstColumn) return;
                    const index: DatabaseIndex = {
                      id: id("index"),
                      name: `idx_${table.name}_${firstColumn}`,
                      columns: [firstColumn],
                      unique: false,
                    };
                    saveTables(tables.map((item) => item.id === table.id ? { ...item, indexes: [...item.indexes, index] } : item));
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-cyan-400 disabled:opacity-50"
                ><Plus className="h-3 w-3" /> Add index</button>
              </div>
              {table.indexes.map((index, indexNumber) => (
                <IndexEditor
                  key={`${index.id}-${index.columns.join(",")}`}
                  index={index}
                  indexNumber={indexNumber}
                  columns={table.columns}
                  disabled={disabled}
                  onChange={(next) => saveTables(tables.map((item) => item.id === table.id ? {
                    ...item,
                    indexes: item.indexes.map((current) => current.id === index.id ? next : current),
                  } : item))}
                  onDelete={() => saveTables(tables.map((item) => item.id === table.id ? { ...item, indexes: item.indexes.filter((current) => current.id !== index.id) } : item))}
                />
              ))}
            </div>
          </div>
        ))}

        {isSqlDatabase && tables.length > 0 && (
          <div className="space-y-2 border-t border-zinc-700 pt-2">
            <button
              type="button"
              onClick={() => setShowDdl((current) => !current)}
              className="text-[11px] font-medium text-cyan-400 hover:text-cyan-300"
            >{showDdl ? "Hide SQL DDL" : "Preview SQL DDL"}</button>
            {showDdl && (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-[10px] leading-relaxed text-zinc-300">
                {buildSqlDdl(tables)}
              </pre>
            )}
          </div>
        )}
      </section>
    );
  }

  if (data.componentId === "cache") {
    return (
      <section className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/70 p-3">
        <div>
          <h3 className="text-xs font-semibold text-zinc-200">Redis configuration</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">Document settings and catch invalid values before running.</p>
        </div>
        <label className="block space-y-1 text-[11px] text-zinc-400">
          Maximum memory (MB)
          <input
            aria-label="Redis maximum memory in MB"
            type="number"
            min="0.01"
            step="1"
            disabled={disabled}
            value={cacheConfig.maxMemoryMB ?? ""}
            onChange={(event) => saveCacheConfig({
              ...cacheConfig,
              maxMemoryMB: event.target.value === "" ? undefined : Number(event.target.value),
            })}
            placeholder="e.g. 4096"
            className={`${inputClass(disabled)} w-full`}
          />
        </label>
        <label className="block space-y-1 text-[11px] text-zinc-400">
          Default TTL (seconds; 0 means no expiration)
          <input
            aria-label="Redis default TTL in seconds"
            type="number"
            min="0"
            step="1"
            disabled={disabled}
            value={cacheConfig.defaultTtlSeconds ?? ""}
            onChange={(event) => saveCacheConfig({
              ...cacheConfig,
              defaultTtlSeconds: event.target.value === "" ? undefined : Number(event.target.value),
            })}
            placeholder="e.g. 3600"
            className={`${inputClass(disabled)} w-full`}
          />
        </label>
        <label className="block space-y-1 text-[11px] text-zinc-400">
          Eviction policy
          <select
            aria-label="Redis eviction policy"
            disabled={disabled}
            value={cacheConfig.evictionPolicy ?? ""}
            onChange={(event) => saveCacheConfig({
              ...cacheConfig,
              evictionPolicy: event.target.value
                ? event.target.value as NonNullable<CacheConfiguration["evictionPolicy"]>
                : undefined,
            })}
            className={`${inputClass(disabled)} w-full`}
          >
            <option value="">Not specified</option>
            <option value="noeviction">noeviction</option>
            <option value="allkeys-lru">allkeys-lru</option>
            <option value="allkeys-lfu">allkeys-lfu</option>
            <option value="volatile-lru">volatile-lru</option>
            <option value="volatile-ttl">volatile-ttl</option>
          </select>
        </label>
        <p className="rounded bg-zinc-800/70 p-2 text-[10px] leading-relaxed text-zinc-400">
          These values are saved and validated, but do not yet change performance estimates. Cache hit rate is configured on each App Server cache-read step.
        </p>
      </section>
    );
  }

  if (data.componentId === "message-queue") {
    const deliveryMode = data.queueDeliveryMode === "competing" ? "competing" : "broadcast";
    return (
      <section className="space-y-2 rounded-lg border border-zinc-700 bg-zinc-900/70 p-3">
        <div>
          <h3 className="text-xs font-semibold text-zinc-200">Queue delivery</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">Choose how connected consumers receive messages.</p>
        </div>
        <select
          aria-label="Queue consumer delivery mode"
          disabled={disabled}
          value={deliveryMode}
          onChange={(event) => updateNodeData(nodeId, {
            queueDeliveryMode: event.target.value === "competing" ? "competing" : "broadcast",
          })}
          className={`${inputClass(disabled)} w-full`}
        >
          <option value="broadcast">Broadcast to each consumer</option>
          <option value="competing">Competing consumer group</option>
        </select>
        <p className="text-[10px] leading-relaxed text-zinc-500">
          With subscriptions, competing consumers split each topic among its subscribers; broadcast sends each topic to every subscriber. Legacy or unmapped traffic uses connected consumers.
        </p>
        <div className="space-y-2 border-t border-zinc-700 pt-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-[11px] font-medium text-zinc-300">Topics</h4>
              <p className="text-[10px] text-zinc-500">Publish steps are checked against configured topic names.</p>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => saveQueueConfig({
                ...queueConfig,
                topics: [...queueConfig.topics, { id: id("topic"), name: "" }],
              })}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[10px] text-cyan-400 hover:bg-zinc-800 disabled:opacity-50"
            ><Plus className="h-3 w-3" /> Add topic</button>
          </div>
          {queueConfig.topics.map((topic: QueueTopicDefinition, topicIndex) => (
            <div key={topic.id} className="grid grid-cols-[minmax(0,1fr)_88px_auto] items-center gap-1.5">
              <input
                aria-label={`Queue topic ${topicIndex + 1} name`}
                disabled={disabled}
                value={topic.name}
                onChange={(event) => saveQueueConfig({
                  ...queueConfig,
                  topics: queueConfig.topics.map((item) => item.id === topic.id
                    ? { ...item, name: event.target.value }
                    : item),
                })}
                placeholder="topic name"
                className={`${inputClass(disabled)} min-w-0 font-mono`}
              />
              <input
                aria-label={`Queue topic ${topicIndex + 1} retention hours`}
                type="number"
                min="0.01"
                step="1"
                disabled={disabled}
                value={topic.retentionHours ?? ""}
                onChange={(event) => saveQueueConfig({
                  ...queueConfig,
                  topics: queueConfig.topics.map((item) => item.id === topic.id
                    ? { ...item, retentionHours: event.target.value === "" ? undefined : Number(event.target.value) }
                    : item),
                })}
                placeholder="hours"
                className={`${inputClass(disabled)} text-right`}
              />
              <button
                type="button"
                disabled={disabled}
                aria-label="Remove queue topic"
                onClick={() => saveQueueConfig({
                  ...queueConfig,
                  topics: queueConfig.topics.filter((item) => item.id !== topic.id),
                })}
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-rose-400 disabled:opacity-50"
              ><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-zinc-700 pt-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-[11px] font-medium text-zinc-300">Consumer subscriptions</h4>
              <p className="text-[10px] text-zinc-500">Map connected consumers to the topics they process.</p>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => saveQueueConfig({
                ...queueConfig,
                subscriptions: [...subscriptions, {
                  id: id("subscription"),
                  consumerNodeId: downstreamTargets[0]?.id ?? "",
                  topicName: queueConfig.topics[0]?.name ?? "",
                }],
              })}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[10px] text-cyan-400 hover:bg-zinc-800 disabled:opacity-50"
            ><Plus className="h-3 w-3" /> Add subscription</button>
          </div>
          {subscriptions.length === 0 && (
            <p className="rounded bg-zinc-800/60 p-2 text-[10px] leading-relaxed text-zinc-500">
              No explicit subscriptions. Existing designs keep their legacy aggregate consumer behavior.
            </p>
          )}
          {subscriptions.map((subscription: QueueConsumerSubscription, subscriptionIndex) => {
            const consumerExists = downstreamTargets.some((target) => target.id === subscription.consumerNodeId);
            const topicExists = queueConfig.topics.some((topic) => topic.name === subscription.topicName);
            return (
              <div key={subscription.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5">
                <select
                  aria-label={`Queue subscription ${subscriptionIndex + 1} consumer`}
                  disabled={disabled}
                  value={subscription.consumerNodeId}
                  onChange={(event) => saveQueueConfig({
                    ...queueConfig,
                    subscriptions: subscriptions.map((item) => item.id === subscription.id
                      ? { ...item, consumerNodeId: event.target.value }
                      : item),
                  })}
                  className={`${inputClass(disabled)} min-w-0`}
                >
                  <option value="">Choose consumer</option>
                  {!consumerExists && subscription.consumerNodeId && (
                    <option value={subscription.consumerNodeId}>Missing consumer</option>
                  )}
                  {downstreamTargets.map((target) => (
                    <option key={target.id} value={target.id}>{(target.data as ComponentNodeData).label}</option>
                  ))}
                </select>
                <select
                  aria-label={`Queue subscription ${subscriptionIndex + 1} topic`}
                  disabled={disabled}
                  value={subscription.topicName}
                  onChange={(event) => saveQueueConfig({
                    ...queueConfig,
                    subscriptions: subscriptions.map((item) => item.id === subscription.id
                      ? { ...item, topicName: event.target.value }
                      : item),
                  })}
                  className={`${inputClass(disabled)} min-w-0`}
                >
                  <option value="">Choose topic</option>
                  {!topicExists && subscription.topicName && (
                    <option value={subscription.topicName}>Missing topic</option>
                  )}
                  {queueConfig.topics.map((topic) => (
                    <option key={topic.id} value={topic.name}>{topic.name || "(unnamed topic)"}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label="Remove queue subscription"
                  onClick={() => saveQueueConfig({
                    ...queueConfig,
                    subscriptions: subscriptions.filter((item) => item.id !== subscription.id),
                  })}
                  className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-rose-400 disabled:opacity-50"
                ><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            );
          })}
        </div>
        <p className="rounded bg-zinc-800/70 p-2 text-[10px] leading-relaxed text-zinc-400">
          Publish steps and subscriptions map topic traffic to consumers; legacy or unmapped traffic uses connected consumers. Retention is not simulated. Backlog is a constant-rate projection from an empty backlog over the selected duration, not broker state or a time series.
        </p>
      </section>
    );
  }

  return null;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function buildSqlDdl(tables: DatabaseTable[]): string {
  return tables.map((table) => {
    if (table.columns.length === 0) {
      return `-- ${quoteIdentifier(table.name)} has no columns; add columns before creating this table.`;
    }
    const columnDefinitions = table.columns.map((column) =>
      `  ${quoteIdentifier(column.name)} ${column.dataType || "TEXT"}${column.nullable ? "" : " NOT NULL"}`
    );
    const primaryKeyColumns = table.columns.filter((column) => column.primaryKey);
    if (primaryKeyColumns.length > 0) {
      columnDefinitions.push(
        `  PRIMARY KEY (${primaryKeyColumns.map((column) => quoteIdentifier(column.name)).join(", ")})`
      );
    }
    const createTable = `CREATE TABLE ${quoteIdentifier(table.name)} (\n${columnDefinitions.join(",\n")}\n);`;
    const indexes = table.indexes.map((index) =>
      `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quoteIdentifier(index.name)} ON ${quoteIdentifier(table.name)} (${index.columns.map(quoteIdentifier).join(", ")});`
    );
    return [createTable, ...indexes].join("\n");
  }).join("\n\n");
}

function updateTableColumn(
  tables: DatabaseTable[],
  table: DatabaseTable,
  columnId: string,
  column: DatabaseColumn,
  saveTables: (tables: DatabaseTable[]) => void
): void {
  saveTables(tables.map((item) => item.id === table.id ? {
    ...item,
    columns: item.columns.map((current) => current.id === columnId ? column : current),
    indexes: item.indexes.map((index) => ({
      ...index,
      columns: index.columns.map((name) => {
        const previousName = table.columns.find((current) => current.id === columnId)?.name;
        return name === previousName ? column.name : name;
      }),
    })),
  } : item));
}

function ColumnEditor({
  column,
  disabled,
  onChange,
  onDelete,
  label,
}: {
  column: DatabaseColumn;
  disabled: boolean;
  onChange: (column: DatabaseColumn) => void;
  onDelete: () => void;
  label: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto_auto] items-center gap-1">
      <input
        aria-label={`${label} name`}
        disabled={disabled}
        value={column.name}
        onChange={(event) => onChange({ ...column, name: event.target.value })}
        placeholder="column name"
        className={`${inputClass(disabled)} font-mono`}
      />
      <input
        aria-label={`${label} data type`}
        disabled={disabled}
        value={column.dataType}
        onChange={(event) => onChange({ ...column, dataType: event.target.value })}
        placeholder="TEXT"
        className={`${inputClass(disabled)} font-mono`}
      />
      <label className="flex flex-col items-center text-[9px] text-zinc-400" title="Primary key">
        <input type="checkbox" disabled={disabled} checked={column.primaryKey} onChange={(event) => onChange({ ...column, primaryKey: event.target.checked, nullable: event.target.checked ? false : column.nullable })} /> PK
      </label>
      <button type="button" disabled={disabled} onClick={onDelete} aria-label="Remove column" className="rounded p-1 text-zinc-500 hover:text-rose-400 disabled:opacity-50"><Trash2 className="h-3 w-3" /></button>
      <label className="col-span-2 flex items-center gap-1 text-[10px] text-zinc-400">
        <input type="checkbox" disabled={disabled} checked={column.nullable} onChange={(event) => onChange({ ...column, nullable: event.target.checked, primaryKey: event.target.checked ? false : column.primaryKey })} /> Nullable
      </label>
    </div>
  );
}

function IndexEditor({
  index,
  indexNumber,
  columns,
  disabled,
  onChange,
  onDelete,
}: {
  index: DatabaseIndex;
  indexNumber: number;
  columns: DatabaseColumn[];
  disabled: boolean;
  onChange: (index: DatabaseIndex) => void;
  onDelete: () => void;
}) {
  const availableColumns = new Set(columns.map((column) => column.name));
  const [columnsDraft, setColumnsDraft] = useState(index.columns.join(", "));

  const commitColumns = () => {
    const selectedColumns = [...new Set(columnsDraft.split(",").map((name) => name.trim()).filter((name) => availableColumns.has(name)))];
    setColumnsDraft(selectedColumns.join(", "));
    onChange({ ...index, columns: selectedColumns });
  };

  return (
    <div className="space-y-1 rounded bg-zinc-900/70 p-1.5">
      <div className="flex gap-1.5">
        <input
          aria-label={`Index ${indexNumber + 1} name`}
          disabled={disabled}
          value={index.name}
          onChange={(event) => onChange({ ...index, name: event.target.value })}
          className={`${inputClass(disabled)} flex-1 font-mono`}
        />
        <button type="button" disabled={disabled} onClick={onDelete} aria-label="Remove index" className="rounded p-1 text-zinc-500 hover:text-rose-400 disabled:opacity-50"><Trash2 className="h-3 w-3" /></button>
      </div>
      <input
        aria-label={`Index ${indexNumber + 1} columns`}
        disabled={disabled}
        value={columnsDraft}
        onChange={(event) => setColumnsDraft(event.target.value)}
        onBlur={commitColumns}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        placeholder="leading columns, e.g. tenant_id, created_at"
        className={`${inputClass(disabled)} w-full font-mono`}
      />
      <label className="flex items-center gap-1 text-[10px] text-zinc-400">
        <input type="checkbox" disabled={disabled} checked={index.unique} onChange={(event) => onChange({ ...index, unique: event.target.checked })} /> Unique index
      </label>
    </div>
  );
}
