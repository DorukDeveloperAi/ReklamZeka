# ADR-0012 — Creative/post promotion ve atomik approval-only valfi

## Durum

Kabul — 2026-08-06

## Bağlam

Kullanıcı yayındaki reklam metinlerini görmek, bağlı Instagram gönderisini reklam olarak
öne çıkarmak, nadiren yeni reklam üretmek ve ilk dönemde tüm Meta değişikliklerini tek
tek onaylamak istiyor. Mevcut plan creative'i read-only tutuyor ve bundle onayının
granülerliği ile geçici otonomi kilidini yeterince tanımlamıyordu.

## Karar

- Creative dijital ikizi effective copy, CTA/destination, actor, post/media identity,
  dynamic variants ve field-level provenance taşır.
- Mevcut Instagram/Page post promotion K4 typed action bundle'dır; ownership,
  permission, promotion capability, objective/placement/destination ve budget preflight ister.
- Yeni reklam/kreatif üretimi nadir opt-in `CreativeDraftVersion`dır; model doğrudan
  publish/activate edemez.
- Action bundle yalnız dependency ve sunum kabıdır. Her mutation ayrı `ActionUnit` ve
  ayrı approve/reject/request-changes/execute/audit kaydıdır.
- Planlama modu execution autonomy'den ayrılır. Default/ilk rollout `approval_only`dır;
  K1–K4 hiçbir write onaysız çalışmaz ve kilit expiry ile otomatik gevşemez.
- Content/spec, actor, destination, target ad set veya budget değişikliği ilgili ve
  downstream approval'ları stale yapar.

## Sonuçlar

Kullanıcı agent ve schedule'ın hazırlık hızından yararlanırken nihai kontrolü korur.
Existing-post ve nadir üretim aynı valf/timeline'a girer; ayrı gizli writer yolu oluşmaz.
Karşılığında dependency DAG, granular approval UI, capability preflight ve daha ayrıntılı
creative provenance modeli gerekir.
