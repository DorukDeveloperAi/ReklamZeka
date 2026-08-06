export type OperationalSample = Readonly<{
  at: string;
  syncLagMinutes: number;
  syncAttempts: number;
  syncFailures: number;
  rateLimitRemainingRatio: number;
  expectedInsights: boolean;
  insightsGenerated: number;
}>;

export type AlarmCode = "sync_lag" | "sync_error_rate" | "rate_limit" | "insight_generation";
export type OperationalAlarm = Readonly<{
  code: AlarmCode;
  status: "open" | "resolved";
  observedAt: string;
  reason: string;
  runbook: string;
}>;

const RUNBOOKS: Record<AlarmCode, string> = {
  sync_lag: "Connector cursor ve kuyruk yaşını kontrol et; güvenli retry çalıştır.",
  sync_error_rate: "Hata sınıfını ayır; auth ise bağlantı yenile, transient ise backoff uygula.",
  rate_limit: "İstek hızını düşür; Retry-After ve cursor checkpoint'ini koru.",
  insight_generation: "Snapshot şema sürümünü ve kural hatalarını kontrol et; önceki geçerli içgörüleri değiştirme.",
};

export class OperationalMonitor {
  private readonly states = new Map<AlarmCode, OperationalAlarm>();

  evaluate(sample: OperationalSample): readonly OperationalAlarm[] {
    const errorRate = sample.syncAttempts === 0 ? 0 : sample.syncFailures / sample.syncAttempts;
    const conditions: Record<AlarmCode, Readonly<{ open: boolean; reason: string }>> = {
      sync_lag: { open: sample.syncLagMinutes > 60, reason: `Sync gecikmesi ${sample.syncLagMinutes} dakika` },
      sync_error_rate: { open: sample.syncAttempts >= 5 && errorRate > 0.1, reason: `Sync hata oranı %${Math.round(errorRate * 100)}` },
      rate_limit: { open: sample.rateLimitRemainingRatio < 0.1, reason: `Kalan connector kotası %${Math.round(sample.rateLimitRemainingRatio * 100)}` },
      insight_generation: { open: sample.expectedInsights && sample.insightsGenerated === 0, reason: "Beklenen snapshot için içgörü üretilmedi" },
    };
    for (const code of Object.keys(conditions) as AlarmCode[]) {
      const condition = conditions[code];
      const previous = this.states.get(code);
      const status = condition.open ? "open" : "resolved";
      if (!previous || previous.status !== status) {
        this.states.set(code, { code, status, observedAt: sample.at, reason: condition.reason, runbook: RUNBOOKS[code] });
      }
    }
    return this.current();
  }

  current(): readonly OperationalAlarm[] {
    return [...this.states.values()].sort((left, right) => left.code.localeCompare(right.code));
  }
}
