import type { SimulationConfig } from "@/types/simulation";
import type { SerializedEdge, SerializedNode } from "@/store/savedDesignsStore";

function mermaidText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replaceAll("[", "&#91;")
    .replaceAll("]", "&#93;")
    .replaceAll("\n", "<br/>");
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Build a shareable Markdown architecture report from the same serialized JSON model. */
export function buildDesignMarkdown(
  name: string,
  nodes: SerializedNode[],
  edges: SerializedEdge[],
  simulationConfig: SimulationConfig,
): string {
  const mermaidIdByNodeId = new Map(nodes.map((node, index) => [node.id, `node${index}`]));
  const lines = [
    `# ${name}`,
    "",
    "## Architecture diagram",
    "",
    "```mermaid",
    "flowchart LR",
  ];

  for (const node of nodes) {
    const diagramId = mermaidIdByNodeId.get(node.id)!;
    const label = node.type === "text"
      ? node.data.text || "Text note"
      : `${node.data.label} (${node.data.componentId})`;
    lines.push(`  ${diagramId}["${mermaidText(label)}"]`);
  }
  for (const edge of edges) {
    const source = mermaidIdByNodeId.get(edge.source);
    const target = mermaidIdByNodeId.get(edge.target);
    if (!source || !target) continue;
    const data = edge.data;
    const details = [data?.label, data?.protocol, data?.async ? "async" : undefined]
      .filter(Boolean)
      .join(" · ");
    lines.push(`  ${source} -->${details ? `|${mermaidText(details)}|` : ""} ${target}`);
  }
  if (nodes.length === 0) lines.push("  empty[\"No components\"]");
  lines.push("```", "", "## Components and parameters", "");
  if (nodes.length === 0) {
    lines.push("No components in this design.", "");
  }
  for (const node of nodes) {
    lines.push(`### ${node.type === "text" ? "Text note" : node.data.label}`, "", "```json", json(node), "```", "");
  }
  lines.push("## Connections", "");
  if (edges.length === 0) lines.push("No connections.", "");
  for (const edge of edges) {
    lines.push(`- ${edge.source} → ${edge.target}: ${json(edge.data ?? {})}`);
  }
  lines.push("", "## Load and simulation parameters", "", "```json", json(simulationConfig), "```", "");
  return lines.join("\n");
}
