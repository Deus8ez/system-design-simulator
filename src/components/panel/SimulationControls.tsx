"use client";

import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Play, Loader2 } from "lucide-react";
import { useSimulationStore } from "@/store/simulationStore";

const PRESETS = [
  { label: "Light", value: 1000 },
  { label: "Medium", value: 10000 },
  { label: "Heavy", value: 100000 },
  { label: "Stress", value: 500000 },
];

interface SimulationControlsProps {
  onSimulate: () => void;
}

export function SimulationControls({ onSimulate }: SimulationControlsProps) {
  const config = useSimulationStore((s) => s.config);
  const setConfig = useSimulationStore((s) => s.setConfig);
  const isRunning = useSimulationStore((s) => s.isRunning);

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

        {/* Duration slider removed: the simulation engine performs a single-snapshot
            calculation (not a time-series simulation), so durationSec has no effect. */}
      </div>

      <Separator className="bg-zinc-800" />

      <Button
        onClick={onSimulate}
        disabled={isRunning}
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
