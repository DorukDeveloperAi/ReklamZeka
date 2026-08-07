import { NextResponse } from "next/server";
import { ConnectorError } from "@/connectors/contract";
import { discoverMetaInventory } from "@/connectors/meta/inventory";
import type { MetaInventoryApiError } from "@/connectors/meta/types";

export const dynamic = "force-dynamic";

function publicError(code: MetaInventoryApiError["error"]["code"], message: string, status: number) {
  return NextResponse.json<MetaInventoryApiError>({ error: { code, message } }, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET() {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  if (!token) return publicError("not_configured", "Meta bağlantısı henüz yapılandırılmadı", 503);

  try {
    const inventory = await discoverMetaInventory({
      token,
      securityStatus: process.env.META_TOKEN_SECURITY_STATUS === "temporary_exposed" ? "temporary_exposed" : "standard",
    });
    return NextResponse.json(inventory, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-ReklamZeka-Access-Mode": "read-only",
      },
    });
  } catch (error) {
    if (error instanceof ConnectorError) {
      if (error.code === "authentication") return publicError("authentication", error.message, 401);
      if (error.code === "rate_limited") return publicError("rate_limited", error.message, 429);
    }
    return publicError("upstream", "Meta envanteri şu anda yenilenemedi", 502);
  }
}
