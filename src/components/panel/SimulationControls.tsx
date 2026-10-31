"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Play, Loader2, RotateCcw } from "lucide-react";
import { useSimulationStore } from "@/store/simulationStore";
import { useCanvasStore, type ComponentNodeData } from "@/store/canvasStore";
import type { ComponentFault, RequestProfile } from "@/types/simulation";

const PRESETS = [
  { label: "Light", value: 1000 },
  { label: "Medium", value: 10000 },
  { label: "Heavy", value: 100000 },
  { label: "Stress", value: 500000 },
];

function parseRequestProfiles(raw: string): RequestProfile[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const profiles: RequestProfile[] = [];
    for (const [index, rawProfile] of parsed.entries()) {
      if (typeof rawProfile !== "object" || rawProfile === null || Array.isArray(rawProfile)) return null;
      const profile = rawProfile as Record<string, unknown>;
      const attributes = profile.attributes;
      if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes)) return null;
      const entries = Object.entries(attributes);
      if (entries.some(([, value]) => !["string", "number", "boolean"].includes(typeof value) || (typeof value === "number" && !Number.isFinite(value)))) {
        return null;
      }
      const trafficWeight = profile.trafficWeight;
      if (typeof trafficWeight !== "number" || !Number.isFinite(trafficWeight) || trafficWeight < 0) return null;
      const cacheHitRate = profile.cacheHitRate;
      if (cacheHitRate !== undefined && (
        typeof cacheHitRate !== "number" || !Number.isFinite(cacheHitRate) || cacheHitRate < 0 || cacheHitRate > 1
      )) return null;
      profiles.push({
        name: typeof profile.name === "string" && profile.name.trim() ? profile.name : `Profile ${index + 1}`,
        trafficWeight,
        attributes: Object.fromEntries(entries) as Record<string, string | number | boolean>,
        ...(cacheHitRate === undefined ? {} : { cacheHitRate }),
      });
    }
    if (profiles.every((profile) => profile.trafficWeight === 0)) {
      return null;
    }
    return profiles;
  } catch {
    return null;
  }
}

interface SimulationControlsProps {
  onSimulate: () => void;
}

