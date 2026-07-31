import { describe, expect, it } from 'vitest';
import type { UsagePoint } from '../models/usage';
import { calculateCurrentUsageCashUgx, calculateEstimatedMonthlyBillUgx, completeMonthlyTotals, isLifelineEligible, summarizePeriod } from './usage';

function buildPoint(date: string, usageValue: number | null, isFuture = false): UsagePoint {
  return {
    date,
    usageValue,
    unit: 'kWh',
    isFuture,
  };
}

describe('usage billing helpers', () => {
  it('includes service charge and VAT when there is no current-month usage', () => {
    expect(calculateCurrentUsageCashUgx([], new Date(2026, 4, 6))).toBe(8638);
  });

  it('prices the first 15 kWh at the first tier', () => {
    expect(calculateCurrentUsageCashUgx([buildPoint('2026-05-01', 15)], new Date(2026, 4, 6))).toBe(13063);
  });

  it('prices the next 65 kWh at the second tier', () => {
    expect(calculateCurrentUsageCashUgx([buildPoint('2026-05-01', 80)], new Date(2026, 4, 6))).toBe(71063);
  });

  it('prices the next 70 kWh at the third tier and anything above 150 at the top tier', () => {
    expect(calculateCurrentUsageCashUgx([buildPoint('2026-05-01', 150)], new Date(2026, 4, 6))).toBe(105094);
    expect(calculateCurrentUsageCashUgx([buildPoint('2026-05-01', 151)], new Date(2026, 4, 6))).toBe(105987);
  });

  it('uses only actual usage from the current month and excludes future or prior-month points', () => {
    const points = [
      buildPoint('2026-04-30', 40),
      buildPoint('2026-05-01', 10),
      buildPoint('2026-05-02', 5),
      buildPoint('2026-05-20', 100, true),
      buildPoint('2026-05-04', null),
    ];

    expect(calculateCurrentUsageCashUgx(points, new Date(2026, 4, 6))).toBe(13063);
  });

  it('uses the visible month when calculating the bill for historical months', () => {
    const points = [
      buildPoint('2026-03-01', 20),
      buildPoint('2026-03-02', 10),
      buildPoint('2026-05-01', 10),
      buildPoint('2026-05-02', 5),
    ];

    expect(calculateCurrentUsageCashUgx(points, new Date(2026, 4, 6), new Date(2026, 2, 15))).toBe(26447);
  });

  it('adds current cash and a pace-based monthly estimate to the usage summary', () => {
    const summary = summarizePeriod(
      [
        {
          date: new Date(2026, 4, 1),
          key: '2026-05-01',
          usageValue: 10,
          unit: 'kWh',
          isFuture: false,
        },
        {
          date: new Date(2026, 4, 2),
          key: '2026-05-02',
          usageValue: 5,
          unit: 'kWh',
          isFuture: false,
        },
      ],
      [buildPoint('2026-05-01', 10), buildPoint('2026-05-02', 5)],
      new Date(2026, 4, 6),
    );

    expect(summary.currentUsageCashUgx).toBe(13063);
    expect(summary.estimatedMonthlyBillUgx).toBe(151941);
  });

  it('uses only days at least 48 hours old for the monthly estimate pace', () => {
    const summary = summarizePeriod(
      [
        {
          date: new Date(2026, 2, 22),
          key: '2026-03-22',
          usageValue: 31,
          unit: 'kWh',
          isFuture: false,
        },
        {
          date: new Date(2026, 2, 23),
          key: '2026-03-23',
          usageValue: 27,
          unit: 'kWh',
          isFuture: false,
        },
        {
          date: new Date(2026, 2, 24),
          key: '2026-03-24',
          usageValue: 24,
          unit: 'kWh',
          isFuture: false,
        },
        {
          date: new Date(2026, 2, 25),
          key: '2026-03-25',
          usageValue: 22,
          unit: 'kWh',
          isFuture: false,
        },
      ],
      [
        buildPoint('2026-03-22', 31),
        buildPoint('2026-03-23', 27),
        buildPoint('2026-03-24', 24),
        buildPoint('2026-03-25', 22),
      ],
      new Date(2026, 2, 25),
    );

    expect(summary.currentUsageCashUgx).toBe(82731);
    expect(summary.estimatedMonthlyBillUgx).toBe(219311);
  });

  it('projects forward from current usage using remaining days in the month', () => {
    // March (31 days): 0 kWh used, 1 kWh/day avg, today=Mar 15 → 16 remaining days → 16 kWh projected
    expect(calculateEstimatedMonthlyBillUgx(0, 1, new Date(2026, 2, 1), new Date(2026, 2, 15))).toBe(13955);
    // April (30 days): same pace but 15 remaining days → 15 kWh projected (one less day)
    expect(calculateEstimatedMonthlyBillUgx(0, 1, new Date(2026, 3, 1), new Date(2026, 3, 15))).toBe(13063);
  });
});

