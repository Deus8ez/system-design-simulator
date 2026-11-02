import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { safeLocalStorage } from "./safeStorage";
import type { TutorialLevelId, TutorialSimulationProof } from "@/types/tutorial";

export interface TutorialProgress {
  currentLevel: TutorialLevelId;
  completedStepIds: string[];
  lastSimulation?: TutorialSimulationProof;
}

export type TutorialHighlightTarget =
  | { kind: "palette" | "node"; componentId: string }
  | { kind: "control"; id: string; componentId?: string; occurrence?: number; componentInstance?: number }
  | { kind: "edge"; sourceComponentId: string; targetComponentId: string };

interface TutorialState {
  activeProblemId: string | null;
  isHidden: boolean;
  highlightTarget: TutorialHighlightTarget | null;
  progressByProblem: Record<string, TutorialProgress>;
  start: (problemId: string) => void;
  show: () => void;
  hide: () => void;
  setHighlightTarget: (target: TutorialHighlightTarget | null) => void;
  setLevel: (problemId: string, level: TutorialLevelId) => void;
  completeStep: (problemId: string, stepId: string) => void;
  recordSimulation: (problemId: string, proof: TutorialSimulationProof) => void;
  reset: (problemId: string) => void;
}

const emptyProgress = (): TutorialProgress => ({
  currentLevel: "low",
  completedStepIds: [],
});

export const useTutorialStore = create<TutorialState>()(
  persist(
    (set) => ({
      activeProblemId: null,
      isHidden: false,
      highlightTarget: null,
      progressByProblem: {},
      start: (problemId) =>
        set((state) => ({
          activeProblemId: problemId,
          isHidden: false,
          progressByProblem: {
            ...state.progressByProblem,
            [problemId]: state.progressByProblem[problemId] ?? emptyProgress(),
          },
        })),
      show: () => set({ isHidden: false }),
      hide: () => set({ isHidden: true }),
      setHighlightTarget: (highlightTarget) => set({ highlightTarget }),
      setLevel: (problemId, level) =>
        set((state) => ({
          progressByProblem: {
            ...state.progressByProblem,
            [problemId]: {
              ...(state.progressByProblem[problemId] ?? emptyProgress()),
              currentLevel: level,
            },
          },
        })),
      completeStep: (problemId, stepId) =>
        set((state) => {
          const progress = state.progressByProblem[problemId] ?? emptyProgress();
          if (progress.completedStepIds.includes(stepId)) return state;
          return {
            progressByProblem: {
              ...state.progressByProblem,
              [problemId]: {
                ...progress,
                completedStepIds: [...progress.completedStepIds, stepId],
              },
            },
          };
        }),
      recordSimulation: (problemId, proof) =>
        set((state) => {
          const progress = state.progressByProblem[problemId] ?? emptyProgress();
          return {
            progressByProblem: {
              ...state.progressByProblem,
              [problemId]: { ...progress, lastSimulation: proof },
            },
          };
        }),
      reset: (problemId) =>
        set((state) => ({
          progressByProblem: {
            ...state.progressByProblem,
            [problemId]: emptyProgress(),
          },
        })),
    }),
    {
      name: "systemsim-tutorial-progress",
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() => safeLocalStorage),
      migrate: (state) => state as TutorialState,
      partialize: (state) => ({
        activeProblemId: state.activeProblemId,
        isHidden: state.isHidden,
        progressByProblem: state.progressByProblem,
      }) as TutorialState,
    },
  ),
);
