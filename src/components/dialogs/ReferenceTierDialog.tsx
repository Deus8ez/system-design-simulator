"use client";

import { Eye, X } from "lucide-react";
import { ModalShell } from "@/components/dialogs/ModalShell";
import type { TutorialLevelId } from "@/types/tutorial";

interface ReferenceTierDialogProps {
  open: boolean;
  problemTitle: string;
  onClose: () => void;
  onSelect: (tier: TutorialLevelId) => void;
}

const tiers: Array<{ id: TutorialLevelId; label: string; detail: string }> = [
  { id: "low", label: "Low load", detail: "The essential architecture for early traffic." },
  { id: "medium", label: "Medium load", detail: "A more capable design for growing demand." },
  { id: "high", label: "High load", detail: "A scaled architecture with additional boundaries." },
];

export function ReferenceTierDialog({ open, problemTitle, onClose, onSelect }: ReferenceTierDialogProps) {
  return (
    <ModalShell open={open} onClose={onClose} panelClassName="max-w-md p-5" ariaLabel={`Choose ${problemTitle} reference load`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Complete design · {problemTitle}</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">Choose a traffic tier to open its reference in a separate read-only canvas tab.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close load selector" className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-2">
        {tiers.map((tier) => (
          <button
            key={tier.id}
            type="button"
            onClick={() => onSelect(tier.id)}
            className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-left transition-colors hover:border-cyan-500/40 hover:bg-cyan-500/5"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-300"><Eye className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-zinc-100">{tier.label}</span>
              <span className="mt-0.5 block text-[10px] text-zinc-400">{tier.detail}</span>
            </span>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}
