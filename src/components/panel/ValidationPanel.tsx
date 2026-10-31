"use client";

import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { compileDesign } from "@/engine/compiler";
import type { CompileResult } from "@/types/compiler";
import { useCanvasStore, type ComponentNodeData, type CustomEdgeData } from "@/store/canvasStore";
import { useAppStore } from "@/store/appStore";
import { useSimulationStore } from "@/store/simulationStore";
import type { Edge, Node } from "@xyflow/react";

export function ValidationPanel() {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const tabs = useCanvasStore((state) => state.tabs);
  const activeTabId = useCanvasStore((state) => state.activeTabId);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const setSelectedEdge = useCanvasStore((state) => state.setSelectedEdge);
  const setActiveRightTab = useAppStore((state) => state.setActiveRightTab);
  const requestProfiles = useSimulationStore((state) => state.config.requestProfiles);
  const [result, setResult] = useState<CompileResult | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  useEffect(() => {
    const timer = setTimeout(() => {
      const components = nodes.filter((node) => node.type !== "text") as Node<ComponentNodeData>[];
      setResult(compileDesign(components, edges as Edge<CustomEdgeData>[], requestProfiles));
    }, 250);
    return () => clearTimeout(timer);
  }, [nodes, edges, requestProfiles]);

  const openDiagnostic = (nodeId?: string, edgeId?: string) => {
    if (nodeId) setSelectedNode(nodeId);
    if (edgeId) setSelectedEdge(edgeId);
    setActiveRightTab(nodeId || edgeId ? "properties" : "simulation");
  };

  return (
    <section aria-label="Design validation" className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {result?.errorCount ? (
            <AlertCircle aria-hidden="true" className="h-4 w-4 text-rose-400" />
          ) : result?.warningCount ? (
            <AlertTriangle aria-hidden="true" className="h-4 w-4 text-amber-400" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-400" />
          )}
          <h3 className="text-xs font-semibold text-zinc-200">Design validation</h3>
        </div>
        <span aria-live="polite" className="text-[11px] text-zinc-400">
          {!result ? "Checking…" : `${result.errorCount} errors · ${result.warningCount} warnings · ${result.infoCount} info`}
        </span>
      </div>

      {activeTab?.readOnly && result && (
        <p className={`mt-2 rounded-md px-2 py-1.5 text-[11px] ${!result.ok ? "bg-amber-950/40 text-amber-200" : "bg-emerald-950/40 text-emerald-300"}`}>
          {!result.ok
            ? "Architecture-only reference: compile errors block simulation. Use this topology as guidance and define contracts in an editable design."
            : "Compiled reference: this sample is ready to simulate."}
        </p>
      )}

      {result && result.diagnostics.length === 0 && (
        <p className="mt-2 text-xs text-emerald-300">No compile issues. Simulation is ready.</p>
      )}

      {result && result.diagnostics.length > 0 && (
        <ul className="mt-2 space-y-2">
          {result.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${diagnostic.nodeId ?? diagnostic.edgeId ?? "design"}-${index}`}>
              <button
                type="button"
                onClick={() => openDiagnostic(diagnostic.nodeId, diagnostic.edgeId)}
                disabled={!diagnostic.nodeId && !diagnostic.edgeId}
                className="w-full rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-left enabled:hover:border-zinc-600 disabled:cursor-default"
              >
                <span className={`block text-xs ${diagnostic.severity === "error" ? "text-rose-300" : diagnostic.severity === "warning" ? "text-amber-300" : "text-zinc-300"}`}>
                  {diagnostic.message}
                </span>
                {diagnostic.remediation && (
                  <span className="mt-1 block text-[11px] text-zinc-400">Fix: {diagnostic.remediation}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}