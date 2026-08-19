# Persisted Campaign Operator Acceptance

> Status: `PENDING_OPERATOR_PROOF`  
> Owner: workspace operator  
> Scope: gerçek local-session, persisted frozen campaign context ve salt-okunur dashboard yolculuğu

Bu kabul, fixture veya browser mock ile kapatılamaz. Operatör kendi local-session capability'sini kendi güvenli akışında bağlar; proof değeri bu belgeye, issue'ya, ekrana, console'a veya browser storage'a yazılmaz.

## Ön koşullar

- Kullanıcının erişebildiği çalışma alanında kanonik Meta ayna kaydı vardır.
- Aynı kampanya için persisted frozen context mevcuttur.
- Decision Room veya Onay Kuyruğu gerçek kaynakta `EMPTY` dönebilir; bu geçerli sonuçtur. Kayıt uydurulmaz.
- Bu kabul Meta write, execute, onay/reddet veya başka mutation çalıştırmaz.

## Yolculuk

| Adım | Operatör eylemi | Beklenen sonuç | Başarısızlıkta doğru davranış |
|---|---|---|---|
| 1 | `/dashboard?view=campaigns` aç | Kanonik kaynak ve kampanya portföyü görünür; campaign adı yalnız kaynaktan gelir | Session yoksa açık session recovery; örnek kampanya yok |
| 2 | Bir kampanyada `Kararlarda incele` seç | URL `view=decision-room&campaign=ref_…` olur; bağlam önce server'da doğrulanır | Frozen context yoksa yönlendirme yapılmaz, uydurma eşleme yok |
| 3 | `Koşumlar` sekmesini aç | Yalnız seçili campaign alias'ına ait gerçek kayıtlar veya `EMPTY` görünür | Genel çalışma alanı kaydı fallback olarak görünmez |
| 4 | `Onay kuyruğu`na geç | Aynı frozen context'ten türetilen approval alias ile liste süzülür | `EMPTY`, `UNAVAILABLE` veya `session_required` açıkça görünür |
| 5 | Tarayıcı geri/ileri kullan | Campaign alias, alt görünüm ve odak yeni ana landmark ile tutarlı kalır | Eski A kampanyasının yanıtı B altında görünmez |
| 6 | `Tüm çalışma alanına dön` seç | `campaign` query parametresi silinir; genel Decision Room/Onay görünümü açılır | Önceki seçili campaign detail'i kalmaz |

## Kaydedilecek güvenli kanıt

- Her adım için `PASS`, `EMPTY`, `UNAVAILABLE` veya `BLOCKED_EXTERNAL` sonucu.
- Yalnız public-safe URL şekli (`campaign=ref_…`), görünür state adı ve console error/warning sayısı.
- 390 px mobilde yatay taşma gözlemi ve keyboard odak geçişi sonucu.
- Karar/onay kontrolü görünse bile tıklanmadığı; Meta write veya execute çalıştırılmadığı.

Kaydedilmeyecekler: proof/token, cookie, local/session storage içeriği, raw Meta ID, tenant-private payload, ekran görüntüsündeki hassas veri.

## Başarı ölçütü

Bu belge ancak tüm adımlar gerçek kaynak sonucuyla kaydedildiğinde `PASS_OPERATOR_PROOF` durumuna geçer. `EMPTY` gerçek ve sözleşmeye uygun bir başarı sonucudur; `UNAVAILABLE` veya `BLOCKED_EXTERNAL` ise doğruluk kanıtı sağlar fakat uçtan uca kabulü kapatmaz.
