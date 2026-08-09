import {
  PROMOTION_TEMPLATE_SELECTOR_VERSION,
  PromotionTemplateSelectorError,
  assertPromotionTemplateSelectorInput,
  dryRunPromotionTemplateSelection,
  type PromotionTemplateSelectionDryRun,
  type PromotionTemplateSelectorCandidate,
  type PromotionTemplateSelectorInput,
} from "@/domain/meta/promotion/promotion-template-selector";

export type PublishedPromotionTemplateCatalog = Readonly<{
  listPublished(input: Readonly<{ workspaceRef: string; evaluatedAt: string }>): Promise<readonly PromotionTemplateSelectorCandidate[]>;
}>;

export class PromotionTemplateSelectorService {
  constructor(
    private readonly catalog: PublishedPromotionTemplateCatalog,
    private readonly workspaceRef: string,
  ) {
    if (!/^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(workspaceRef)) {
      throw new PromotionTemplateSelectorError("invalid_input");
    }
  }

  /** Read-only authoring preview. This boundary cannot publish, persist or create an action proposal. */
  async dryRun(input: PromotionTemplateSelectorInput): Promise<PromotionTemplateSelectionDryRun> {
    assertPromotionTemplateSelectorInput(input);
    if (input.version !== PROMOTION_TEMPLATE_SELECTOR_VERSION || input.workspaceRef !== this.workspaceRef) {
      throw new PromotionTemplateSelectorError("invalid_input");
    }
    const candidates = await this.catalog.listPublished({
      workspaceRef: this.workspaceRef,
      evaluatedAt: input.evaluatedAt,
    });
    return dryRunPromotionTemplateSelection(input, candidates);
  }
}
