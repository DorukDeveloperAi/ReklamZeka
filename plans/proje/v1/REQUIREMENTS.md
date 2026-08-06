# ReklamZeka MVP — REQUIREMENTS (v1)

## Global

| id | requirement (yüklem) | doğrulama | delege |
|---|---|---|---|
| R-G1 | Şartname çıpaları benzersiz ve planla bağlıdır. | `kanit:urun-temeli` | `scripts/check-project-foundation.mjs` |
| R-G2 | Tüm veri erişimi çalışma alanı üyeliğiyle sunucu tarafında sınırlandırılır. | yeni — sınıf: tam | aşama 04 güvenlik entegrasyon kapısı |
| R-G3 | Senkronizasyon tekrarında kanonik kayıt çoğalmaz. | yeni — sınıf: tam | aşama 03 idempotency testi |
| R-G4 | Türetilmiş metrik ve öneri kaynak/sürüm bağını korur. | yeni — sınıf: tam | aşama 03 ve 06 sözleşme testleri |
| R-G5 | Sırlar log, hata ve istemci payload'ına sızmaz. | yeni — sınıf: tam | aşama 04 sır sızıntısı kapısı |
| R-G6 | MVP reklam platformunda yazma işlemi yapmaz. | yeni — sınıf: tam | connector scope ve ağ çağrısı kapısı |
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

### Aşama 03–07

Aşamaların kendi dosyalarındaki kabul kriterleri uygulama sırasında `.claude/kanit.json`
girişlerine dönüştürülmeden aşama kapatılamaz.
