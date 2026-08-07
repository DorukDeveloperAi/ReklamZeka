export type MetaContentSource = Readonly<{
  path: string;
  selection: "effective" | "story_fallback" | "identity";
}>;

export type MetaDynamicTextVariant = Readonly<{
  kind: "primary_text" | "headline" | "description" | "caption" | "call_to_action" | "destination";
  value: string;
  sourcePath: string;
  position: number;
  groupKey: string | null;
  assetLabel: string | null;
}>;

export type MetaPostIdentity = Readonly<{
  kind: "instagram_story" | "object_story";
  externalId: string;
  sourcePath: string;
  effective: boolean;
}>;

export type MetaAdContentExtraction = Readonly<{
  adContext: Readonly<{
    externalAdId: string | null;
    externalAdSetId: string | null;
    externalCampaignId: string | null;
    effectiveStatus: string | null;
  }>;
  creative: Readonly<{
    externalCreativeId: string | null;
    name: string | null;
    sourceType: "existing_post" | "dynamic_asset_feed" | "object_story_spec" | "unknown";
    primaryText: string | null;
    headline: string | null;
    description: string | null;
    caption: string | null;
    callToActionType: string | null;
    destinationUrl: string | null;
    creativeFormat: string | null;
    contentProvenance: Readonly<Partial<Record<
      "primaryText" | "headline" | "description" | "caption" | "callToActionType" | "destinationUrl",
      MetaContentSource
    >>>;
    dynamicVariants: readonly MetaDynamicTextVariant[];
  }>;
  post: Readonly<{
    externalPostId: string;
    platform: "facebook" | "instagram";
    identitySource: string;
    identities: readonly MetaPostIdentity[];
    actorPageExternalId: string | null;
    actorInstagramExternalId: string | null;
    externalMediaId: string | null;
    mediaType: string | null;
    permalink: string | null;
    provenance: Readonly<Record<string, string>>;
  }> | null;
  issues: readonly Readonly<{
    code: "missing_creative" | "copy_unavailable" | "dynamic_selection_unresolved" | "post_identity_unresolved";
  }>[];
}>;

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function read(root: JsonObject | null, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    const currentObject = object(current);
    if (!currentObject) return undefined;
    current = currentObject[segment];
  }
  return current;
}

type Candidate = Readonly<{ value: string | null; path: string; selection: MetaContentSource["selection"] }>;

function first(candidates: readonly Candidate[]): Readonly<{ value: string | null; source?: MetaContentSource }> {
  const selected = candidates.find((candidate) => candidate.value !== null);
  return selected
    ? { value: selected.value, source: { path: selected.path, selection: selected.selection } }
    : { value: null };
}

function storyData(story: JsonObject | null): Readonly<{ data: JsonObject | null; path: string | null; format: string | null }> {
  const options = [
    ["link_data", "LINK"],
    ["video_data", "VIDEO"],
    ["photo_data", "PHOTO"],
    ["template_data", "TEMPLATE"],
    ["text_data", "TEXT"],
  ] as const;
  for (const [key, format] of options) {
    const data = object(story?.[key]);
    if (data) return { data, path: `creative.object_story_spec.${key}`, format };
  }
  return { data: null, path: null, format: null };
}

function variantText(entry: unknown, keys: readonly string[]): string | null {
  if (typeof entry === "string") return text(entry);
  const item = object(entry);
  for (const key of keys) {
    const value = text(item?.[key]);
    if (value) return value;
  }
  return null;
}

function assetLabel(entry: unknown): string | null {
  const item = object(entry);
  const direct = text(item?.adlabels) ?? text(item?.label);
  if (direct) return direct;
  const names = array(item?.adlabels)
    .map((label) => text(object(label)?.name) ?? text(label))
    .filter((name): name is string => name !== null);
  return names.length > 0 ? names.join(",") : null;
}

function pushVariants(
  target: MetaDynamicTextVariant[],
  feed: JsonObject | null,
  field: string,
  kind: MetaDynamicTextVariant["kind"],
  keys: readonly string[],
): void {
  array(feed?.[field]).forEach((entry, position) => {
    const value = variantText(entry, keys);
    if (!value) return;
    target.push({
      kind,
      value,
      sourcePath: `creative.asset_feed_spec.${field}[${position}]`,
      position,
      groupKey: null,
      assetLabel: assetLabel(entry),
    });
  });
}

