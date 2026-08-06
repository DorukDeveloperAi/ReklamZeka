export type PilotAccount = Readonly<{
  id: string;
  connectedAt: string;
  firstDashboardAt: string;
  lastSyncedAt: string;
}>;

export type PilotWorkspace = Readonly<{
  id: string;
  accounts: readonly PilotAccount[];
  feedback: Readonly<{ helpful: number; unhelpful: number; acted: number }>;
  openCriticalSecurityIncidents: number;
}>;

export type PilotReport = Readonly<{
  mode: "fixture_readiness" | "field_pilot";
  asOf: string;
  workspaceCount: number;
  accountCount: number;
  freshWithin60MinutesRate: number;
  medianActivationMinutes: number;
  usefulOrActedRate: number;
  openCriticalSecurityIncidents: number;
  thresholds: Readonly<{
    workspaces: boolean;
    accounts: boolean;
    freshness: boolean;
    activation: boolean;
    feedback: boolean;
    security: boolean;
  }>;
  verdict: "pass" | "fail";
}>;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function buildPilotReport(workspaces: readonly PilotWorkspace[], asOf: string, mode: PilotReport["mode"]): PilotReport {
  const accounts = workspaces.flatMap((workspace) => workspace.accounts);
  const fresh = accounts.filter((account) => Date.parse(asOf) - Date.parse(account.lastSyncedAt) <= 60 * 60_000).length;
  const activationMinutes = accounts.map((account) => (Date.parse(account.firstDashboardAt) - Date.parse(account.connectedAt)) / 60_000);
  const feedback = workspaces.reduce((sum, workspace) => ({
    helpful: sum.helpful + workspace.feedback.helpful,
    unhelpful: sum.unhelpful + workspace.feedback.unhelpful,
    acted: sum.acted + workspace.feedback.acted,
  }), { helpful: 0, unhelpful: 0, acted: 0 });
  const feedbackTotal = feedback.helpful + feedback.unhelpful + feedback.acted;
  const usefulRate = feedbackTotal === 0 ? 0 : (feedback.helpful + feedback.acted) / feedbackTotal;
  const incidents = workspaces.reduce((sum, workspace) => sum + workspace.openCriticalSecurityIncidents, 0);
  const thresholds = {
    workspaces: workspaces.length >= 3,
    accounts: accounts.length >= 10,
    freshness: accounts.length > 0 && fresh / accounts.length >= 0.95,
    activation: median(activationMinutes) <= 15,
    feedback: usefulRate >= 0.6,
    security: incidents === 0,
  };
  return {
    mode, asOf, workspaceCount: workspaces.length, accountCount: accounts.length,
    freshWithin60MinutesRate: accounts.length === 0 ? 0 : fresh / accounts.length,
    medianActivationMinutes: median(activationMinutes), usefulOrActedRate: usefulRate,
    openCriticalSecurityIncidents: incidents, thresholds,
    verdict: Object.values(thresholds).every(Boolean) ? "pass" : "fail",
  };
}