// --- Lifeline 6-month rolling average (#16) ---------------------------------

function fullMonth(year: number, month1: number, dailyKwh: number): UsagePoint[] {
  const days = new Date(year, month1, 0).getDate();
  const pts: UsagePoint[] = [];
  for (let d = 1; d <= days; d++) {
    pts.push(buildPoint(`${year}-${String(month1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, dailyKwh));
  }
  return pts;
}

describe('lifeline eligibility', () => {
  it('aggregates complete past months, excluding the current and any partial month', () => {
    const today = new Date(2026, 6, 15); // Jul 15
    const points = [
      ...fullMonth(2026, 5, 4), // May: 31 x 4 = 124 (complete)
      ...fullMonth(2026, 6, 5), // Jun: 30 x 5 = 150 (complete)
      buildPoint('2026-07-01', 3), // current month (partial) -> excluded
      // April, only 10 days -> partial -> excluded
      ...Array.from({ length: 10 }, (_, i) => buildPoint(`2026-04-${String(i + 1).padStart(2, '0')}`, 2)),
    ];
    expect(completeMonthlyTotals(points, today)).toEqual([150, 124]); // most recent first
  });

  it('defaults to eligible with fewer than 6 complete months (court-safe)', () => {
    expect(isLifelineEligible([])).toBe(true);
    expect(isLifelineEligible([300, 300, 300, 300, 300])).toBe(true); // 5 months, still eligible
  });

  it('denies the lifeline only when the 6-month average exceeds 100', () => {
    expect(isLifelineEligible([120, 120, 120, 120, 120, 120])).toBe(false); // avg 120
    expect(isLifelineEligible([90, 90, 90, 90, 90, 90])).toBe(true); // avg 90
    expect(isLifelineEligible([50, 50, 50, 50, 50, 50, 500])).toBe(true); // only most-recent 6 count
  });

  it('drops the 250 discount on the first 15 units when a customer is not eligible', () => {
    const today = new Date(2026, 4, 6); // May 6
    const pts = [buildPoint('2026-05-01', 15)];
    const eligible = calculateCurrentUsageCashUgx(pts, today, today, true);
    const notEligible = calculateCurrentUsageCashUgx(pts, today, today, false);
    expect(eligible).toBe(13063); // (15*250 + 7320)*1.18
    expect(notEligible).toBe(22022); // first 15 at 756.2: (15*756.2 + 7320)*1.18
    expect(notEligible).toBeGreaterThan(eligible);
  });

  it('applies denial through summarizePeriod once 6 complete months exceed 100', () => {
    const today = new Date(2026, 6, 6); // Jul 6
    const history = [
      ...fullMonth(2026, 1, 4), ...fullMonth(2026, 2, 4), ...fullMonth(2026, 3, 4),
      ...fullMonth(2026, 4, 4), ...fullMonth(2026, 5, 4), ...fullMonth(2026, 6, 4), // avg ~120 -> not eligible
      buildPoint('2026-07-01', 15), // current month usage
    ];
    const summary = summarizePeriod([], history, today, today);
    expect(summary.currentUsageCashUgx).toBe(22022); // non-lifeline first-15 rate applied
  });
});
