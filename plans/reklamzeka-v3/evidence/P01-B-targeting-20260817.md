# P01-B — Kanonik targeting evidence kanıtı

- `deliveryRef`: P01-B-targeting-evidence-20260817
- Kapsam: Meta ad set `targeting` alanının bounded, public-safe, imzalı kanonik özeti ve mevcut `meta_ad_sets` kolonlarına idempotent yazımı.
- Durum: alt teslim kabul edildi; P01 paketi tamamlanmadı.
- Veri sözleşmesi: geo, yaş, cinsiyet, platform, placement ve custom-audience yalnız izinli özet alanlarıyla saklanır; ayrıntılı geo/audience kimlikleri workspace+account salted hash ve count olarak kalır.
- Kalite: `missing`, `known_null`, `unsupported`, `partial`, `ready`; eksik alan varken `ready` verilmez.
- Güvenlik: forged/extra/raw JSON ve signature mismatch repository sınırında fail-closed; public read mirror yalnız doğrulanmış özeti açar.
- Authority / Meta write: category assignment, action, policy ve Meta write `0`.
- Test: 4 focused dosya / 24 test; 13 Meta regression dosyası / 103 test; typecheck, db:check, security-boundaries ve diff-check PASS.
- Migration: yok; mevcut `targeting_summary` ve `targeting_signature` kolonları kullanıldı.
- Sınırlar: isim şablonu registry/replay/onay akışı ve persistent data-health finding/Development Log ayrıca tamamlanacaktır.
