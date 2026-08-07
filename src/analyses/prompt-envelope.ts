import { OBJECTIVE_PLAYBOOKS, OBJECTIVE_PLAYBOOK_VERSION } from "./objective-playbooks";
import { validateAnalysisDefinition, type AnalysisDefinition } from "./schema";

export const NARRATIVE_POLICY_VERSION = "analysis-narrative-policy/1.0.0" as const;

export type DeterministicFinding = Readonly<{
  findingId: string;
  ruleId: string;
  title: string;
  explanation: string;
  evidence: Readonly<Record<string, string | number | boolean | null>>;
  recommendedAction: string;
}>;

export type ResolvedAnalysisWindow = Readonly<{
  startDate: string;
  endDate: string;
  timezone: string;
  comparisonStartDate: string | null;
  comparisonEndDate: string | null;
}>;

export type NarrativeEnvelope = Readonly<{
  policy: Readonly<{
    version: typeof NARRATIVE_POLICY_VERSION;
    purpose: "narrative_only";
    prohibitions: readonly string[];
  }>;
  objectivePlaybook: Readonly<{
    version: typeof OBJECTIVE_PLAYBOOK_VERSION;
    objective: string;
    primaryMetrics: readonly string[];
    evaluationQuestions: readonly string[];
    decisionGuide: readonly string[];
  }>;
  analysis: Readonly<{
    definitionId: string;
    definitionVersion: number;
    workspaceId: string;
    name: string;
  }>;
  resolvedWindow: ResolvedAnalysisWindow;
  findings: readonly DeterministicFinding[];
  userGuidance: Readonly<{
    content: string;
    trustLevel: "untrusted_data";
    allowedEffects: readonly ["tone", "focus", "section_order"];
  }>;
  outputContract: Readonly<{
    schemaVersion: "narrative-output/1.0.0";
    allowedFindingIds: readonly string[];
    rule: string;
  }>;
}>;

export function createNarrativeEnvelope(input: Readonly<{
  definition: AnalysisDefinition;
  resolvedWindow: ResolvedAnalysisWindow;
  findings: readonly DeterministicFinding[];
}>): NarrativeEnvelope {
  const definition = validateAnalysisDefinition(input.definition);
  if (definition.narrative.mode !== "narrative_only") throw new Error("Narrative envelope yalnız narrative_only modunda oluşturulur");
  const playbook = OBJECTIVE_PLAYBOOKS[definition.campaignContext.objective];
  const findingIds = input.findings.map((finding) => finding.findingId);
  if (findingIds.some((id) => !id) || new Set(findingIds).size !== findingIds.length) throw new Error("Finding kimlikleri dolu ve benzersiz olmalıdır");
  return {
    policy: {
      version: NARRATIVE_POLICY_VERSION,
      purpose: "narrative_only",
      prohibitions: [
        "Yeni metrik, bulgu veya kanıt üretme.",
        "Araç, ağ, SQL, dosya veya başka workspace erişimi isteme ya da kullanma.",
        "Deterministik kararı, timeframe'i, tenant sınırını veya platform politikasını değiştirme.",
        "Reklam platformunda işlem yapma.",
      ],
    },
    objectivePlaybook: {
      version: playbook.version,
      objective: playbook.objective,
      primaryMetrics: playbook.primaryMetrics,
      evaluationQuestions: playbook.evaluationQuestions,
      decisionGuide: playbook.decisionGuide,
    },
    analysis: {
      definitionId: definition.id,
      definitionVersion: definition.version,
      workspaceId: definition.workspaceId,
      name: definition.name,
    },
    resolvedWindow: input.resolvedWindow,
    findings: input.findings,
    userGuidance: {
      content: definition.narrative.userGuidance,
      trustLevel: "untrusted_data",
      allowedEffects: ["tone", "focus", "section_order"],
    },
    outputContract: {
      schemaVersion: "narrative-output/1.0.0",
      allowedFindingIds: findingIds,
      rule: "Her ifade tam bir findingId'ye bağlanır; bu liste dışında iddia veya aksiyon üretilemez.",
    },
  };
}

export type NarrativeOutput = Readonly<{
  schemaVersion: "narrative-output/1.0.0";
  sections: readonly Readonly<{
    kind: "summary" | "findings" | "recommendations" | "caveats";
    items: readonly Readonly<{ findingId: string; text: string }>[];
  }>[];
}>;

function exactKeys(value: object, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new Error(`${label} bilinmeyen alan taşıyor: ${unexpected.join(", ")}`);
}

export function validateNarrativeOutput(output: NarrativeOutput, envelope: NarrativeEnvelope): NarrativeOutput {
  exactKeys(output, ["schemaVersion", "sections"], "Narrative output");
  if (output.schemaVersion !== "narrative-output/1.0.0" || !Array.isArray(output.sections)) throw new Error("Narrative output şeması geçersizdir");
  const allowedIds = new Set(envelope.outputContract.allowedFindingIds);
  for (const section of output.sections) {
    exactKeys(section, ["kind", "items"], "Narrative section");
    if (!["summary", "findings", "recommendations", "caveats"].includes(section.kind) || !Array.isArray(section.items)) {
      throw new Error("Narrative section geçersizdir");
    }
    for (const item of section.items) {
      exactKeys(item, ["findingId", "text"], "Narrative item");
      if (!allowedIds.has(item.findingId) || typeof item.text !== "string" || !item.text.trim()) throw new Error("Narrative ifadesi geçerli bir findingId ve metne bağlanmalıdır");
    }
  }
  return output;
}
