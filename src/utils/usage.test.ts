import { describe, expect, it } from 'vitest';
import type { UsagePoint } from '../models/usage';
import { calculateCurrentUsageCashUgx, calculateEstimatedMonthlyBillUgx, summarizePeriod } from './usage';

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
    expect(calculateCurrentUsageCashUgx([], new Date(2026, 4, 6))).toBe(6278);
  });

  it('prices the first 15 kWh at the first tier', () => {
    expect(calculateCurrentUsageCashUgx([buildPoint('2026-05-01', 15)], new Date(2026, 4, 6))).toBe(10703);
  });

  it('prices the next 65 kWh at the second tier', () => {
    expect(calculateCurrentUsageCashUgx([buildPoint('2026-05-01', 80)], new Date(2026, 4, 6))).toBe(68703);
  });

  it('prices the next 70 kWh at the third tier and anything above 150 at the top tier', () => {
    expect(calculateCurrentUsageCashUgx([buildPoint('2026-05-01', 150)], new Date(2026, 4, 6))).toBe(102734);
    expect(calculateCurrentUsageCashUgx([buildPoint('2026-05-01', 151)], new Date(2026, 4, 6))).toBe(103627);
  });

  it('uses only actual usage from the current month and excludes future or prior-month points', () => {
    const points = [
      buildPoint('2026-04-30', 40),
      buildPoint('2026-05-01', 10),
      buildPoint('2026-05-02', 5),
      buildPoint('2026-05-20', 100, true),
      buildPoint('2026-05-04', null),
    ];

    expect(calculateCurrentUsageCashUgx(points, new Date(2026, 4, 6))).toBe(10703);
  });

  it('uses the visible month when calculating the bill for historical months', () => {
    const points = [
      buildPoint('2026-03-01', 20),
      buildPoint('2026-03-02', 10),
      buildPoint('2026-05-01', 10),
      buildPoint('2026-05-02', 5),
    ];

    expect(calculateCurrentUsageCashUgx(points, new Date(2026, 4, 6), new Date(2026, 2, 15))).toBe(24087);
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

    expect(summary.currentUsageCashUgx).toBe(10703);
    expect(summary.estimatedMonthlyBillUgx).toBe(149581);
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

    expect(summary.currentUsageCashUgx).toBe(80371);
    expect(summary.estimatedMonthlyBillUgx).toBe(216951);
  });

  it('projects forward from current usage using remaining days in the month', () => {
    // March (31 days): 0 kWh used, 1 kWh/day avg, today=Mar 15 → 16 remaining days → 16 kWh projected
    expect(calculateEstimatedMonthlyBillUgx(0, 1, new Date(2026, 2, 1), new Date(2026, 2, 15))).toBe(11595);
    // April (30 days): same pace but 15 remaining days → 15 kWh projected (one less day)
    expect(calculateEstimatedMonthlyBillUgx(0, 1, new Date(2026, 3, 1), new Date(2026, 3, 15))).toBe(10703);
  });
});