function dynamicVariants(feed: JsonObject | null, story: JsonObject | null): readonly MetaDynamicTextVariant[] {
  const result: MetaDynamicTextVariant[] = [];
  pushVariants(result, feed, "bodies", "primary_text", ["text"]);
  pushVariants(result, feed, "titles", "headline", ["text"]);
  pushVariants(result, feed, "descriptions", "description", ["text"]);
  pushVariants(result, feed, "captions", "caption", ["text"]);
  pushVariants(result, feed, "call_to_action_types", "call_to_action", ["type", "text"]);
  pushVariants(result, feed, "link_urls", "destination", ["website_url", "url", "display_url"]);

  const storyCollection = object(story?.link_data)
    ? { value: object(story?.link_data), path: "link_data" }
    : { value: object(story?.template_data), path: "template_data" };
  const linkData = storyCollection.value;
  array(linkData?.child_attachments).forEach((entry, position) => {
    const card = object(entry);
    const groupKey = `carousel:${position}`;
    const fields: readonly Readonly<{
      key: string;
      kind: MetaDynamicTextVariant["kind"];
      path: string;
    }>[] = [
      { key: "name", kind: "headline", path: "name" },
      { key: "description", kind: "description", path: "description" },
      { key: "caption", kind: "caption", path: "caption" },
      { key: "link", kind: "destination", path: "link" },
    ];
    for (const field of fields) {
      const value = text(card?.[field.key]);
      if (!value) continue;
      result.push({
        kind: field.kind,
        value,
        sourcePath: `creative.object_story_spec.${storyCollection.path}.child_attachments[${position}].${field.path}`,
        position,
        groupKey,
        assetLabel: null,
      });
    }
    const cta = text(read(card, ["call_to_action", "type"]));
    if (cta) result.push({
      kind: "call_to_action",
      value: cta,
      sourcePath: `creative.object_story_spec.${storyCollection.path}.child_attachments[${position}].call_to_action.type`,
      position,
      groupKey,
      assetLabel: null,
    });
  });
  return result;
}

function extractPost(creative: JsonObject, story: JsonObject | null): MetaAdContentExtraction["post"] {
  const identities: MetaPostIdentity[] = [];
  const instagramStory = text(creative.effective_instagram_story_id);
  const effectiveStory = text(creative.effective_object_story_id);
  const configuredStory = text(creative.object_story_id);
  if (instagramStory) identities.push({
    kind: "instagram_story",
    externalId: instagramStory,
    sourcePath: "creative.effective_instagram_story_id",
    effective: true,
  });
  if (effectiveStory) identities.push({
    kind: "object_story",
    externalId: effectiveStory,
    sourcePath: "creative.effective_object_story_id",
    effective: true,
  });
  if (configuredStory && configuredStory !== effectiveStory) identities.push({
    kind: "object_story",
    externalId: configuredStory,
    sourcePath: "creative.object_story_id",
    effective: false,
  });
  const canonical = identities[0];
  if (!canonical) return null;

  const pageActor = text(story?.page_id) ?? text(creative.actor_id);
  const instagramActor = text(story?.instagram_actor_id);
  const instagramMedia = text(creative.effective_instagram_media_id);
  const data = storyData(story);
  const videoId = text(data.data?.video_id);
  const mediaId = instagramMedia ?? videoId;
  const permalink = text(creative.instagram_permalink_url);
  const provenance: Record<string, string> = {
    externalPostId: canonical.sourcePath,
  };
  if (pageActor) provenance.actorPageExternalId = story?.page_id ? "creative.object_story_spec.page_id" : "creative.actor_id";
  if (instagramActor) provenance.actorInstagramExternalId = "creative.object_story_spec.instagram_actor_id";
  if (mediaId) provenance.externalMediaId = instagramMedia
    ? "creative.effective_instagram_media_id"
    : `${data.path}.video_id`;
  if (permalink) provenance.permalink = "creative.instagram_permalink_url";

  return {
    externalPostId: canonical.externalId,
    platform: canonical.kind === "instagram_story" ? "instagram" : "facebook",
    identitySource: canonical.sourcePath,
    identities,
    actorPageExternalId: pageActor,
    actorInstagramExternalId: instagramActor,
    externalMediaId: mediaId,
    mediaType: instagramMedia ? "INSTAGRAM_MEDIA" : videoId ? "VIDEO" : data.format,
    permalink,
    provenance,
  };
}

/**
 * Normalizes a Graph `/{ad-account}/ads?fields=...,creative{...}` record.
 *
 * This is deliberately a pure read/extraction boundary: it does not infer missing
 * actor/post identity, choose a winning dynamic asset, retain raw payloads or log IDs.
 */
