/** A local admission gate, not a guarantee about an in-flight provider charge. */
export class EnrichmentBudget {
  readonly limitUsd: number;
  reportedUsd = 0;
  reservedUsd = 0;
  haltedReason: string | null = null;
  constructor(limitUsd: number) {
    if (!Number.isFinite(limitUsd) || limitUsd < 0) throw new Error('Budget must be a finite nonnegative USD amount');
    this.limitUsd = limitUsd;
  }
  reserve(amountUsd: number): void {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('Invalid request reservation');
    if (this.haltedReason || this.reportedUsd + this.reservedUsd + amountUsd > this.limitUsd + 1e-9) {
      throw new Error(`Budget stopped request: ${this.haltedReason ?? 'insufficient remaining budget'}`);
    }
    this.reservedUsd += amountUsd;
  }
  settle(reservationUsd: number, usage: unknown): void {
    const cost = usage && typeof usage === 'object' ? (usage as {cost?: unknown}).cost : undefined;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
      // An ambiguous charge must not authorize another request, including after a timeout.
      this.haltedReason = 'provider cost unavailable; no further paid requests';
      return;
    }
    this.reservedUsd = Math.max(0, this.reservedUsd - reservationUsd);
    this.reportedUsd += cost;
    if (cost > reservationUsd + 1e-9 || this.reportedUsd > this.limitUsd + 1e-9) {
      this.haltedReason = 'provider exceeded the request cost allowance; no further paid requests';
    }
  }
}
