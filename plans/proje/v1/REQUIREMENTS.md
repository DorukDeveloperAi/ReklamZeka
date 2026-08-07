# ReklamZeka MVP — REQUIREMENTS (v1)

## Global

| id | requirement (yüklem) | doğrulama | delege |
|---|---|---|---|
| R-G1 | Şartname çıpaları benzersiz ve planla bağlıdır. | `kanit:urun-temeli` | `scripts/check-project-foundation.mjs` |
| R-G2 | Tüm veri erişimi çalışma alanı üyeliğiyle sunucu tarafında sınırlandırılır. | `kanit:kiraci-guvenligi` | aşama 04 güvenlik entegrasyon kapısı |
| R-G3 | Senkronizasyon tekrarında kanonik kayıt çoğalmaz. | `kanit:veri-platformu` | aşama 03 idempotency testi |
| R-G4 | Türetilmiş metrik ve öneri kaynak/sürüm bağını korur. | `kanit:veri-platformu` + aşama 06 | aşama 03 ve 06 sözleşme testleri |
| R-G5 | Sırlar log, hata ve istemci payload'ına sızmaz. | `kanit:kiraci-guvenligi` | aşama 04 sır sızıntısı kapısı |
| R-G6 | MVP reklam platformunda yazma işlemi yapmaz. | `kanit:kiraci-guvenligi` | connector scope ve ağ çağrısı kapısı |
| R-G7 | Temel pilot yolculuğu otomatik tarayıcı testinde tamamlanır. | yeni — sınıf: surus | aşama 07 E2E artefaktı |

## Aşama-bazlı

### Aşama 01 — ürün temeli
| id | requirement | doğrulama | delege |
|---|---|---|---|
| R-01.1 | KUZEY amaç, kapsam ve vizyon bölümünü taşır. | `kanit:urun-temeli` | foundation kapısı |
| R-01.2 | Beş istek tipinin tamamı en az bir çıpa taşır. | `kanit:urun-temeli` | foundation kapısı |

### Aşama 02 — teknik temel
| id | requirement | doğrulama | delege |
|---|---|---|---|
| R-02.1 | Stack kararları ADR'da alternatif ve gerekçeyle kayıtlıdır. | yeni — sınıf: hizli | mimari lint |
| R-02.2 | Temiz kurulum sonrası tek komut uygulama ve testleri başlatır. | yeni — sınıf: tam | CI |

### Aşama 03 — veri platformu
| id | requirement | doğrulama | delege |
|---|---|---|---|
| R-03.1 | Meta, Google ve CSV aynı sürümlü günlük metrik sözleşmesine dönüşür. | `kanit:veri-platformu` | golden fixture sözleşme testi |
| R-03.2 | Connector'lar salt-okunur scope, cursor, rate-limit, retry ve hata sınıfı taşır. | `kanit:veri-platformu` | connector contract suite |
| R-03.3 | Replay ve cursor-resume kanonik satır çoğaltmaz; gecikmiş veri aynı satırı günceller. | `kanit:veri-platformu` | idempotency suite + migration unique index |

### Aşama 04 — kiracı güvenliği
| id | requirement | doğrulama | delege |
|---|---|---|---|
| R-04.1 | Her sunucu veri erişimi hedef çalışma alanı üyeliği ve rol eylemiyle sınırlandırılır. | `kanit:kiraci-guvenligi` | yetki ve tenant escape matrisi |
| R-04.2 | Bağlantı sırları şifreli kalır; write scope, log ve istemci sızıntısı reddedilir. | `kanit:kiraci-guvenligi` | scope/secret/redaction suite |
| R-04.3 | Kritik olaylar aktör/zaman/kaynak hash zincirine append-only eklenir. | `kanit:kiraci-guvenligi` | audit integrity suite + DB trigger |

### Aşama 05 — performans deneyimi
| id | requirement | doğrulama | delege |
|---|---|---|---|
| R-05.1 | Aktivasyon, sync, boş, kısmi, gecikmiş ve hata durumları birbirinden ayrılır. | `kanit:performans-deneyimi` | durum fixture suite |
| R-05.2 | UI ve API 7/30/90 günlük kanonik toplamları aynı üretir. | `kanit:performans-deneyimi` | golden aggregation testi |
| R-05.3 | Kritik akış 1280/820/390 genişlikte taşmadan, adlandırılmış rollerle çalışır. | `kanit:performans-deneyimi` | browser QA JSON |

### Aşama 06 — içgörü motoru
| id | requirement | doğrulama | delege |
|---|---|---|---|
| R-06.1 | Her içgörü kaynak, eşik, güven gerekçesi ve hesaplama sürümü taşır. | `kanit:icgoru-motoru` | schema/rule suite |
| R-06.2 | Dört başlangıç kuralı pozitif, negatif ve az-veri fixture'larında beklenen hükmü verir. | `kanit:icgoru-motoru` | golden rule matrix |
| R-06.3 | Aynı snapshot byte-eş sıralı çıktı; feedback kullanıcı/sürüm bağlı ve idempotenttir. | `kanit:icgoru-motoru` | determinism + feedback suite |

### Aşama 07

| id | requirement | doğrulama | delege |
|---|---|---|---|
| R-07.1 | Rapor bağlantısı salt-okunur, süreli, imzalı, iptal edilebilir ve dashboard snapshot'ıyla eşleşir. | `kanit:pilot-hazirlik` | share suite |
| R-07.2 | Sync gecikmesi/hata oranı/kota/içgörü alarmları runbook taşır ve recovery ile çözülür. | `kanit:pilot-hazirlik` | operations suite |
| R-07.3 | Gerçek pilot 3 çalışma alanı/10 hesapta şartname eşiklerini geçer. | açık — `field_pilot` gerekli | saha pilot raporu |

Aşama 07 gerçek saha kanıtı `.claude/kanit.json` girişine ve `field_pilot` raporuna
dönüştürülmeden kapatılamaz.
