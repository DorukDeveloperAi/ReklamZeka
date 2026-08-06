export const PILOT_STEPS = ["session", "workspace", "source", "sync", "dashboard", "insights", "share"] as const;
export type PilotStep = (typeof PILOT_STEPS)[number];
export const PILOT_FEEDBACK = ["helpful", "unhelpful", "acted"] as const;
export type PilotFeedback = (typeof PILOT_FEEDBACK)[number];

export const PILOT_STEP_LABELS: Readonly<Record<PilotStep, string>> = {
  session: "Pilot girişi",
  workspace: "Çalışma alanı",
  source: "Veri kaynağı",
  sync: "İlk senkronizasyon",
  dashboard: "Genel bakış",
  insights: "İçgörü ve karar",
  share: "Rapor paylaşımı",
};

export function parsePilotStep(value: string | null | undefined): PilotStep {
  return PILOT_STEPS.includes(value as PilotStep) ? value as PilotStep : "session";
}

export function parsePilotFeedback(value: string | null | undefined): PilotFeedback | null {
  return PILOT_FEEDBACK.includes(value as PilotFeedback) ? value as PilotFeedback : null;
}

export function nextPilotStep(step: PilotStep): PilotStep | null {
  const index = PILOT_STEPS.indexOf(step);
  return PILOT_STEPS[index + 1] ?? null;
}

export function pilotProgress(step: PilotStep): number {
  return (PILOT_STEPS.indexOf(step) + 1) / PILOT_STEPS.length;
}
