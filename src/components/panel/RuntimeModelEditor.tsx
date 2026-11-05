"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Power, Trash2 } from "lucide-react";
import { useCanvasStore, type ComponentNodeData } from "@/store/canvasStore";
import { useTutorialStore } from "@/store/tutorialStore";
import type {
  CacheConfiguration,
  DatabaseColumn,
  DatabaseIndex,
  DatabaseReplicationEstimate,
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
  const tutorialHighlight = useTutorialStore((state) => state.highlightTarget);
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
  const replicationEstimate = data.databaseReplicationEstimate as DatabaseReplicationEstimate | undefined;
  const saveReplicationEstimate = (next: DatabaseReplicationEstimate | undefined) =>
    updateNodeData(nodeId, { databaseReplicationEstimate: next });
  const controlTarget = (id: string) => ({
    "data-tutorial-target": `control:${id}`,
    "data-tutorial-highlight": tutorialHighlight?.kind === "control" && tutorialHighlight.id === id && tutorialHighlight.componentId === data.componentId ? "true" : undefined,
  });
  const controlHighlight = (id: string) =>
    tutorialHighlight?.kind === "control" && tutorialHighlight.id === id && tutorialHighlight.componentId === data.componentId ? "true" : undefined;

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
      <section {...controlTarget("rate-limit-policy")} className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/70 p-3">
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
      <section {...controlTarget("gateway-routes")} className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-zinc-200">Gateway routes</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">Exact method + path mapping to a connected App Server endpoint.</p>
          </div>
          <button
            data-tutorial-target="control:gateway-route-add"
            data-tutorial-highlight={controlHighlight("gateway-route-add")}
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
                data-tutorial-target={`control:gateway-route-method-${routeIndex}`}
                data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `gateway-route-method-${routeIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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
                data-tutorial-target={`control:gateway-route-path-${routeIndex}`}
                data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `gateway-route-path-${routeIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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
                data-tutorial-target={`control:gateway-route-backend-${routeIndex}`}
                data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `gateway-route-backend-${routeIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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
      <section {...controlTarget("endpoint-pipeline")} className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-zinc-200">Service endpoints</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">Build an ordered request pipeline with weighted routes and retry policies.</p>
          </div>
          <button
            data-tutorial-target="control:endpoint-add"
            data-tutorial-highlight={controlHighlight("endpoint-add")}
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
                data-tutorial-target={`control:endpoint-method-${endpointIndex}`}
                data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `endpoint-method-${endpointIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
                aria-label={`Endpoint ${endpointIndex + 1} method`}
                disabled={disabled}
                value={endpoint.method}
                onChange={(event) => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({ ...current, method: event.target.value as EndpointMethod })))}
                className={`${inputClass(disabled)} w-[82px] shrink-0`}
              >
                {METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
              </select>
              <input
                data-tutorial-target={`control:endpoint-path-${endpointIndex}`}
                data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `endpoint-path-${endpointIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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
                <div key={step.id} className={`relative ml-2 border-l border-cyan-700/50 pb-1 pl-2.5 last:border-l-transparent ${step.enabled === false ? "opacity-60" : ""}`}>
                  <span className="absolute -left-[4px] top-2 h-1.5 w-1.5 rounded-full bg-cyan-500" />
                  <div className="flex gap-1.5">
                    <select
                      data-tutorial-target={`control:endpoint-step-kind-${endpointIndex}-${stepIndex}`}
                      data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `endpoint-step-kind-${endpointIndex}-${stepIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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
                      disabled={disabled}
                      aria-pressed={step.enabled !== false}
                      aria-label={step.enabled === false ? "Enable pipeline step" : "Disable pipeline step"}
                      title={step.enabled === false ? "Enable step" : "Disable step"}
                      onClick={() => saveEndpoints(updateEndpoint(endpoints, endpoint.id, (current) => ({
                        ...current,
                        steps: current.steps.map((item) => item.id === step.id
                          ? { ...item, enabled: item.enabled === false }
                          : item),
                      })))}
                      className={`rounded px-1.5 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 ${step.enabled === false ? "text-zinc-500" : "text-emerald-400"}`}
                    ><Power className="h-3 w-3" /></button>
                    <button
                      data-tutorial-target={`control:endpoint-step-up-${endpointIndex}-${stepIndex}`}
                      data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `endpoint-step-up-${endpointIndex}-${stepIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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
                        data-tutorial-target={`control:endpoint-step-resource-${endpointIndex}-${stepIndex}`}
                        data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `endpoint-step-resource-${endpointIndex}-${stepIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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
                        data-tutorial-target={`control:endpoint-step-target-${endpointIndex}-${stepIndex}`}
                        data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `endpoint-step-target-${endpointIndex}-${stepIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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
                            if (step.kind.startsWith("database-")) return ["sql-db", "nosql-db", "timeseries-db"].includes(targetData.componentId);
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
                          data-tutorial-target={`control:endpoint-cache-hit-rate-${endpointIndex}-${stepIndex}`}
                          data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `endpoint-cache-hit-rate-${endpointIndex}-${stepIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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
              data-tutorial-target={`control:endpoint-step-add-${endpointIndex}`}
              data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `endpoint-step-add-${endpointIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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

  if (data.componentId === "sql-db" || data.componentId === "nosql-db" || data.componentId === "timeseries-db") {
    const isSqlDatabase = data.componentId === "sql-db";
    const isTimeSeriesDatabase = data.componentId === "timeseries-db";
    const usesTables = isSqlDatabase || isTimeSeriesDatabase;
    return (
      <section {...controlTarget("database-schema")} className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-zinc-200">
              {isSqlDatabase ? "Relational schema" : isTimeSeriesDatabase ? "Time-series schema" : "Collection schema"}
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {isSqlDatabase
                ? "At 1,000 rows, scans cost 5 work units and indexed reads 1; costs scale with table size and leading index columns."
                : isTimeSeriesDatabase
                  ? "Define measurement fields and time-based lookup indexes for recent telemetry."
                  : "Define document fields and lookup indexes for the collection. Indexed reads reduce modeled lookup work as the collection grows."}
            </p>
          </div>
          <button
            data-tutorial-target="control:database-table-add"
            data-tutorial-highlight={controlHighlight("database-table-add")}
            type="button"
            disabled={disabled}
            onClick={() => saveTables([...tables, {
              id: id("table"),
              name: `${usesTables ? "table" : "collection"}_${tables.length + 1}`,
              estimatedRows: 1000,
              columns: [{ id: id("column"), name: "id", dataType: "UUID", nullable: false, primaryKey: true }],
              indexes: [],
            }])}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-cyan-400 hover:bg-zinc-800 disabled:opacity-50"
          ><Plus className="h-3 w-3" /> {usesTables ? "Add table" : "Add collection"}</button>
        </div>

        <div className="space-y-2 rounded border border-violet-900/60 bg-violet-950/20 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium text-violet-200">Read-replica capacity · estimate only</span>
            {replicationEstimate ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => saveReplicationEstimate(undefined)}
                className="text-[10px] text-zinc-500 hover:text-rose-300 disabled:opacity-50"
              >Remove</button>
            ) : (
              <button
                data-tutorial-target="control:database-read-replica-configure"
                data-tutorial-highlight={controlHighlight("database-read-replica-configure")}
                type="button"
                disabled={disabled}
                onClick={() => saveReplicationEstimate({
                  estimatedReadReplicaCount: 1,
                  estimatedReadTrafficToReplicasShare: 1,
                })}
                className="text-[10px] text-violet-300 hover:text-violet-200 disabled:opacity-50"
              >Configure</button>
            )}
          </div>
          {replicationEstimate && (
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                Assumed additional read-serving copies
                <input
                  data-tutorial-target="control:database-read-replica-count"
                  data-tutorial-highlight={controlHighlight("database-read-replica-count")}
                  aria-label="Estimated additional read-serving copies"
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                  disabled={disabled}
                  value={replicationEstimate.estimatedReadReplicaCount}
                  onChange={(event) => saveReplicationEstimate({
                    ...replicationEstimate,
                    estimatedReadReplicaCount: Math.min(1000, Math.max(1, Math.floor(Number(event.target.value) || 1))),
                  })}
                  className={`${inputClass(disabled)} w-20 text-right font-mono`}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                Assumed read work served by copies
                <span className="flex items-center gap-1">
                  <input
                    data-tutorial-target="control:database-read-replica-share"
                    data-tutorial-highlight={controlHighlight("database-read-replica-share")}
                    aria-label="Estimated read work share served by additional copies"
                    type="number"
                    min="0"
                    max="100"
                    step="5"
                    disabled={disabled}
                    value={Math.round((replicationEstimate.estimatedReadTrafficToReplicasShare ?? 1) * 100)}
                    onChange={(event) => saveReplicationEstimate({
                      ...replicationEstimate,
                      estimatedReadTrafficToReplicasShare: Math.min(100, Math.max(0, Number(event.target.value) || 0)) / 100,
                    })}
                    className={`${inputClass(disabled)} w-20 text-right font-mono`}
                  />
                  <span>%</span>
                </span>
              </label>
                <label className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                  Assumed replication lag
                  <span className="flex items-center gap-1">
                    <input
                      data-tutorial-target="control:database-replication-lag"
                      data-tutorial-highlight={controlHighlight("database-replication-lag")}
                      aria-label="Estimated replication lag in milliseconds"
                      type="number"
                      min="0"
                      step="10"
                      disabled={disabled}
                      value={replicationEstimate.estimatedReplicationLagMs ?? ""}
                      onChange={(event) => saveReplicationEstimate({
                        ...replicationEstimate,
                        estimatedReplicationLagMs: event.target.value === ""
                          ? undefined
                          : Math.max(0, Number(event.target.value) || 0),
                      })}
                      className={`${inputClass(disabled)} w-20 text-right font-mono`}
                    />
                    <span>ms</span>
                  </span>
                </label>
                <label className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                  Maximum tolerated read staleness
                  <span className="flex items-center gap-1">
                    <input
                      data-tutorial-target="control:database-read-staleness-budget"
                      data-tutorial-highlight={controlHighlight("database-read-staleness-budget")}
                      aria-label="Maximum tolerated read staleness in milliseconds"
                      type="number"
                      min="0"
                      step="10"
                      disabled={disabled}
                      value={replicationEstimate.maximumToleratedReadStalenessMs ?? ""}
                      onChange={(event) => saveReplicationEstimate({
                        ...replicationEstimate,
                        maximumToleratedReadStalenessMs: event.target.value === ""
                          ? undefined
                          : Math.max(0, Number(event.target.value) || 0),
                      })}
                      className={`${inputClass(disabled)} w-20 text-right font-mono`}
                    />
                    <span>ms</span>
                  </span>
                </label>
            </div>
          )}
          <p className="text-[10px] leading-relaxed text-zinc-500">
              Capacity and risk estimates only: compares the assumed read share against identical extra copies at this database’s configured QPS. If both lag and staleness budget are supplied, simulation can flag when the first exceeds the second. It does not route reads, model replication overhead or actual freshness, or change throughput. Requires app-server database-read steps for workload metrics.
          </p>
        </div>

        {tables.length === 0 && (
          <p className="rounded bg-zinc-800/70 p-2 text-[11px] text-zinc-500">
            {usesTables
              ? "No tables yet. Add a table and define its access keys."
              : "No collections yet. Add a collection and define its fields and lookup indexes."}
          </p>
        )}

        {tables.map((table, tableIndex) => (
          <div key={table.id} className="space-y-2 rounded-md border border-zinc-700/80 bg-zinc-800/50 p-2">
            <div className="flex gap-1.5">
              <input
                data-tutorial-target={`control:database-table-name-${tableIndex}`}
                data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `database-table-name-${tableIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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

            {table.partitioning ? (
              <div className="space-y-2 rounded border border-cyan-900/60 bg-cyan-950/20 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium text-cyan-200">Hash partitioning · estimate only</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => saveTables(tables.map((item) => item.id === table.id ? { ...item, partitioning: undefined } : item))}
                    className="text-[10px] text-zinc-500 hover:text-rose-300 disabled:opacity-50"
                  >Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  <label className="space-y-1 text-[10px] text-zinc-400">
                    Partition key
                    <select
                      data-tutorial-target="control:database-partition-key"
                      data-tutorial-highlight={controlHighlight("database-partition-key")}
                      aria-label={`Table ${tableIndex + 1} partition key`}
                      disabled={disabled}
                      value={table.partitioning.keyColumn}
                      onChange={(event) => saveTables(tables.map((item) => item.id === table.id ? {
                        ...item,
                        partitioning: { ...table.partitioning!, keyColumn: event.target.value },
                      } : item))}
                      className={`${inputClass(disabled)} w-full`}
                    >
                      <option value="">Choose column</option>
                      {table.columns.map((column) => <option key={column.id} value={column.name}>{column.name}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-[10px] text-zinc-400">
                    Shards
                    <input
                      data-tutorial-target="control:database-shard-count"
                      data-tutorial-highlight={controlHighlight("database-shard-count")}
                      aria-label={`Table ${tableIndex + 1} shard count`}
                      type="number"
                      min="1"
                      step="1"
                      disabled={disabled}
                      value={table.partitioning.shardCount}
                      onChange={(event) => saveTables(tables.map((item) => item.id === table.id ? {
                        ...item,
                        partitioning: { ...table.partitioning!, shardCount: Number(event.target.value) },
                      } : item))}
                      className={`${inputClass(disabled)} w-full text-right`}
                    />
                  </label>
                  <label className="space-y-1 text-[10px] text-zinc-400">
                    Hottest key traffic (%)
                    <input
                      data-tutorial-target="control:database-hot-key-share"
                      data-tutorial-highlight={controlHighlight("database-hot-key-share")}
                      aria-label={`Table ${tableIndex + 1} hottest key traffic share percent`}
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      disabled={disabled}
                      value={Math.round(table.partitioning.hotKeyTrafficShare * 100)}
                      onChange={(event) => saveTables(tables.map((item) => item.id === table.id ? {
                        ...item,
                        partitioning: { ...table.partitioning!, hotKeyTrafficShare: Math.min(100, Math.max(0, Number(event.target.value) || 0)) / 100 },
                      } : item))}
                      className={`${inputClass(disabled)} w-full text-right`}
                    />
                  </label>
                  <label className="space-y-1 text-[10px] text-zinc-400">
                    Estimated shard capacity (work/s)
                    <input
                      data-tutorial-target="control:database-shard-capacity"
                      data-tutorial-highlight={controlHighlight("database-shard-capacity")}
                      aria-label={`Table ${tableIndex + 1} estimated work capacity per shard`}
                      type="number"
                      min="0.01"
                      step="100"
                      disabled={disabled}
                      value={table.partitioning.estimatedWorkCapacityPerShard ?? ""}
                      onChange={(event) => saveTables(tables.map((item) => item.id === table.id ? {
                        ...item,
                        partitioning: {
                          ...table.partitioning!,
                          estimatedWorkCapacityPerShard: event.target.value === "" ? undefined : Number(event.target.value),
                        },
                      } : item))}
                      className={`${inputClass(disabled)} w-full text-right font-mono`}
                      placeholder="optional"
                    />
                  </label>
                </div>
                <p className="text-[10px] leading-relaxed text-zinc-500">Assumes non-hot keys hash uniformly and similar work per request. With a per-shard capacity estimate, simulation compares this table’s modeled read/write work against estimated hot-shard pressure; it does not change database throughput or model query routing.</p>
              </div>
            ) : (
              <button
                data-tutorial-target="control:database-partitioning-add"
                data-tutorial-highlight={controlHighlight("database-partitioning-add")}
                type="button"
                disabled={disabled || table.columns.length === 0}
                onClick={() => saveTables(tables.map((item) => item.id === table.id ? {
                  ...item,
                  partitioning: {
                    strategy: "hash",
                    keyColumn: table.columns[0]?.name ?? "",
                    shardCount: 4,
                    hotKeyTrafficShare: 0,
                  },
                } : item))}
                className="inline-flex items-center gap-1 rounded border border-cyan-900/60 px-2 py-1 text-[10px] text-cyan-300 hover:bg-cyan-950/40 disabled:opacity-50"
              ><Plus className="h-3 w-3" /> Configure hash partitioning</button>
            )}

            <div className="space-y-1.5">
              {table.columns.map((column, columnIndex) => (
                <ColumnEditor
                  key={column.id}
                  column={column}
                  tutorialOccurrence={columnIndex}
                  tutorialComponentId={data.componentId}
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
              data-tutorial-target={`control:database-column-add-${tableIndex}`}
              data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `database-column-add-${tableIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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
                  data-tutorial-target={`control:database-index-add-${tableIndex}`}
                  data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === `database-index-add-${tableIndex}` && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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
                  tutorialComponentId={data.componentId}
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
            data-tutorial-target="control:cache-ttl"
            data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === "cache-ttl" && tutorialHighlight.componentId === data.componentId ? "true" : undefined}
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
      <section {...controlTarget("queue-topic-add")} className="space-y-2 rounded-lg border border-zinc-700 bg-zinc-900/70 p-3">
        <div>
          <h3 className="text-xs font-semibold text-zinc-200">Queue delivery</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">Choose how connected consumers receive messages.</p>
        </div>
        <select
          data-tutorial-target="control:queue-delivery-mode"
          data-tutorial-highlight={controlHighlight("queue-delivery-mode")}
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
              data-tutorial-target="control:queue-topic-add"
              data-tutorial-highlight={controlHighlight("queue-topic-add")}
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
            <div key={topic.id} className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <input
                data-tutorial-target="control:queue-topic-name"
                data-tutorial-highlight={controlHighlight("queue-topic-name")}
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
                className={`${inputClass(disabled)} h-9 min-w-0 flex-1 border-zinc-600 bg-zinc-950 font-mono text-sm font-medium placeholder:text-zinc-500`}
              />
              <button
                type="button"
                disabled={disabled}
                aria-label="Remove queue topic"
                onClick={() => saveQueueConfig({
                  ...queueConfig,
                  topics: queueConfig.topics.filter((item) => item.id !== topic.id),
                })}
                className="shrink-0 rounded p-2 text-zinc-500 hover:bg-zinc-700 hover:text-rose-400 disabled:opacity-50"
              ><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                data-tutorial-target="control:queue-topic-retention"
                data-tutorial-highlight={controlHighlight("queue-topic-retention")}
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
              <input
                data-tutorial-target="control:queue-topic-partitions"
                data-tutorial-highlight={controlHighlight("queue-topic-partitions")}
                aria-label={`Queue topic ${topicIndex + 1} partition count`}
                type="number"
                min="1"
                step="1"
                disabled={disabled}
                value={topic.partitionCount ?? ""}
                onChange={(event) => saveQueueConfig({
                  ...queueConfig,
                  topics: queueConfig.topics.map((item) => item.id === topic.id
                    ? { ...item, partitionCount: event.target.value === "" ? undefined : Number(event.target.value) }
                    : item),
                })}
                placeholder="parts"
                className={`${inputClass(disabled)} text-right`}
              />
              <input
                data-tutorial-target="control:queue-topic-hot-partition-share"
                data-tutorial-highlight={controlHighlight("queue-topic-hot-partition-share")}
                aria-label={`Queue topic ${topicIndex + 1} estimated hottest partition traffic percent`}
                type="number"
                min={topic.partitionCount ? (100 / topic.partitionCount).toString() : "0.01"}
                max="100"
                step="0.1"
                disabled={disabled}
                value={topic.estimatedHotPartitionTrafficShare === undefined ? "" : topic.estimatedHotPartitionTrafficShare * 100}
                onChange={(event) => saveQueueConfig({
                  ...queueConfig,
                  topics: queueConfig.topics.map((item) => item.id === topic.id
                    ? { ...item, estimatedHotPartitionTrafficShare: event.target.value === "" ? undefined : Number(event.target.value) / 100 }
                    : item),
                })}
                placeholder="hot %"
                className={`${inputClass(disabled)} text-right`}
              />
              <input
                data-tutorial-target="control:queue-topic-message-size"
                data-tutorial-highlight={controlHighlight("queue-topic-message-size")}
                aria-label={`Queue topic ${topicIndex + 1} estimated average message size bytes`}
                type="number"
                min="1"
                step="1"
                disabled={disabled}
                value={topic.estimatedAverageMessageSizeBytes ?? ""}
                onChange={(event) => saveQueueConfig({
                  ...queueConfig,
                  topics: queueConfig.topics.map((item) => item.id === topic.id
                    ? { ...item, estimatedAverageMessageSizeBytes: event.target.value === "" ? undefined : Number(event.target.value) }
                    : item),
                })}
                placeholder="bytes"
                className={`${inputClass(disabled)} text-right`}
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                data-tutorial-target="control:queue-topic-failure-rate"
                data-tutorial-highlight={controlHighlight("queue-topic-failure-rate")}
                aria-label={`Queue topic ${topicIndex + 1} estimated delivery failure rate percent`}
                type="number"
                min="0"
                max="100"
                step="0.1"
                disabled={disabled}
                value={topic.estimatedFailureRatePerAttempt === undefined ? "" : topic.estimatedFailureRatePerAttempt * 100}
                onChange={(event) => saveQueueConfig({
                  ...queueConfig,
                  topics: queueConfig.topics.map((item) => item.id === topic.id
                    ? { ...item, estimatedFailureRatePerAttempt: event.target.value === "" ? undefined : Number(event.target.value) / 100 }
                    : item),
                })}
                placeholder="failure %"
                className={`${inputClass(disabled)} text-right`}
              />
              <input
                data-tutorial-target="control:queue-topic-retries"
                data-tutorial-highlight={controlHighlight("queue-topic-retries")}
                aria-label={`Queue topic ${topicIndex + 1} estimated maximum delivery retries`}
                type="number"
                min="0"
                max="5"
                step="1"
                disabled={disabled}
                value={topic.maxDeliveryRetries ?? ""}
                onChange={(event) => saveQueueConfig({
                  ...queueConfig,
                  topics: queueConfig.topics.map((item) => item.id === topic.id
                    ? { ...item, maxDeliveryRetries: event.target.value === "" ? undefined : Number(event.target.value) }
                    : item),
                })}
                placeholder="retries (0–5)"
                className={`${inputClass(disabled)} text-right`}
              />
              <input
                data-tutorial-target="control:queue-topic-retry-backoff"
                data-tutorial-highlight={controlHighlight("queue-topic-retry-backoff")}
                aria-label={`Queue topic ${topicIndex + 1} estimated retry backoff milliseconds`}
                type="number"
                min="0"
                step="1"
                disabled={disabled}
                value={topic.estimatedRetryBackoffMs ?? ""}
                onChange={(event) => saveQueueConfig({
                  ...queueConfig,
                  topics: queueConfig.topics.map((item) => item.id === topic.id
                    ? { ...item, estimatedRetryBackoffMs: event.target.value === "" ? undefined : Number(event.target.value) }
                    : item),
                })}
                placeholder="delay ms"
                className={`${inputClass(disabled)} text-right`}
              />
            </div>
            </div>
          ))}
          <p className="text-[10px] leading-relaxed text-zinc-500">
            Optional hottest-partition traffic share (percent). It must be at least the uniform share (100% ÷ partitions); only the competing-consumer backlog estimate uses it.
          </p>
          <p className="text-[10px] leading-relaxed text-zinc-500">
            Optional average message payload size (bytes). With retention configured, this estimates logical retained payload only; it excludes replication, compression, metadata, and broker storage overhead.
          </p>
          <p className="text-[10px] leading-relaxed text-zinc-500">
            Optional retry estimate: set both an assumed independent per-attempt failure rate and 0–5 additional attempts. A fixed per-retry delay can estimate expected waiting time only; retry timing, acknowledgments, offsets, DLQ routing, and duplicate effects are not simulated, and retry work does not change capacity or backlog.
          </p>
        </div>
        <div className="space-y-2 border-t border-zinc-700 pt-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-[11px] font-medium text-zinc-300">Consumer subscriptions</h4>
              <p className="text-[10px] text-zinc-500">Map connected consumers to the topics they process.</p>
            </div>
            <button
              data-tutorial-target="control:queue-subscription-add"
              data-tutorial-highlight={controlHighlight("queue-subscription-add")}
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
          Publish steps and subscriptions map topic traffic to consumers; legacy or unmapped traffic uses connected consumers. Retention is not simulated. For competing groups, configured partitions cap the aggregate backlog-drain estimate by available consumer parallelism; keyed assignment, skew, offsets, and replay are not modeled. Backlog is a constant-rate projection from an empty backlog over the selected duration, not broker state or a time series.
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
  tutorialOccurrence,
  tutorialComponentId,
  disabled,
  onChange,
  onDelete,
  label,
}: {
  column: DatabaseColumn;
  tutorialOccurrence: number;
  tutorialComponentId: string;
  disabled: boolean;
  onChange: (column: DatabaseColumn) => void;
  onDelete: () => void;
  label: string;
}) {
  const tutorialHighlight = useTutorialStore((state) => state.highlightTarget);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto_auto] items-center gap-1">
      <input
        data-tutorial-target="control:database-column-name"
        data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === "database-column-name" && tutorialHighlight.componentId === tutorialComponentId && tutorialHighlight.occurrence === tutorialOccurrence ? "true" : undefined}
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
  tutorialComponentId,
  disabled,
  onChange,
  onDelete,
}: {
  index: DatabaseIndex;
  indexNumber: number;
  columns: DatabaseColumn[];
  tutorialComponentId: string;
  disabled: boolean;
  onChange: (index: DatabaseIndex) => void;
  onDelete: () => void;
}) {
  const tutorialHighlight = useTutorialStore((state) => state.highlightTarget);
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
        data-tutorial-target="control:database-index-columns"
        data-tutorial-highlight={tutorialHighlight?.kind === "control" && tutorialHighlight.id === "database-index-columns" && tutorialHighlight.componentId === tutorialComponentId ? "true" : undefined}
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
