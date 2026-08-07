# ADR-0014 — Deterministik L0–L5 ön işleme ve EffectiveCampaignContext

## Durum

Kabul — 2026-08-06

## Bağlam

Ham Meta verisini agent'a vermek token maliyetini, reasoning yükünü ve hata yüzeyini
büyütür. Buna karşılık her analiz varyantını katı kodlamak da erken aşamada esnekliği
öldürür. Tek kampanya için kategori, guidance, policy, budget, config, cadence ve history'nin
hangi sürümünün kullanıldığı açık bir runtime context sözleşmesi eksikti.

## Karar

- Raw→canonical→feature→window/rollup→evidence→compact agent context L0–L5 pipeline'ı kurulur.
- Metrik/formül/trend/data quality/driver/cadence eligibility deterministik ön işlenir.
- Agent L4/L5 ile başlar, yalnız bounded typed tools üzerinden L1–L3 drill-down yapar.
- Her run frozen `EffectiveCampaignContext` ve version/hash taşır.
- İlk altyapı modular monolith + PostgreSQL + DB-backed worker/materialized rollup'tur.
- Vector DB, ClickHouse, Kafka/event bus ve ayrı feature service ertelenir.
- Optional business outcome signals önce manual/CSV, canlı CRM connector sonra gelir.

## Sonuçlar

Token ve reasoning yükü düşer, replay/audit güçlenir ve agentic analysis esnek kalır.
Feature/version/invalidation/context assembler işleri gerekir; fakat erken dağıtık sistem
maliyeti oluşmaz.
