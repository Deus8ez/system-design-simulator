"use client";

import { useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";
import { Check, ChevronRight, Lightbulb, Play, RotateCcw, X } from "lucide-react";
import { TUTORIAL_BY_PROBLEM_ID } from "@/data/tutorials";
import { PROBLEMS } from "@/data/problems";
import { compileDesign } from "@/engine/compiler";
import { evaluateTutorialObjective, getTutorialDesignSignature } from "@/lib/tutorialEvaluator";
import { useCanvasStore, type ComponentNodeData, type CustomEdgeData } from "@/store/canvasStore";
import { useSimulationStore } from "@/store/simulationStore";
import { useTutorialStore } from "@/store/tutorialStore";
import type { TutorialLevelId } from "@/types/tutorial";

const LEVEL_ORDER: TutorialLevelId[] = ["low", "medium", "high"];

interface TutorialCoachProps {
  onRunScenario: (requestsPerSec: number) => void;
  onResetCanvas: () => void;
}

export function TutorialCoach({ onRunScenario, onResetCanvas }: TutorialCoachProps) {
  const activeProblemId = useTutorialStore((state) => state.activeProblemId);
  const progressByProblem = useTutorialStore((state) => state.progressByProblem);
  const completeStep = useTutorialStore((state) => state.completeStep);
  const setLevel = useTutorialStore((state) => state.setLevel);
  const resetProgress = useTutorialStore((state) => state.reset);
  const closeTutorial = useTutorialStore((state) => state.close);
  const activeTabId = useCanvasStore((state) => state.activeTabId);
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const requestProfiles = useSimulationStore((state) => state.config.requestProfiles);
  const simulationResult = useSimulationStore((state) => state.result);
  const simulationConfigQps = useSimulationStore((state) => state.config.requestsPerSec);
  const [feedback, setFeedback] = useState<{ contextKey: string; ok: boolean; message: string } | null>(null);
  const [hintContext, setHintContext] = useState<string | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const tutorial = activeProblemId ? TUTORIAL_BY_PROBLEM_ID.get(activeProblemId) : undefined;
  const progress = activeProblemId ? progressByProblem[activeProblemId] : undefined;
  const tabId = activeProblemId ? `tutorial-${activeProblemId}` : "";
  const level = tutorial?.levels.find((item) => item.id === progress?.currentLevel) ?? tutorial?.levels[0];
  const completedIds = progress?.completedStepIds ?? [];
  const currentStep = level?.steps.find((step) => !completedIds.includes(step.id));
  const problemTitle = PROBLEMS.find((problem) => problem.id === activeProblemId)?.title ?? activeProblemId;
  const currentObjectiveKey = `${activeProblemId ?? ""}:${level?.id ?? ""}:${currentStep?.id ?? ""}`;

  if (!tutorial || !progress || activeTabId !== tabId || !level) return null;

  const levelIndex = LEVEL_ORDER.indexOf(progress.currentLevel);
  const unlocked = new Set<TutorialLevelId>(["low"]);
  for (let index = 0; index < levelIndex; index += 1) {
    const earlierLevel = tutorial.levels[index];
    if (earlierLevel.steps.every((step) => completedIds.includes(step.id))) {
      unlocked.add(tutorial.levels[index + 1].id);
    }
  }
  if (level.steps.every((step) => completedIds.includes(step.id)) && levelIndex < 2) {
    unlocked.add(tutorial.levels[levelIndex + 1].id);
  }

  const checkCurrentStep = () => {
    if (!currentStep) return;
    const componentNodes = nodes.filter((node) => node.type !== "text") as Node<ComponentNodeData>[];
    const compilation = compileDesign(componentNodes, edges as Edge<CustomEdgeData>[], requestProfiles);
    const designSignature = getTutorialDesignSignature(
      componentNodes,
      edges,
    );
    const result = evaluateTutorialObjective(currentStep.objective, {
      nodes: componentNodes,
      edges,
      compilation,
      simulation: {
        result: simulationResult,
        requestsPerSec: simulationConfigQps,
        recordedRequestsPerSec: progress.lastSimulation?.requestsPerSec,
        recordedSignature: progress.lastSimulation?.designSignature,
        recordedTimestamp: progress.lastSimulation?.timestamp,
        currentSignature: designSignature,
      },
    });
    setFeedback({ contextKey: currentObjectiveKey, ok: result.complete, message: result.feedback });
    if (result.complete) completeStep(activeProblemId!, currentStep.id);
  };

  const runScenario = () => {
    setFeedback(null);
    onRunScenario(level.requestsPerSec);
  };

  const startNextLevel = () => {
    const nextLevel = tutorial.levels[levelIndex + 1];
    if (nextLevel && unlocked.has(nextLevel.id)) {
      setLevel(activeProblemId!, nextLevel.id);
      setFeedback(null);
      setHintContext(null);
    }
  };

  const resetTutorial = () => {
    onResetCanvas();
    resetProgress(activeProblemId!);
    setFeedback(null);
    setHintContext(null);
  };

  const completedInLevel = level.steps.filter((step) => completedIds.includes(step.id)).length;
  const completedAcrossLevels = tutorial.levels.reduce(
    (sum, item) => sum + item.steps.filter((step) => completedIds.includes(step.id)).length,
    0,
  );
  const totalSteps = tutorial.levels.reduce((sum, item) => sum + item.steps.length, 0);

  return (
    <section
      aria-label={`${problemTitle} guided tutorial`}
      aria-live="polite"
      className="absolute bottom-3 left-1/2 z-20 w-[min(560px,calc(100%-24px))] -translate-x-1/2 overflow-hidden rounded-xl border border-cyan-500/25 bg-zinc-950/95 shadow-2xl backdrop-blur"
    >
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100">Guided build · {problemTitle}</span>
        <span className="text-[10px] text-zinc-400">{completedAcrossLevels}/{totalSteps} steps</span>
        <button type="button" onClick={() => setResetConfirmOpen(true)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Restart tutorial from blank canvas" title="Restart from blank canvas">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={closeTutorial} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close tutorial coach">
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="max-h-[55vh] space-y-3 overflow-y-auto p-3">
        <div className="flex flex-wrap gap-1.5">
          {tutorial.levels.map((item, index) => {
            const isUnlocked = unlocked.has(item.id);
            const isSelected = item.id === level.id;
            const done = item.steps.every((step) => completedIds.includes(step.id));
            return (
              <button
                key={item.id}
                type="button"
                disabled={!isUnlocked}
                onClick={() => { setLevel(activeProblemId!, item.id); setFeedback(null); setHintContext(null); }}
                className={`rounded-md border px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${isSelected ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-200" : done ? "border-emerald-500/30 text-emerald-300" : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"}`}
                aria-current={isSelected ? "step" : undefined}
                title={item.trafficLabel}
              >
                {index + 1}. {item.id === "low" ? "Low" : item.id === "medium" ? "Medium" : "High"}{done ? " ✓" : ""}
              </button>
            );
          })}
          <span className="ml-auto self-center text-[10px] text-zinc-500">{level.trafficLabel}</span>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-zinc-100">{level.title}</h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">{level.goal}</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${(completedInLevel / level.steps.length) * 100}%` }} />
          </div>
          <p className="mt-1 text-[10px] text-zinc-500">Level progress: {completedInLevel}/{level.steps.length}</p>
        </div>

        {currentStep ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
            <div className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-[10px] font-semibold text-cyan-300">
                {completedInLevel + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-semibold text-zinc-100">{currentStep.title}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-300">{currentStep.prompt}</p>
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-400"><span className="font-semibold text-cyan-300">Why:</span> {currentStep.why}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500"><span className="font-semibold text-zinc-400">Trade-off:</span> {currentStep.tradeoff}</p>
                {currentStep.hint && (
                  <button type="button" onClick={() => setHintContext((value) => value === currentObjectiveKey ? null : currentObjectiveKey)} className="mt-2 inline-flex min-h-7 items-center gap-1 rounded px-1.5 text-[10px] text-amber-300 hover:bg-amber-500/10">
                    <Lightbulb className="h-3 w-3" /> {hintContext === currentObjectiveKey ? "Hide hint" : "Need a hint?"}
                  </button>
                )}
                {hintContext === currentObjectiveKey && currentStep.hint && <p className="mt-1 rounded bg-amber-500/5 p-2 text-[10px] text-amber-100">{currentStep.hint}</p>}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">
            <Check className="mr-1 inline h-3.5 w-3.5" /> Level complete. You can continue when ready.
          </div>
        )}

        {feedback?.contextKey === currentObjectiveKey && (
          <p className={`rounded-md px-2.5 py-2 text-[11px] ${feedback.ok ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-100"}`}>
            {feedback.ok ? "Step complete — " : "Not yet — "}{feedback.message}
          </p>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] text-zinc-500">Check your work after adding/configuring the requested items.</span>
          {currentStep?.objective.kind === "simulation-checkpoint" ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={runScenario} className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-cyan-600 px-2.5 text-[11px] font-semibold text-white hover:bg-cyan-500">
                <Play className="h-3 w-3" /> Run {level.requestsPerSec.toLocaleString()} req/s
              </button>
              <button type="button" onClick={checkCurrentStep} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800">
                <Check className="h-3 w-3" /> Check step
              </button>
            </div>
          ) : currentStep ? (
            <button type="button" onClick={checkCurrentStep} className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-cyan-600 px-2.5 text-[11px] font-semibold text-white hover:bg-cyan-500">
              <Check className="h-3 w-3" /> Check step
            </button>
          ) : levelIndex < 2 ? (
            <button type="button" onClick={startNextLevel} className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-500">
              Next level <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="text-[11px] font-semibold text-emerald-300">System tutorial complete</span>
          )}
        </footer>
      </div>
      <ConfirmDialog
        open={resetConfirmOpen}
        title="Restart this tutorial?"
        message={`This clears only the ${problemTitle} tutorial canvas and its step progress. Your other design tabs and references stay unchanged.`}
        confirmText="Restart tutorial"
        danger
        onConfirm={resetTutorial}
        onClose={() => setResetConfirmOpen(false)}
      />
    </section>
  );
}
