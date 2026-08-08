import { describe, expect, it } from "vitest";
import { extractMetaAdContent } from "@/domain/meta/content/extract";

describe("Meta effective ad content extraction", () => {
  it("keeps effective copy, CTA, destination and existing-post provenance explicit", () => {
    const result = extractMetaAdContent({
      id: "ad_fixture_1",
      adset_id: "set_fixture_1",
      campaign_id: "campaign_fixture_1",
      effective_status: "ACTIVE",
      creative: {
        id: "creative_fixture_1",
        name: "Existing post",
        body: "Graph effective primary text",
        title: "Graph effective headline",
        effective_object_story_id: "page_fixture_1_post_fixture_1",
        object_story_id: "page_fixture_1_post_old",
        instagram_permalink_url: "https://www.instagram.com/p/fixture/",
        object_story_spec: {
          page_id: "page_fixture_1",
          instagram_actor_id: "ig_fixture_1",
          link_data: {
            message: "Story fallback",
            name: "Story headline",
            description: "Story description",
            caption: "example.invalid",
            link: "https://fallback.example.invalid",
            call_to_action: {
              type: "LEARN_MORE",
              value: { link: "https://cta.example.invalid/landing" },
            },
          },
        },
      },
    });

    expect(result.adContext).toEqual({
      externalAdId: "ad_fixture_1",
      externalAdSetId: "set_fixture_1",
      externalCampaignId: "campaign_fixture_1",
      effectiveStatus: "ACTIVE",
    });
    expect(result.creative).toMatchObject({
      sourceType: "existing_post",
      primaryText: "Graph effective primary text",
      headline: "Graph effective headline",
      description: "Story description",
      caption: "example.invalid",
      callToActionType: "LEARN_MORE",
      destinationUrl: "https://cta.example.invalid/landing",
      creativeFormat: "LINK",
    });
    expect(result.creative.contentProvenance).toMatchObject({
      primaryText: { path: "creative.body", selection: "effective" },
      description: { path: "creative.object_story_spec.link_data.description", selection: "story_fallback" },
      destinationUrl: { path: "creative.object_story_spec.link_data.call_to_action.value.link", selection: "story_fallback" },
    });
    expect(result.post).toMatchObject({
      externalPostId: "page_fixture_1_post_fixture_1",
      platform: "facebook",
      identitySource: "creative.effective_object_story_id",
      actorPageExternalId: "page_fixture_1",
      actorInstagramExternalId: "ig_fixture_1",
      permalink: "https://www.instagram.com/p/fixture/",
    });
    expect(result.post?.identities).toEqual([
      { kind: "object_story", externalId: "page_fixture_1_post_fixture_1", sourcePath: "creative.effective_object_story_id", effective: true },
      { kind: "object_story", externalId: "page_fixture_1_post_old", sourcePath: "creative.object_story_id", effective: false },
    ]);
    expect(result.issues).toEqual([]);
  });

  it("extracts video fallback copy and media identity without inventing absent fields", () => {
    const result = extractMetaAdContent({
      status: "PAUSED",
      creative: {
        id: "creative_fixture_video",
        effective_object_story_id: "page_fixture_video_post_fixture_video",
        object_story_spec: {
          page_id: "page_fixture_video",
          video_data: {
            video_id: "video_fixture_1",
            message: "Video message",
            title: "Video title",
            link_description: "Video description",
            call_to_action: { type: "CONTACT_US", value: { link: "https://video.example.invalid" } },
          },
        },
      },
    });

    expect(result.adContext.effectiveStatus).toBe("PAUSED");
    expect(result.creative).toMatchObject({
      primaryText: "Video message",
      headline: "Video title",
      description: "Video description",
      caption: null,
      creativeFormat: "VIDEO",
    });
    expect(result.post).toMatchObject({
      externalMediaId: "video_fixture_1",
      mediaType: "VIDEO",
    });
  });

  it("preserves all dynamic candidates and carousel groups instead of selecting a winner", () => {
    const payload = {
      id: "ad_fixture_dynamic",
      creative: {
        id: "creative_fixture_dynamic",
        asset_feed_spec: {
          bodies: [{ text: "Body A", adlabels: "prospecting" }, { text: "Body B" }],
          titles: [{ text: "Title A" }, { text: "Title B" }],
          descriptions: [{ text: "Description A" }],
          call_to_action_types: ["LEARN_MORE", "SIGN_UP"],
          link_urls: [{ website_url: "https://a.example.invalid" }, { website_url: "https://b.example.invalid" }],
        },
        object_story_spec: {
          page_id: "page_fixture_dynamic",
          link_data: {
            child_attachments: [
              { name: "Card one", description: "First", link: "https://card-1.example.invalid", call_to_action: { type: "LEARN_MORE" } },
              { name: "Card two", link: "https://card-2.example.invalid" },
            ],
          },
        },
      },
    };
    const before = structuredClone(payload);
    const first = extractMetaAdContent(payload);
    const second = extractMetaAdContent(payload);

    expect(payload).toEqual(before);
    expect(second).toEqual(first);
    expect(first.creative.sourceType).toBe("dynamic_asset_feed");
    expect(first.creative.primaryText).toBeNull();
    expect(first.creative.dynamicVariants).toHaveLength(15);
    expect(first.creative.dynamicVariants).toContainEqual({
      kind: "primary_text",
      value: "Body A",
      sourcePath: "creative.asset_feed_spec.bodies[0]",
      position: 0,
      groupKey: null,
      assetLabel: "prospecting",
    });
    expect(first.creative.dynamicVariants).toContainEqual(expect.objectContaining({
      kind: "headline",
      value: "Card two",
      groupKey: "carousel:1",
    }));
    expect(first.issues).toContainEqual({ code: "dynamic_selection_unresolved" });
  });

  it("prefers explicit Instagram identity and preserves alternate object-story identity", () => {
    const result = extractMetaAdContent({
      creative: {
        id: "creative_fixture_instagram",
        effective_instagram_story_id: "ig_story_fixture_1",
        effective_instagram_media_id: "ig_media_fixture_1",
        effective_object_story_id: "page_fixture_2_post_fixture_2",
        instagram_permalink_url: "https://www.instagram.com/p/fixture-2/",
        object_story_spec: { instagram_actor_id: "ig_actor_fixture_2" },
      },
    });

    expect(result.post).toMatchObject({
      externalPostId: "ig_story_fixture_1",
      platform: "instagram",
      externalMediaId: "ig_media_fixture_1",
      mediaType: "INSTAGRAM_MEDIA",
    });
    expect(result.post?.identities).toHaveLength(2);
  });

  it("reports bounded unknown states for missing or malformed content", () => {
    expect(extractMetaAdContent({ id: "ad_without_creative" })).toMatchObject({
      post: null,
      issues: [{ code: "missing_creative" }, { code: "copy_unavailable" }],
    });

    const permalinkWithoutIdentity = extractMetaAdContent({
      creative: {
        id: "creative_without_post_identity",
        instagram_permalink_url: "https://www.instagram.com/p/unresolved/",
        body: 42,
        asset_feed_spec: { bodies: [{ text: "" }, null] },
      },
    });
    expect(permalinkWithoutIdentity.creative.primaryText).toBeNull();
    expect(permalinkWithoutIdentity.post).toBeNull();
    expect(permalinkWithoutIdentity.issues).toEqual([
      { code: "copy_unavailable" },
      { code: "post_identity_unresolved" },
    ]);
  });
});
