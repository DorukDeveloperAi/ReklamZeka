"""Faz 0 canlı MCP sözleşme testleri — token yoksa atlanır.

Çalıştırma (OAuth tamamlandıktan sonra):
    META_MCP_ACCESS_TOKEN=... pytest tests/test_mcp_contract.py -v
Envanter çıktısı docs/mcp-envanter.md'ye elle değil bu testten aktarılır.
"""

import asyncio
import os

import pytest

HAS_TOKEN = bool(os.environ.get("META_MCP_ACCESS_TOKEN"))
try:
    import mcp  # noqa: F401
    HAS_MCP = True
except ImportError:
    HAS_MCP = False

pytestmark = pytest.mark.skipif(
    not (HAS_TOKEN and HAS_MCP),
    reason="META_MCP_ACCESS_TOKEN ve `pip install reklamzeka[mcp]` gerekli (Faz 0 kullanıcı adımı)",
)


def test_list_tools_and_dump_inventory(tmp_path):
    from reklamzeka.meta_gateway import MetaGateway

    gw = MetaGateway()
    tools = asyncio.run(gw.list_tools())
    assert tools, "resmî MCP araç listesi boş döndü"

    lines = ["| Araç adı | Açıklama |", "|---|---|"]
    lines += [f"| `{t['name']}` | {t['description'][:120]} |" for t in tools]
    out = tmp_path / "mcp-envanter-dump.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nEnvanter dökümü: {out}")


def test_write_tools_blocked_without_paused():
    from reklamzeka.guardrails import GuardrailViolation
    from reklamzeka.meta_gateway import MetaGateway

    gw = MetaGateway(dry_run=True)
    with pytest.raises(GuardrailViolation):
        asyncio.run(gw.call("ads_create_entity", {"name": "x", "status": "ACTIVE"}))