export function extractMetaAdContent(payload: unknown): MetaAdContentExtraction {
  const ad = object(payload) ?? {};
  const creative = object(ad.creative);
  const emptyCreative: MetaAdContentExtraction["creative"] = {
    externalCreativeId: null,
    name: null,
    sourceType: "unknown",
    primaryText: null,
    headline: null,
    description: null,
    caption: null,
    callToActionType: null,
    destinationUrl: null,
    creativeFormat: null,
    contentProvenance: {},
    dynamicVariants: [],
  };
  const adContext = {
    externalAdId: text(ad.id),
    externalAdSetId: text(ad.adset_id),
    externalCampaignId: text(ad.campaign_id),
    effectiveStatus: text(ad.effective_status) ?? text(ad.status),
  };
  if (!creative) return {
    adContext,
    creative: emptyCreative,
    post: null,
    issues: [{ code: "missing_creative" }, { code: "copy_unavailable" }],
  };

  const story = object(creative.object_story_spec);
  const data = storyData(story);
  const feed = object(creative.asset_feed_spec);
  const variants = dynamicVariants(feed, story);
  const cta = object(data.data?.call_to_action);

  const primaryText = first([
    { value: text(creative.body), path: "creative.body", selection: "effective" },
    { value: text(data.data?.message), path: `${data.path}.message`, selection: "story_fallback" },
    { value: text(data.data?.caption), path: `${data.path}.caption`, selection: "story_fallback" },
  ]);
  const headline = first([
    { value: text(creative.title), path: "creative.title", selection: "effective" },
    { value: text(data.data?.name) ?? text(data.data?.title), path: `${data.path}.${data.data?.name ? "name" : "title"}`, selection: "story_fallback" },
  ]);
  const description = first([
    { value: text(creative.link_description), path: "creative.link_description", selection: "effective" },
    { value: text(data.data?.description), path: `${data.path}.description`, selection: "story_fallback" },
    { value: text(data.data?.link_description), path: `${data.path}.link_description`, selection: "story_fallback" },
  ]);
  const caption = first([
    { value: text(creative.caption), path: "creative.caption", selection: "effective" },
    { value: text(data.data?.caption), path: `${data.path}.caption`, selection: "story_fallback" },
  ]);
  const callToActionType = first([
    { value: text(creative.call_to_action_type), path: "creative.call_to_action_type", selection: "effective" },
    { value: text(cta?.type), path: `${data.path}.call_to_action.type`, selection: "story_fallback" },
  ]);
  const destinationUrl = first([
    { value: text(creative.link_url), path: "creative.link_url", selection: "effective" },
    { value: text(read(cta, ["value", "link"])), path: `${data.path}.call_to_action.value.link`, selection: "story_fallback" },
    { value: text(data.data?.link), path: `${data.path}.link`, selection: "story_fallback" },
  ]);
  const sources: MetaAdContentExtraction["creative"]["contentProvenance"] = {
    ...(primaryText.source ? { primaryText: primaryText.source } : {}),
    ...(headline.source ? { headline: headline.source } : {}),
    ...(description.source ? { description: description.source } : {}),
    ...(caption.source ? { caption: caption.source } : {}),
    ...(callToActionType.source ? { callToActionType: callToActionType.source } : {}),
    ...(destinationUrl.source ? { destinationUrl: destinationUrl.source } : {}),
  };
  const post = extractPost(creative, story);
  const hasCopy = [primaryText.value, headline.value, description.value, caption.value].some(Boolean) || variants.length > 0;
  const issues: MetaAdContentExtraction["issues"][number][] = [];
  if (!hasCopy) issues.push({ code: "copy_unavailable" });
  if (variants.length > 0) issues.push({ code: "dynamic_selection_unresolved" });
  if (text(creative.instagram_permalink_url) && !post) issues.push({ code: "post_identity_unresolved" });

  return {
    adContext,
    creative: {
      externalCreativeId: text(creative.id),
      name: text(creative.name),
      sourceType: post ? "existing_post" : variants.length > 0 ? "dynamic_asset_feed" : story ? "object_story_spec" : "unknown",
      primaryText: primaryText.value,
      headline: headline.value,
      description: description.value,
      caption: caption.value,
      callToActionType: callToActionType.value,
      destinationUrl: destinationUrl.value,
      creativeFormat: text(creative.object_type) ?? data.format,
      contentProvenance: sources,
      dynamicVariants: variants,
    },
    post,
    issues,
  };
}
