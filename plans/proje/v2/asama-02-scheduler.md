---
kosum: tek-ajan
---
# Aşama 02 — Scheduler ve run ledger (v2)

## SONUÇ

Manuel ve planlanmış analizler aynı idempotent yürütücüde, açık timezone/misfire/retry
politikasıyla çalışır; her logical fire tek ve denetlenebilir run üretir.

## Task'lar

- Hourly/daily/weekly/monthly schedule resolver ve DST golden matrisi.
- `definitionVersion + workspaceId + scheduledFor` benzersiz run anahtarı.
- queued/running/succeeded/failed/skipped durumları, lease ve retry sınıfları.
- Workspace concurrency ve günlük run bütçesi.
