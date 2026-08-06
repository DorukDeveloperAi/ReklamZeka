# Saha pilotu veri girişi

1. [`field-pilot.template.json`](field-pilot.template.json) dosyasını proje dışında veya
   `.gitignore` kapsamındaki güvenli bir konuma kopyalayın.
2. Gerçek çalışma alanı/hesap ölçülerini `PilotWorkspace` sözleşmesine göre doldurun.
   Token, e-posta, müşteri adı veya kişisel veri eklemeyin; anonim kimlikler kullanın.
3. Veriyi doğrulayan kişi `attestation` alanlarını doldurup yalnız gerçek hesaplar olduğunu
   onayladığında `confirmsRealAccounts` değerini `true` yapar.
4. Raporu üretin:

```bash
npm run pilot:field-report -- path/to/field-input.json docs/qa/field-pilot.json
npm run check:field-pilot
```

Üretici mevcut raporun üzerine yazmaz. Sentetik `fixture_readiness` verisi veya eksik
attestation reddedilir. Rapor PASS verse bile ham pilot girdisi repoya eklenmez; yalnız
özet ve SHA-256 provenance kaydı saklanır.
