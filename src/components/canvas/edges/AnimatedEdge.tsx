"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { useSimulationStore } from "@/store/simulationStore";
import { useAppStore } from "@/store/appStore";
import { useTutorialStore } from "@/store/tutorialStore";
import { useCanvasStore, type ComponentNodeData, type CustomEdgeData } from "@/store/canvasStore";

const protocolBadge: Record<string, { text: string; color: string } | null> = {
  http: null,
  grpc: { text: "gRPC", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  websocket: { text: "WS", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  pubsub: { text: "pub/sub", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  tcp: { text: "TCP", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
  custom: null,
};

function AnimatedEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
  source,
  target,
}: EdgeProps) {
  const isRunning = useSimulationStore((s) => s.isRunning);
  const hasResult = useSimulationStore((s) => s.result !== null);
  // Traffic keeps flowing once a simulation has run (not just during the brief
  // compute window), so the canvas visibly "comes alive" after you Simulate.
  const flowing = isRunning || hasResult;
  const isDark = useAppStore((s) => s.theme) === "dark";
  const tutorialHighlight = useTutorialStore((s) => s.highlightTarget);
  const nodes = useCanvasStore((s) => s.nodes);
  const idleStroke = isDark ? "rgba(150, 165, 195, 0.32)" : "rgba(90, 105, 130, 0.45)";
  const edgeData = (data ?? {}) as CustomEdgeData;
  const sourceNode = nodes.find((node) => node.id === source && node.type !== "text");
  const targetNode = nodes.find((node) => node.id === target && node.type !== "text");
  const sourceComponentId = sourceNode ? (sourceNode.data as ComponentNodeData).componentId : undefined;
  const targetComponentId = targetNode ? (targetNode.data as ComponentNodeData).componentId : undefined;
  const isHighlighted = tutorialHighlight?.kind === "edge" &&
    tutorialHighlight.sourceComponentId === sourceComponentId &&
    tutorialHighlight.targetComponentId === targetComponentId;
  const isAsync = edgeData.async === true;
  const protocol = edgeData.protocol;
  const label = edgeData.label;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const badge = protocol ? protocolBadge[protocol] : null;
  const showLabel = label || badge;

  return (
    <g>
      {/* Main edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        data-tutorial-target={`edge:${sourceComponentId}:${source}:${targetComponentId}:${target}`}
        data-tutorial-highlight={isHighlighted ? "true" : undefined}
        style={{
          ...style,
          stroke: isHighlighted ? "#fbbf24" : flowing ? "rgba(52, 211, 230, 0.55)" : idleStroke,
          strokeWidth: isHighlighted ? 3.5 : flowing ? 1.75 : 1.5,
          ...(isHighlighted ? { filter: "drop-shadow(0 0 7px rgba(251,191,36,0.95))" } : {}),
          ...(isAsync ? { strokeDasharray: "6 4" } : {}),
        }}
      />
      {/* Directional traffic — particles flow source → target along the path. */}
      {flowing && (
        <>
          <circle r="2.4" fill="#3ad6e6" opacity="0.95">
            <animateMotion dur="1.6s" repeatCount="indefinite" path={edgePath} />
          </circle>
          <circle r="2" fill="#3ad6e6" opacity="0.6">
            <animateMotion dur="1.6s" repeatCount="indefinite" path={edgePath} begin="0.53s" />
          </circle>
          <circle r="1.6" fill="#3ad6e6" opacity="0.35">
            <animateMotion dur="1.6s" repeatCount="indefinite" path={edgePath} begin="1.06s" />
          </circle>
        </>
      )}
      {/* Label + protocol badge */}
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan flex items-center gap-1"
          >
            {label && (
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 leading-none">
                {label}
              </span>
            )}
            {badge && (
              <span
                className={`rounded border px-1 py-0.5 text-[9px] font-medium leading-none ${badge.color}`}
              >
                {badge.text}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

export const AnimatedEdge = memo(AnimatedEdgeInner);
