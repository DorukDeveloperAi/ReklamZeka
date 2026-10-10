# ReklamZeka — ortak proje tahtası

Mevcut plan/hedef sistemi varsa asıl iş kaydı oradadır; burada bağlantı verilir. Ürün durumu bu kurulumda değerlendirilmedi.

<!-- BEGIN SHARED PROJECT COORDINATION v1 -->
## COORD-20260925 — Codex → sonraki Codex/Claude

- Cihaz: Berk-Mac-mini-2. Kapsam: yalnız ortak iletişim belgeleri; ürün işlerinin sahipliği devralınmadı.
- Kurulum öncesi Git: `main` / `c081f3773103266a3d7ba528f0224f9241742507`; commit dışı kayıt: 0.
- İki giriş dosyası aynı tahtayı gösterir. Diğer aracın okuduğu/yüklediği ve ikinci cihaz eşitlemesi doğrulanmadı.
- Sonraki adım: ürün kaydını ve gerçek Git durumunu okuyup yetkili işin devrini kaydet.

İletişim kaydı: tarih, gönderen→alıcı, iş/kapsam, yazma sahibi, dosyalar, kanıt, açık soru, sonraki adım. Mevcut iş sistemine bağlantı ver; kopya backlog tutma. Yazmadan önce yeniden oku, başkasının kaydını koru. Not bırakmak kabul/başlatma değildir; otomatik mesajlaşma yoktur.
<!-- END SHARED PROJECT COORDINATION v1 -->

<!-- BEGIN AGENT DIRECTORY 2026-10-07 -->
## Agentlar ve mevcut chat görevleri

[Genel yönlendirme kuralı](</Users/ybg/Library/Mobile Documents/com~apple~CloudDocs/Projeler/Proje Merkezi/sistem/AGENT-KOORDINASYONU.md>) · [Merkez agent dizini](</Users/ybg/Library/Mobile Documents/com~apple~CloudDocs/Projeler/Proje Merkezi/AGENTLAR.md>)

Görev sahipliği kaynağı bu tahtadır. `active/idle/notLoaded` 7 Ekim gözlemidir; iş durumu veya uygunluk kabulü değildir. Başlık/özet eşleşmesi yeni ürün sahipliği ataması oluşturmaz. Aynı iş kimliği korunur; her anlamlı teslimde ilgili satırın kanıtı ve sonraki adımı yenilenir.

Son 50 chatlik masaüstü envanterinde bu projeye kesin eşlenen görev bulunmadı. Bu, hiç görev bulunmadığı anlamına gelmez. Gerektiğinde mevcut proje kayıtları ve hedefli chat okuması ile eşle; yeni agent açma kararı çıkarma.
<!-- END AGENT DIRECTORY 2026-10-07 -->

<!-- BEGIN PROJECT GUIDE MAP 2026-10-10 -->
## Proje mantığı ve kaynak haritası — 10 Ekim 2026

Meta Ads ve Google Ads performansını ortak metriklerde birleştiren reklam karar destek ürünüdür; sonraki aksiyonlar insan onayında kalır.

Bu bakım kaynakları görünür kılar; canlı işlem, ürün kabulü, yeni üretim veya görev sahipliği devri yapmaz. Girdi → yöntem → teslim ayrıntısı aşağıdaki asıl kaynaklardan okunur; bu bölüm ikinci talimatname değildir.

| Çekirdek ihtiyaç | Asıl kaynak / okuma tetikleyicisi |
| --- | --- |
| Amaç, kapsam ve yöntem | [README.md](</Users/ybg/dev/ReklamZeka/README.md>); yeni işe başlarken proje yaklaşımını oku. |
| Çalışma talimatı | [AGENTS.md](</Users/ybg/dev/ReklamZeka/AGENTS.md>) · [CLAUDE.md](</Users/ybg/dev/ReklamZeka/CLAUDE.md>); ilgili role ve işe başlamadan oku. |
| İş, sahiplik, karar ve devir | [Tek kaynak tahta](</Users/ybg/dev/ReklamZeka/ortak/TAHTA.md>); mevcut iş kimliği/claim korunur. |
| Girdiler ve ayrıntı kılavuzları | [README.md](</Users/ybg/dev/ReklamZeka/README.md>) · [plans/proje/v2/MASTER.md](</Users/ybg/dev/ReklamZeka/plans/proje/v2/MASTER.md>) · [plans/proje/v2/STATE.md](</Users/ybg/dev/ReklamZeka/plans/proje/v2/STATE.md>) · [plans/proje/v2/REQUIREMENTS.md](</Users/ybg/dev/ReklamZeka/plans/proje/v2/REQUIREMENTS.md>); yalnız ilgili işlem/analiz öncesi oku. |
| Teslim ve doğrulama | [İlgili son teslim kaydı](</Users/ybg/dev/ReklamZeka/ortak/TAHTA.md>); çıktı yolu, tarih/sürüm ve kabul kanıtını kayıttan doğrula. Dosya varlığı kabul değildir. |
| Konum ve kurtarma | [Konum envanteri](</Users/ybg/Library/Mobile Documents/com~apple~CloudDocs/Projeler/Proje Merkezi/sistem/konumlar.json>) · [Cihaz devri](</Users/ybg/Library/Mobile Documents/com~apple~CloudDocs/Projeler/Proje Merkezi/sistem/IKI-BILGISAYAR.md>); bu kökte ikinci aktif kopya oluşturma. Yedek/geri yükleme denemesi ayrıca kanıtlanmalı. |

Ürün planının asıl kaydı `plans/proje/v2` içindedir; bu tahta ona bağlantı veren ortak giriş olarak kalır.

**COY-14 açık doğrulama:** Bağımsız yedek/geri yükleme denemesi ve ikinci cihaz erişimi bu bakımda doğrulanmadı; kaynakta mevcut yöntem varsa sahibi kanıtına bağlamalı.

**Sahip / sonraki adım:** Adreslenebilir güncel proje sahibi bu turda teyit edilmedi; kullanıcı/mevcut proje sahibi ilk gerçek devam işinde açık alanı ve kabul kanıtını kesinleştirecek.

Yazan: Codex `01a1155f-e4ea-75d2-8a7d-38bcfc1d8d4f`; Berk-Mac-mini-2. Model/runtime değişmedi.
<!-- END PROJECT GUIDE MAP 2026-10-10 -->
