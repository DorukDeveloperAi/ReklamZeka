# P02 — kurum-kampanyasi-kunye

**Bağımlılık:** P01. **DoD:** R3-05–R3-06.

## Teslim

- Hiyerarşi hesap → Kurum Kampanyası → Meta kampanya → ad set → reklam → creative/post’tur; Kurum Kampanyası first-class org table’dır.
- Membership modeli bir Meta nesnesi için en çok bir current organization membership’i zorlar; eşleşmeyenler virtual Atanmamış’ta görünür.
- Primary result user-selected/override’dır; sonuç türü tahmin edilmez.
- Generic dimensions için başlangıç değerleri, kaynak önceliği ve conflict precedence tanımlıdır.
- Versioned naming template; alan tanımı, lifecycle, preview ve kullanıcıya before/after görünümü verir. İsim tek başına doğru kabul edilmez.
- Meta setup, name, content/CTA/destination/geo/platform sonuç kanıtı çelişirse review queue; otomatik künye/rename yoktur.

## Test, rollout, rollback

Organization/membership uniqueness, unassigned, result override, dimension precedence, template revision/preview ve name-nontruth negatifleri DB/API/UI/RLS testleriyle kabul edilir. Projection geri alınabilir; membership/audit silinmez.

