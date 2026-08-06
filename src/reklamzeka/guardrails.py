"""Governance kilitleri — MASTER §6.

Faz 0'da yalnız ACTIVE-create engeli; harcama tavanları ve diff sınırı Faz 2'de
Sheets'ten okunarak dolacak.
"""

from __future__ import annotations

from typing import Any


class GuardrailViolation(RuntimeError):
    pass


def assert_paused_create(tool_name: str, arguments: dict[str, Any]) -> None:
    """Create/update çağrılarında ACTIVE status'ü kod seviyesinde engeller.

    Kanon: yeni Meta nesnesi her zaman AÇIKÇA PAUSED üretilir; aktivasyon
    kullanıcının ayrı, insan eylemi olarak kalır. MCP'nin PAUSED varsayılanına
    güvenilmez (araştırma: garanti doğrulanamadı).
    """
    status = str(arguments.get("status", "")).upper()
    if "create" in tool_name.lower():
        if status != "PAUSED":
            raise GuardrailViolation(
                f"'{tool_name}' çağrısında status açıkça 'PAUSED' olmalı "
                f"(gelen: {status or 'YOK'})."
            )
    elif status == "ACTIVE":
        raise GuardrailViolation(
            f"'{tool_name}' ile ACTIVE'e geçiş sistem üzerinden yapılamaz; "
            "aktivasyon insan eylemidir (Ads Manager / panel ayrı onayı)."
        )
