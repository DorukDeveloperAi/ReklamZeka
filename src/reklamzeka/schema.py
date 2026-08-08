"""SQLite ambar şeması (warehouse.db) — MASTER §2.2.

Sheets insan-okur kanondur; buradaki tablolar makine ambarı + Sheets cache'idir.
meta_level değerleri tam niteliklidir: meta_campaign | meta_ad_set | meta_ad.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

META_LEVELS = ("meta_campaign", "meta_ad_set", "meta_ad")

DDL = """
CREATE TABLE IF NOT EXISTS internal_campaign_family (
    family_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    attribute_schema TEXT,          -- JSON
    default_goal_scopes TEXT,       -- JSON list
    default_kpi_targets TEXT,       -- JSON
    rules TEXT,                     -- JSON
    analysis_logic_ref TEXT,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS internal_campaign_category (
    category_id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES internal_campaign_family(family_id),
    name TEXT NOT NULL,
    attribute_schema_override TEXT, -- JSON
    medium TEXT,                    -- JSON list
    page_type TEXT,                 -- JSON list
    goal_scope TEXT,
    kpi_targets_override TEXT,      -- JSON
    budget_definition TEXT CHECK (budget_definition IN ('instance','category')),
    rules_override TEXT,            -- JSON
    analysis_logic_override TEXT,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS internal_campaign (
    ik_id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES internal_campaign_category(category_id),
    name TEXT NOT NULL,
    page_ref TEXT,
    budget_amount REAL,
    budget_period TEXT,
    budget_level TEXT,
    start_date TEXT,
    end_date TEXT,
    attributes TEXT,                -- JSON: yalnız instance override
    brief_id TEXT,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS brief (
    brief_id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('family','category','instance')),
    owner_ref TEXT NOT NULL,
    hedef_cumlesi TEXT NOT NULL,
    kpi_targets TEXT NOT NULL,      -- JSON: [{metric_key, target, threshold_warn, threshold_fail}]
    kisitlar TEXT,
    tarih TEXT NOT NULL,
    revizyon_no INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS goal_scope (
    scope_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    composite_weights TEXT          -- JSON: hibrit için {scope_id: weight}
);

CREATE TABLE IF NOT EXISTS rubric_override (
    rubric_id TEXT PRIMARY KEY,
    goal_scope_id TEXT NOT NULL REFERENCES goal_scope(scope_id),
    metrics TEXT NOT NULL           -- JSON: [{metric_key, source, direction, weight, benchmark}]
);

CREATE TABLE IF NOT EXISTS meta_object_mapping (
    mapping_id TEXT PRIMARY KEY,
    meta_level TEXT NOT NULL CHECK (meta_level IN ('meta_campaign','meta_ad_set','meta_ad')),
    meta_id TEXT NOT NULL,
    ik_id TEXT NOT NULL REFERENCES internal_campaign(ik_id),
    match_method TEXT NOT NULL CHECK (match_method IN ('name_rule','manual','ai_suggested')),
    confidence REAL,
    verified_by_user INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (meta_level, meta_id)
);

CREATE TABLE IF NOT EXISTS raw_insights (
    raw_id INTEGER PRIMARY KEY AUTOINCREMENT,
    fetched_at TEXT NOT NULL,
    meta_level TEXT NOT NULL,
    meta_id TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    payload TEXT NOT NULL           -- ham JSON: alan adları değişse de yeniden türetim mümkün
);

CREATE TABLE IF NOT EXISTS metric_snapshot (
    snapshot_date TEXT NOT NULL,
    meta_level TEXT NOT NULL CHECK (meta_level IN ('meta_campaign','meta_ad_set','meta_ad')),
    meta_id TEXT NOT NULL,
    metric_key TEXT NOT NULL,
    value REAL,
    raw_json_ref INTEGER REFERENCES raw_insights(raw_id),
    PRIMARY KEY (snapshot_date, meta_level, meta_id, metric_key)
);

CREATE TABLE IF NOT EXISTS evaluation (
    eval_id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('instance','aggregate')),
    target_id TEXT NOT NULL,        -- ik_id | category_id
    period TEXT NOT NULL,
    rubric_id TEXT,
    scores TEXT,                    -- JSON
    delta TEXT,                     -- JSON
    verdict TEXT,
    rationale_text TEXT,
    brief_id TEXT NOT NULL,         -- brief'e bağlanamayan değerlendirme yazılamaz
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS change_proposal (
    proposal_id TEXT PRIMARY KEY,
    eval_id TEXT REFERENCES evaluation(eval_id),
    action_type TEXT NOT NULL CHECK (action_type IN
        ('pause','scale','budget_shift','creative_refresh','targeting','boost_create')),
    target_meta_ids TEXT NOT NULL,  -- JSON list
    diff TEXT NOT NULL,             -- JSON: [{field, current, proposed}]
    rationale TEXT NOT NULL,        -- JSON: {brief_id, metric_key, threshold, measured}
    copy_rule_findings TEXT,        -- JSON list
    risk_flags TEXT,                -- JSON list
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
        ('pending','approved','rejected','applied','rolled_back','expired')),
    created_at TEXT NOT NULL,
    expires_at TEXT
);

CREATE TABLE IF NOT EXISTS decision_log (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id TEXT NOT NULL REFERENCES change_proposal(proposal_id),
    actor TEXT NOT NULL,
    decision TEXT NOT NULL,
    applied_at TEXT,
    mcp_tool_called TEXT,
    mcp_response_ref TEXT,
    rollback_ref TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS copy_rule_set (
    rule_id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('global','family','category')),
    scope_ref TEXT,                 -- family_id | category_id (global'de NULL)
    pattern_type TEXT NOT NULL CHECK (pattern_type IN ('regex','keyword','llm_check')),
    pattern TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('block','warn')),
    aciklama TEXT,
    kaynak_notu TEXT,
    aktif INTEGER NOT NULL DEFAULT 0  -- başlangıç paketi PASİF gelir; kullanıcı aktive eder
);
"""


def init_db(db_path: str | Path) -> sqlite3.Connection:
    """Ambarı açar/oluşturur; decision_log append-only kanonuna uygulama katmanı uyar."""
    conn = sqlite3.connect(str(db_path))
    conn.executescript(DDL)
    conn.commit()
    return conn
