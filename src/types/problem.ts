export interface ProblemRequirements {
  readsPerSec: number;
  writesPerSec: number;
  storageGB: number;
  latencyMs: number;
  users: string; // e.g. "100M DAU"
}

export interface ProblemHint {
  title: string;
  content: string;
}

export interface ReferenceSolution {
  nodes: Array<{ componentId: string; x: number; y: number; replicas?: number }>;
  edges: Array<{ source: string; target: string; data?: { label?: string; protocol?: string; async?: boolean } }>;
}

export type ReferenceLoadTier = "low" | "medium" | "high";

export interface ReferenceVariant {
  tier: ReferenceLoadTier;
  requestsPerSec: number;
  summary: string;
  solution: ReferenceSolution;
}

export interface Problem {
  id: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  description: string;
  requirements: ProblemRequirements;
  constraints: string[];
  hints: ProblemHint[];
  referenceSolution: ReferenceSolution;
  tags: string[];
}
