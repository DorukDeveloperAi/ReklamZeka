import {
  assertPromotionRegistryLink,
  audiencePresetVersionRef,
  createAudiencePresetRevision,
  createPromotionTemplateBinding,
  createPromotionTemplateRevision,
  promotionTemplateVersionRef,
  type AudiencePresetRevision,
  type PromotionTemplateBinding,
  type PromotionTemplateRevision,
} from "@/domain/meta/promotion/promotion-template";

export type PromotionRegistryReferences = Readonly<{
  audiencePresetRef: string;
  audiencePresetVersionRef: string;
  promotionTemplateRef: string;
  promotionTemplateVersionRef: string;
  bindingRef: string;
  accountRef: string;
  actorRef: string;
  internalCategoryRefs: readonly string[];
  campaignRef: string | null;
}>;

export type PromotionRegistryRepository = Readonly<{
  publish(input: Readonly<{
    preset: AudiencePresetRevision;
    template: PromotionTemplateRevision;
    binding: PromotionTemplateBinding;
  }>): Promise<Readonly<{ outcome: "inserted" | "unchanged"; refs: PromotionRegistryReferences }>>;
  readRefs(bindingRef: string): Promise<PromotionRegistryReferences | null>;
}>;

export class PromotionRegistryServiceError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "integrity_rejected") {
    super(`Promotion registry service reddedildi: ${code}`);
    this.name = "PromotionRegistryServiceError";
  }
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new PromotionRegistryServiceError("invalid_input");
  }
}

function canonical(input: Readonly<{
  preset: AudiencePresetRevision;
  template: PromotionTemplateRevision;
  binding: PromotionTemplateBinding;
}>): Readonly<{
  preset: AudiencePresetRevision;
  template: PromotionTemplateRevision;
  binding: PromotionTemplateBinding;
}> {
  try {
    const { presetHash, ...presetInput } = input.preset;
    const preset = createAudiencePresetRevision(presetInput);
    const { templateHash, ...templateInput } = input.template;
    const template = createPromotionTemplateRevision(templateInput);
    const { bindingHash, ...bindingInput } = input.binding;
    const binding = createPromotionTemplateBinding(bindingInput, template);
    if (preset.presetHash !== presetHash || template.templateHash !== templateHash
      || binding.bindingHash !== bindingHash) throw new Error("hash_mismatch");
    // The effective instant proves the three immutable documents are linked,
    // while still permitting publication of a future or historical binding.
    assertPromotionRegistryLink(preset, template, binding, binding.effectiveFrom);
    return Object.freeze({ preset, template, binding });
  } catch {
    throw new PromotionRegistryServiceError("integrity_rejected");
  }
}

/**
 * Server-private publication/read boundary. It has no action, approval, Meta,
 * targeting-generation, targeting-mutation, or creative operation.
 */
export class PromotionRegistryService {
  constructor(
    private readonly repository: PromotionRegistryRepository,
    private readonly workspaceRef: string,
  ) {
    if (!/^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(workspaceRef)) {
      throw new PromotionRegistryServiceError("invalid_input");
    }
  }

  async publish(input: Readonly<{
    workspaceRef: string;
    preset: AudiencePresetRevision;
    template: PromotionTemplateRevision;
    binding: PromotionTemplateBinding;
  }>): Promise<Readonly<{ outcome: "inserted" | "unchanged"; refs: PromotionRegistryReferences }>> {
    exact(input, ["workspaceRef", "preset", "template", "binding"]);
    if (input.workspaceRef !== this.workspaceRef
      || input.preset.workspaceRef !== this.workspaceRef
      || input.template.workspaceRef !== this.workspaceRef
      || input.binding.workspaceRef !== this.workspaceRef) {
      throw new PromotionRegistryServiceError("workspace_scope_mismatch");
    }
    return this.repository.publish(canonical(input));
  }

  async read(input: Readonly<{ workspaceRef: string; bindingRef: string }>): Promise<PromotionRegistryReferences | null> {
    exact(input, ["workspaceRef", "bindingRef"]);
    if (input.workspaceRef !== this.workspaceRef) {
      throw new PromotionRegistryServiceError("workspace_scope_mismatch");
    }
    if (!/^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(input.bindingRef)) {
      throw new PromotionRegistryServiceError("invalid_input");
    }
    return this.repository.readRefs(input.bindingRef);
  }
}

export function publicPromotionRegistryReferences(input: Readonly<{
  preset: AudiencePresetRevision;
  template: PromotionTemplateRevision;
  binding: PromotionTemplateBinding;
}>): PromotionRegistryReferences {
  return Object.freeze({
    audiencePresetRef: input.preset.presetRef,
    audiencePresetVersionRef: audiencePresetVersionRef(input.preset),
    promotionTemplateRef: input.template.templateRef,
    promotionTemplateVersionRef: promotionTemplateVersionRef(input.template),
    bindingRef: input.binding.bindingRef,
    accountRef: input.binding.accountRef,
    actorRef: input.binding.actor.actorRef,
    internalCategoryRefs: Object.freeze([...input.binding.internalCategoryRefs]),
    campaignRef: input.binding.campaignRef,
  });
}
