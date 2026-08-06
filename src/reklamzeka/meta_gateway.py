"""Resmî Meta Ads MCP erişim katmanı (tek geçiş noktası) — MASTER §3, risk §9.1.

Tüm Meta okuma/yazma bu modülden geçer. Böylece resmî MCP'de boşluk/gating
çıkarsa Pipeboard/SDK'ya geçiş tek modül değişimidir.

Güvenlik kanonu (MASTER §6):
- create çağrılarında status her zaman AÇIKÇA PAUSED gönderilir,
- ACTIVE status'lü create kod seviyesinde engellidir (guardrails.assert_paused_create),
- her yazma sonrası geri-okuma ile status doğrulanır (MCP'nin PAUSED
  varsayılanına GÜVENİLMEZ).

Kimlik doğrulama: resmî MCP OAuth ile çalışır (reklamveren yolu). İnteraktif
oturumda `claude mcp add` / MCP istemci konfigürasyonu ile bağlanır; headless
koşularda erişim token'ı META_MCP_ACCESS_TOKEN ortam değişkeninden okunur.
"""

from __future__ import annotations

import os
from typing import Any

DEFAULT_ENDPOINT = "https://mcp.facebook.com/ads"

WRITE_TOOL_HINTS = ("create", "update", "activate", "edit", "delete")


class MetaGatewayError(RuntimeError):
    pass


class MetaGateway:
    """Resmî Meta Ads MCP'ye ince istemci.

    Faz 0 kapsamı: bağlantı + araç envanteri dökümü (list_tools) + salt-okuma
    çağrıları. Yazma yolu Faz 2'de guardrails ile birlikte açılır; şimdilik
    her yazma çağrısı dry_run=False ise reddedilir.
    """

    def __init__(self, endpoint: str = DEFAULT_ENDPOINT, token: str | None = None,
                 dry_run: bool = True):
        self.endpoint = endpoint
        self.token = token or os.environ.get("META_MCP_ACCESS_TOKEN")
        self.dry_run = dry_run

    def _require_token(self) -> str:
        if not self.token:
            raise MetaGatewayError(
                "META_MCP_ACCESS_TOKEN yok — resmî Meta Ads MCP OAuth akışı "
                "interaktif oturumda tamamlanmalı (Faz 0 kullanıcı adımı)."
            )
        return self.token

    async def list_tools(self) -> list[dict[str, Any]]:
        """Canlı araç envanteri — Faz 0 doğrulaması docs/mcp-envanter.md'yi bundan doldurur."""
        self._require_token()
        try:
            from mcp.client.session import ClientSession  # noqa: F401
            from mcp.client.streamable_http import streamablehttp_client
        except ImportError as exc:  # pragma: no cover
            raise MetaGatewayError("`pip install reklamzeka[mcp]` gerekli") from exc

        from mcp.client.session import ClientSession

        async with streamablehttp_client(
            self.endpoint, headers={"Authorization": f"Bearer {self.token}"}
        ) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.list_tools()
                return [
                    {"name": t.name, "description": t.description or ""}
                    for t in result.tools
                ]

    async def call(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Tek araç çağrısı. Yazma araçları Faz 2'ye kadar kapalı."""
        if any(h in tool_name.lower() for h in WRITE_TOOL_HINTS):
            from reklamzeka.guardrails import assert_paused_create
            assert_paused_create(tool_name, arguments)
            if self.dry_run:
                return {"dry_run": True, "tool": tool_name, "arguments": arguments}
            raise MetaGatewayError(
                f"Yazma aracı '{tool_name}' Faz 2 onay akışı dışında çağrılamaz."
            )
        self._require_token()

        from mcp.client.session import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        async with streamablehttp_client(
            self.endpoint, headers={"Authorization": f"Bearer {self.token}"}
        ) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                return await session.call_tool(tool_name, arguments)
