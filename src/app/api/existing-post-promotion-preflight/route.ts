import { existingPostPromotionPreflightNotConfiguredResponse } from "@/server/existing-post-promotion-preflight-http";
import { existingPostPromotionCatalogNotConfiguredResponse } from "@/server/existing-post-promotion-catalog-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST() {
  return existingPostPromotionPreflightNotConfiguredResponse();
}

export function GET() {
  return existingPostPromotionCatalogNotConfiguredResponse();
}
