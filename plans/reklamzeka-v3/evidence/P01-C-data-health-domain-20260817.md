# P01-C — Unified Meta data-health saf domain

- `deliveryRef`: P01-C-unified-data-health-domain-20260817
- Durum: alt domain teslimi kabul edildi; persistence/action-gate wiring tamamlanmadığı için P01 paketi açık.
- Contract: mirror, performance ve trust kaynaklarını v3 `ready|partial|empty|unavailable` sağlık sonucunda birleştirir; legacy `stale` partial+explicit reason, `demo` unavailable olarak işlenir.
- Exact evidence: beklenen/gözlenen/eksik tarihler ve alanlar; workspace/account para birimi; source kind ve reason.
- Stable lifecycle: aynı konu stable issue fingerprint'i taşır; her kanıt değişimi ayrı `evidenceHash` observation olur. Finding `data_quality/open`, Development Log `data/proposed` olarak adapterlara aktarılabilir.
- Gate: analysis her durumda sonuç/insufficient-data kaydı yazabilir; eksik/stale/empty/unavailable/demo/currency mismatch action staging ve dispatch data-health readiness'ini kapatır.
- Currency: yalnız workspace currency ile exact eşleşen ready hesaplar parasal aggregate kapsamına alınır; uyumsuz/unknown hesaplar açıkça excluded olur.
- Authority / network: persistence, action, approval, Meta network/write `0`.
- Test: `tests/meta-data-health.test.ts` 5/5; typecheck ve diff-check PASS.
- Açık: canonical DB adapter, stable finding observation/Development Log persistence ve unified action-preparation/admission wiring.
