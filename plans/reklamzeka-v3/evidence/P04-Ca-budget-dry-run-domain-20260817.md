# P04-Ca — Kılavuz bütçe dry-run domain kanıtı

## Kabul edilen kapsam

- Dört katmanlı, kanıt temelli bütçe dry-run sözleşmesi.
- CBO campaign ve ABO ad-set bütçe sahibi çözümü; aynı ekonomik sahip tek kez sayılır.
- V1 `amountMinor` uyumluluğu ve TRY minor-unit `half_even/1` yuvarlama sözleşmesi.
- Artış/azalış yönüne özel overlap kısıtları, en düşük absolute/relative cap ve parent ceiling.
- Eksik, stale, currency/market uyuşmazlığı, belirsiz scope/owner ve sıfır-baseline relative cap için fail-closed hold.
- Bounded expression ağacı ve decimal büyüklüğü; deterministic hash ve derin immutable çıktı.
- Çıktıda persistence, approval, execution ve Meta write yetkileri sıfırdır.

## Kabul kanıtı

- Bağımsız son inceleme: `ACCEPT`.
- `tests/guide-budget-dry-run.test.ts`: 16/16 geçti.
- Guide budget + effective overlap geniş matrisi: 25/25 geçti.
- `npm run typecheck`: geçti.
- `git diff --check`: geçti.

## Özellikle doğrulanan regresyonlar

- Negatif kesirli delta canonical biçimde yazılır; çift eksi/negatif remainder yoktur.
- `1.01 × 0.5 TRY → 0.50`, `1.03 × 0.5 TRY → 0.52` half-even davranışı hash sözleşmesine bağlıdır.
- `0.004 TRY` hedef ve owner kanıtı aynı canonical `0` değerine yuvarlanır; pozitif delta relative cap altında `maximum_relative_delta_zero_baseline` hold üretir.
- CBO ad-set bağlamı campaign owner'a; ABO ad-set bağlamı ad-set owner'a bağlanır.
- Market enumu ve `observedAt` canonical ISO runtime sınırında doğrulanır.

## Açık kalan kapsam

Bu alt paket yalnız saf domain temelidir. Guide v2 strict persistence/schema versioning, durable snapshot evidence repository, read-only service/HTTP, P03 current-slice entegrasyonu ve P06 action consumer bağlantısı P04-Cb olarak açıktır. P04 paketinin tamamı değildir.
