# ADR-0004 — Deterministik açıklanabilir içgörü motoru

## Bağlam

Reklam performansı önerileri kullanıcı kararını etkiler. Kanıtsız, sürümsüz veya aynı veriyle
farklı sonuç üreten bir motor güvenilir değildir; LLM çıktısı tek başına karar kaynağı olamaz.

## Karar

- İlk motor saf ve deterministik TypeScript kurallarından oluşacak; aynı sürümlü snapshot
  aynı sıralı JSON'u üretecek.
- Her içgörü `ruleId`, hesaplama sürümü, snapshot kimliği, platform kaynakları, dönem,
  metrik karşılaştırması, eşik, güven skoru/gerekçesi ve güvenli sonraki adımı taşıyacak.
- Harcama sıçraması, dönüşüm düşüşü, CPA/ROAS verimlilik bozulması ve veri gecikmesi ilk
  kural setidir. Az veri eşikleri yanlış pozitifleri bastırır.
- İçgörüler reklam hesabında işlem yapmaz; yalnız inceleme adımı önerir.
- Yararlı/yararsız/aksiyon alındı geri bildirimi kullanıcı, çalışma alanı ve içgörü sürümüne
  bağlanır; aynı geri bildirim idempotenttir ve değişiklik audit olayı üretir.

## Gerekçe

Saf kurallar golden fixture'larla yeniden üretilebilir, eşikler gözden geçirilebilir ve pilot
geri bildirimiyle kontrollü sürümlenebilir. Zorunlu kanıt alanları kullanıcıya “neden?”
sorusunun cevabını taşır.

## Alternatifler

- **LLM'nin doğrudan hüküm üretmesi:** Yeniden üretilebilirlik ve hesap kanıtı zayıf olduğu
  için ilk sürümde reddedildi.
- **Tek birleşik anomali skoru:** Metrik ve eşik gerekçesini gizlediği için reddedildi.
- **Az veri koruması olmadan yüzde değişimi:** Küçük tabanlarda yanlış alarm ürettiği için
  reddedildi.

## Sonuçlar

Eşik veya hesap değişikliği `calculationVersion` artışı gerektirir. Pilot verisi yeni kuralları
önerebilir; önce fixture matrisi ve geriye dönük snapshot değerlendirmesi yapılmalıdır.
