import { existingPostPromotionPreflightNotConfiguredResponse } from "@/server/existing-post-promotion-preflight-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST() {
  return existingPostPromotionPreflightNotConfiguredResponse();
}