export function SimulationControls({ onSimulate }: SimulationControlsProps) {
  const config = useSimulationStore((s) => s.config);
  const setConfig = useSimulationStore((s) => s.setConfig);
  const isRunning = useSimulationStore((s) => s.isRunning);
  const nodes = useCanvasStore((s) => s.nodes);
  const componentNodes = nodes.filter((node) => node.type !== "text");
  const faults = config.faults ?? {};
  const [profilesDraft, setProfilesDraft] = useState(() => JSON.stringify(config.requestProfiles ?? [], null, 2));
  const [profilesError, setProfilesError] = useState(false);

  const updateFault = (nodeId: string, fault: ComponentFault | undefined) => {
    const nextFaults = { ...faults };
    if (fault) nextFaults[nodeId] = fault;
    else delete nextFaults[nodeId];
    setConfig({ faults: nextFaults });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Simulation Config
      </p>

      {/* Presets */}
      <div className="flex gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => setConfig({ requestsPerSec: preset.value })}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              config.requestsPerSec === preset.value
                ? "bg-cyan-500/15 text-cyan-500"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="text-xs text-zinc-400">Requests/sec</label>
            <input
              type="number"
              min={100}
              max={500000}
              step={100}
              value={config.requestsPerSec}
              onChange={(e) => {
                const rawValue = Number(e.target.value);
                if (!Number.isFinite(rawValue)) return;
                const clampedValue = Math.min(500000, Math.max(100, Math.round(rawValue)));
                setConfig({ requestsPerSec: clampedValue });
              }}
              className="h-7 w-[120px] rounded-md border border-zinc-700 bg-zinc-950 px-2 text-right font-mono text-xs text-cyan-500 outline-none transition-colors focus:border-cyan-500"
              aria-label="Requests per second"
            />
          </div>
          <Slider
            value={[config.requestsPerSec]}
            onValueChange={(v) => setConfig({ requestsPerSec: Array.isArray(v) ? v[0] : v })}
            min={100}
            max={500000}
            step={100}
            className=""
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <label htmlFor="simulation-duration" className="text-xs text-zinc-400">Sustained load window</label>
            <p className="text-[10px] text-zinc-600">Used to estimate queue buildup</p>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              id="simulation-duration"
              type="number"
              min={1}
              max={3600}
              step={1}
              value={config.durationSec}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                setConfig({ durationSec: Math.min(3600, Math.max(1, Math.round(value))) });
              }}
              className="h-7 w-20 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-right font-mono text-xs text-zinc-300 outline-none focus:border-cyan-500"
            />
            <span className="text-xs text-zinc-500">sec</span>
          </div>
        </div>
      </div>

      <Separator className="bg-zinc-800" />

      <details className="group rounded-md border border-zinc-800 bg-zinc-950/40">
        <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold text-zinc-300 marker:hidden">
          Request cohorts
          <span className="ml-1 font-normal text-zinc-500">— weighted traffic profiles</span>
        </summary>
        <div className="space-y-2 border-t border-zinc-800 p-2.5">
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Define profiles with relative traffic weights and attributes. Optional <span className="font-mono text-zinc-400">cacheHitRate</span> (0–1) overrides the cache-read step for that cohort; omitted values use the step setting. Conditions support comparisons, <span className="font-mono text-zinc-400">!</span>, <span className="font-mono text-zinc-400">&&</span>, <span className="font-mono text-zinc-400">||</span>, and parentheses; for example <span className="font-mono text-zinc-400">(region == &apos;eu&apos; || region == &apos;us&apos;) &amp;&amp; age &gt;= 18</span>.
          </p>
          <textarea
            aria-label="Weighted request profiles JSON"
            value={profilesDraft}
            onChange={(event) => {
              const nextDraft = event.target.value;
              setProfilesDraft(nextDraft);
              const profiles = parseRequestProfiles(nextDraft);
              setProfilesError(profiles === null);
              if (profiles !== null) setConfig({ requestProfiles: profiles });
            }}
            rows={7}
            spellCheck={false}
            className="w-full resize-y rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-200 outline-none focus:border-cyan-600"
          />
          {profilesError && <p className="text-[10px] text-rose-400">Enter a non-empty profile array with non-negative weights, primitive attributes, and optional cacheHitRate values from 0 to 1; at least one weight must be positive.</p>}
        </div>
      </details>

      <details className="group rounded-md border border-zinc-800 bg-zinc-950/40">
        <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold text-zinc-300 marker:hidden">
          Failure injection
          <span className="ml-1 font-normal text-zinc-500">— model node outages</span>
        </summary>
        <div className="space-y-2 border-t border-zinc-800 p-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Faults apply when you run the next simulation. Degraded nodes use the configured capacity and latency factors.
            </p>
            {Object.keys(faults).length > 0 && (
              <button
                type="button"
                onClick={() => setConfig({ faults: {} })}
                className="inline-flex shrink-0 items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200"
              ><RotateCcw className="h-3 w-3" /> Reset</button>
            )}
          </div>
          {componentNodes.length === 0 ? (
            <p className="text-[11px] text-zinc-500">Add components to inject faults.</p>
          ) : (
            <div className="space-y-2">
              {componentNodes.map((node) => {
                const data = node.data as ComponentNodeData;
                const fault = faults[node.id];
                return (
                  <div key={node.id} className="space-y-1.5 rounded bg-zinc-900 p-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300" title={node.id}>{data.label}</span>
                      <select
                        aria-label={`Fault state for ${data.label}`}
                        value={fault?.mode ?? "healthy"}
                        onChange={(event) => {
                          const mode = event.target.value;
                          if (mode === "healthy") updateFault(node.id, undefined);
                          else if (mode === "down") updateFault(node.id, { mode: "down" });
                          else updateFault(node.id, {
                            mode: "degraded",
                            capacityFactor: 0.25,
                            latencyMultiplier: 3,
                          });
                        }}
                        className="h-7 w-28 rounded border border-zinc-700 bg-zinc-950 px-1.5 text-[11px] text-zinc-300"
                      >
                        <option value="healthy">Healthy</option>
                        <option value="degraded">Degraded</option>
                        <option value="down">Unavailable</option>
                      </select>
                    </div>
                    {fault?.mode === "degraded" && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1 text-[10px] text-zinc-500">
                          Capacity (%)
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={Math.round(fault.capacityFactor * 100)}
                            onChange={(event) => updateFault(node.id, {
                              ...fault,
                              capacityFactor: Math.min(1, Math.max(0.01, (Number(event.target.value) || 1) / 100)),
                            })}
                            className="h-7 w-full rounded border border-zinc-700 bg-zinc-950 px-2 font-mono text-xs text-zinc-300"
                          />
                        </label>
                        <label className="space-y-1 text-[10px] text-zinc-500">
                          Latency (×)
                          <input
                            type="number"
                            min="1"
                            max="20"
                            step="0.5"
                            value={fault.latencyMultiplier}
                            onChange={(event) => updateFault(node.id, {
                              ...fault,
                              latencyMultiplier: Math.min(20, Math.max(1, Number(event.target.value) || 1)),
                            })}
                            className="h-7 w-full rounded border border-zinc-700 bg-zinc-950 px-2 font-mono text-xs text-zinc-300"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </details>

      <Button
        onClick={onSimulate}
        disabled={isRunning || profilesError}
        className="w-full gap-2 bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50"
        size="sm"
      >
        {isRunning ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Simulating...
          </>
        ) : (
          <>
            <Play className="h-3 w-3" />
            Run Simulation
          </>
        )}
      </Button>
    </div>
  );
}
