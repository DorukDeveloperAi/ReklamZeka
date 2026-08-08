"""Google Sheets kanon şeması — sekme adları ve kolonlar (MASTER §2.1-2.2).

Sheets insan-okur kanondur: sistem yalnız append/yeni satır yazar, insan
hücrelerini ezmez. Sekme adları terminoloji sözlüğüne kilitlidir.
"""

from __future__ import annotations

# sekme adı -> kolon listesi
TABS: dict[str, list[str]] = {
    "IC_KAMPANYA_AILELERI": [
        "family_id", "name", "description", "attribute_schema",
        "default_goal_scopes", "default_kpi_targets", "rules",
        "analysis_logic_ref", "status",
    ],
    "IC_KAMPANYA_KATEGORILERI": [
        "category_id", "family_id", "name", "attribute_schema_override",
        "medium", "page_type", "goal_scope", "kpi_targets_override",
        "budget_definition", "rules_override", "analysis_logic_override", "status",
    ],
    "IC_KAMPANYALAR": [
        "ik_id", "category_id", "name", "page_ref", "budget_amount",
        "budget_period", "budget_level", "start_date", "end_date",
        "attributes", "brief_id", "status",
    ],
    "BRIEFLER": [
        "brief_id", "scope", "owner_ref", "hedef_cumlesi", "kpi_targets",
        "kisitlar", "tarih", "revizyon_no",
    ],
    "AMAC_KAPSAMLARI": ["scope_id", "name", "composite_weights"],
    "RUBRIK_OVERRIDE": ["rubric_id", "goal_scope_id", "metrics"],
    "ESLEME_TABLOSU": [
        "mapping_id", "meta_level", "meta_id", "ik_id", "match_method",
        "confidence", "verified_by_user", "created_at",
    ],
    "ONAY_KUYRUGU": [
        "proposal_id", "action_type", "hedef", "diff_ozeti", "gerekce",
        "risk_flags", "status", "created_at", "expires_at",
    ],
    "KARAR_GUNLUGU": [
        "log_id", "proposal_id", "actor", "decision", "applied_at",
        "mcp_tool_called", "rollback_ref", "created_at",
    ],
    "METIN_KURAL_SETLERI": [
        "rule_id", "scope", "scope_ref", "pattern_type", "pattern",
        "severity", "aciklama", "kaynak_notu", "aktif",
    ],
    "DEGERLENDIRMELER": [
        "eval_id", "scope", "target_id", "period", "verdict",
        "rationale_text", "brief_id", "created_at",
    ],
}

# Sistem tarafından YALNIZ append edilen sekmeler (insan hücresi ezilmez)
APPEND_ONLY_TABS = ("ONAY_KUYRUGU", "KARAR_GUNLUGU", "DEGERLENDIRMELER")
