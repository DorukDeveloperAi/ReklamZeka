<!-- ot:2026-08-06/reklamzeka-faz-0-kurulum -->
# Oturum — ReklamZeka Faz 0 kurulum

> Oturum: ot:2026-08-06/reklamzeka-faz-0-kurulum · Session: 35fbdca7 · Proje: ReklamZeka
> Başlangıç: 2026-08-06T08:27:53.752Z · Bitiş: 2026-08-06T12:39:41Z · Durum: KAPALI
> Hedef: Onaylı planın Faz 0'ı ayakta: repo iskeleti, terminoloji lint'i, şemalar, taksonomi çözücü, rubrik varsayılanları, MCP sözleşme testi taslağı; testler yeşil

## Hedefler
<!-- ELLE — bu oturumun KENDİ beyanı (tek yazarı bu oturum). Tohum: kaptan nabzı.
     Proje düzeyine terfi eden madde `→ td:elle/<slug>` işareti taşır; işaretsiz madde
     YALNIZ bu oturumda yaşar ve oturum kapanınca global kılavuza düşer. -->
- [x] Kaynağı claim'le + oturum defterini tohumla
- [x] Planı plans/ ağacına yerleştir (MASTER.md künye + agac.mjs)
- [x] Repo iskeleti: pyproject, src paketi, config, docs
- [x] Terminoloji lint scripti (çıplak 'campaign' yasağı)
- [x] SQLite şeması + Sheets şema tanımı (kod + doc)
- [x] Taksonomi miras çözücü (resolve_effective_config) + testler
- [x] Rubrik varsayılan YAML'ları (5 amaç kapsamı)
- [x] meta_gateway iskeleti + MCP sözleşme testi taslağı (creds yoksa skip)
- [x] docs/api-gercekleri.md + mcp-envanter.md (teyitsiz maddeler listesi)
- [x] Doğrulama: pytest + lint koşusu yeşil
- [x] Claim'ler + oturum geçişi
- [x] TODO-ELLE maddeleri + ref dökümü
- [x] Çerçeve + 10 aşama ajanı fan-out
- [x] utopya/ tamam + doğrulandı (yapı temiz, 32 çıpa)
- [x] v2 dosyaları: MASTER/STATE/CHECKLIST/REQUIREMENTS/10 aşama/REVIZYON
- [x] Türetme + gate PASS (DAG aktif) + getirir blokları
- [x] Doğrulama + oturum defteri + claim bırakıldı + rapor
## Notlar

- 2026-08-06: Kod ayağı tamam — 14 test yeşil, 2 MCP sözleşme testi token bekliyor
  (tasarım gereği skip). Lint temiz. Claim bırakıldı.
- Faz 0'ın kalan yarısı KULLANICIDA: Meta MCP OAuth, Sheets kimlik bilgisi,
  Python 3.12/uv kurulumu, MASTER §10 soruları → plans/reklamzeka-sistemi/v1/STATE.md.
- Plan reklamzeka-sistemi v1 AÇIK kalır (Fazlar 1-5 önde).
