# P03 — slice-operasyon-rapor

**Bağımlılık:** P02. **DoD:** R3-07–R3-10.

## Slice

- Slice revisionlıdır; predicate, explicit include/exclude, AND/OR grupları ve hybrid bileşim içerir.
- Öncelik kesin olarak `exclude > include > filter`dır. Market sınırı hiçbir hybrid/saved-view/replay yolunda delinmez.
- Current değerlendirme ile frozen run/replay ayrı saklanır; eski koşum sonradan değişen üyelikle yeniden yazılmaz.

## Operasyon tablosu

Meta reports benzeri table; hiyerarşi seviyeleri, generic dimensions, künye/market, durum, budget/CBO-ABO, delivery, primary result, canonical metricler, freshness/source-state ve tarih aralığını sunar. Tarih, filter, sort, subtotal, ratio, drill-down, saved view ve satır actionları vardır.

## Kapsam Raporu

Kapsam Raporu ayrı bir data-pivot/report kontratıdır; day/week/month granularity, levels, dimensions, metrics, **all raw actions**, filter/sort/subtotal/ratio/drill, saved reports ve CSV/XLSX export sağlar. Guide/decision/audit satırları rapora katılmaz; yalnız report bağlamına contextual link olur. Primary result user override’dır, rapor sonucu tahmin etmez.

## Test, rollout, rollback

Include/exclude/filter, AND/OR, hybrid revision, cross-market, current-vs-frozen replay; table/pivot filter/sort/subtotal/ratio/drill/export/saved report ve raw-action completeness browser/API testleri geçer. Rapora ek bağlam linkleri veri satırı haline gelmez. Rollback report projectionı kapatır, frozen reportları korur.

