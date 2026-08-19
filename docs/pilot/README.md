# Saha pilotu veri girişi

1. Önce hiçbir veri yazmayan kaynak census'unu çalıştırın:

```bash
npm run census:field-pilot-source-db
```

   Çıktıda `eligibleForFieldPilotAttestation: true` görünmeden attestation veya
   `field_pilot` raporu üretmeyin. Census, gerçek aktif hesap envanteri,
   tazelik, geri bildirim, dashboard-doğrulama ve kritik-olay kaynaklarının
   tamamını arar; insan attestation'ını asla bunlardan türetmez.
2. Önerilen yol olarak [`field-pilot.telemetry.template.json`](field-pilot.telemetry.template.json)
   dosyasını proje dışında veya `.gitignore` kapsamındaki güvenli bir konuma kopyalayın.
   Manuel aggregate gerekiyorsa [`field-pilot.template.json`](field-pilot.template.json) kullanılabilir.
3. Gerçek pilot olaylarını aşağıdaki telemetri sözleşmesine göre `events` dizisine aktarın.
   Token, e-posta, müşteri adı veya kişisel veri eklemeyin; yalnız anonim `a-zA-Z0-9_-`
   kimlikleri kullanın. Dönüştürücü beklenmeyen alanları ve e-posta biçimli kimlikleri reddeder.
4. Veriyi doğrulayan kişi `attestation` alanlarını doldurup yalnız gerçek hesaplar olduğunu
   onayladığında `confirmsRealAccounts` değerini `true` yapar.
5. Önce hiçbir dosya yazmayan preflight'ı çalıştırın. Yalnız hüküm `pass` olduğunda resmi
   raporu üretin:

```bash
npm run pilot:field-preflight -- path/to/field-input.json
npm run pilot:field-report -- path/to/field-input.json docs/qa/field-pilot.json
npm run check:field-pilot
```

Üretici mevcut raporun üzerine yazmaz. Sentetik `fixture_readiness` verisi veya eksik
attestation reddedilir. Rapor PASS verse bile ham pilot girdisi repoya eklenmez; yalnız
özet ve SHA-256 provenance kaydı saklanır.

## Telemetri olay sözleşmesi

Her olay `eventId`, `workspaceId`, `occurredAt` ve `type` taşır. Hesap olayları ayrıca
`accountId`, güvenlik olayları `incidentId`, geri bildirim olayı ise `value` taşır.

| `type` | ek alanlar | ölçüm etkisi |
|---|---|---|
| `account_connected` | `accountId` | Aktivasyon başlangıcı |
| `dashboard_verified` | `accountId` | İlk doğrulanmış dashboard |
| `sync_completed` | `accountId` | En son veri tazeliği |
| `insight_feedback` | `value`: `helpful`, `unhelpful`, `acted` | Öneri fayda oranı |
| `security_incident_opened` | `incidentId`, `severity` | Açık kritik olay sayısı |
| `security_incident_resolved` | `incidentId` | Açık olayın kapanması |

Aynı `eventId` ve aynı içerik tekrar gelirse tek olay sayılır. Aynı kimliğin farklı içerikle
kullanılması, açılışı olmayan incident çözümü, bağlantıdan önce dashboard/sync ve bir hesap
için üç zorunlu olaydan herhangi birinin eksikliği rapor üretimini durdurur. Olay sırası girdi
dosyasında önemli değildir; çıktı çalışma alanı ve hesap kimliğine göre deterministik sıralanır.

Manuel aggregate biçimi geriye dönük desteklenir; telemetri biçimi zaman çizgisini ve tekrar
işleme davranışını ayrıca doğruladığı için tercih edilir.
