import type { UsageCalendarDay, UsagePeriodSummary, UsagePoint, UsageUnit } from '../models/usage';
import { eachDayOfInterval, endOfMonth, endOfWeek, formatIsoDate, parseIsoDate, startOfMonth, startOfWeek } from './date';

const MONTHLY_SERVICE_CHARGE_UGX = 5320;
const VAT_RATE = 0.18;
const BILLING_TARIERS = [
  { limit: 15, rate: 250 },
  { limit: 65, rate: 756.2 },
  { limit: 70, rate: 412.0 },
  { limit: Number.POSITIVE_INFINITY, rate: 756.2 },
] as const;

export function buildUsageLookup(days: UsagePoint[]): Map<string, UsagePoint> {
  return new Map(days.map((day) => [day.date, day]));
}

export function createCalendarDay(
  date: Date,
  lookup: Map<string, UsagePoint>,
  today: Date,
  fallbackUnit: UsageUnit,
): UsageCalendarDay {
  const key = formatIsoDate(date);
  const match = lookup.get(key);

  return {
    date,
    key,
    usageValue: match?.usageValue ?? null,
    unit: match?.unit ?? fallbackUnit,
    isFuture: match?.isFuture ?? date.getTime() > today.getTime(),
  };
}

export function getWeekDays(
  anchorDate: Date,
  lookup: Map<string, UsagePoint>,
  today: Date,
  fallbackUnit: UsageUnit,
): UsageCalendarDay[] {
  const start = startOfWeek(anchorDate);
  const end = endOfWeek(anchorDate);
  return eachDayOfInterval(start, end).map((day) => createCalendarDay(day, lookup, today, fallbackUnit));
}

export function getMonthDays(
  anchorDate: Date,
  lookup: Map<string, UsagePoint>,
  today: Date,
  fallbackUnit: UsageUnit,
): UsageCalendarDay[] {
  const monthStart = startOfMonth(anchorDate);
  const monthEnd = endOfMonth(anchorDate);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);

  return eachDayOfInterval(gridStart, gridEnd).map((day) => ({
    ...createCalendarDay(day, lookup, today, fallbackUnit),
    isCurrentMonth: day.getMonth() === anchorDate.getMonth(),
  }));
}

export function summarizePeriod(
  days: UsageCalendarDay[],
  usagePoints: UsagePoint[] = [],
  today = new Date(),
  billingMonthAnchor = today,
): UsagePeriodSummary {
  const measuredDays = days.filter((day) => day.usageValue !== null && !day.isFuture);
  const unit = measuredDays[0]?.unit ?? days[0]?.unit ?? 'kWh';
  const totalUsage = measuredDays.reduce((sum, day) => sum + (day.usageValue ?? 0), 0);
  const averageDailyUsage = measuredDays.length > 0 ? totalUsage / measuredDays.length : 0;

  const sorted = [...measuredDays].sort((left, right) => (left.usageValue ?? 0) - (right.usageValue ?? 0));

  return {
    totalUsage: roundToTwo(totalUsage),
    averageDailyUsage: roundToTwo(averageDailyUsage),
    estimatedMonthlyBillUgx: calculateEstimatedMonthlyBillUgx(usagePoints, today, billingMonthAnchor),
    unit,
    lowestUsageDay: sorted[0]?.key,
    highestUsageDay: sorted[sorted.length - 1]?.key,
  };
}

export function calculateEstimatedMonthlyBillUgx(points: UsagePoint[], today: Date, billingMonthAnchor: Date = today): number {
  const monthUsage = points
    .filter((point) => point.unit === 'kWh' && point.usageValue !== null && point.isFuture !== true)
    .filter((point) => {
      const date = parseIsoDate(point.date);
      return (
        date.getFullYear() === billingMonthAnchor.getFullYear() &&
        date.getMonth() === billingMonthAnchor.getMonth() &&
        date.getTime() <= today.getTime()
      );
    })
    .reduce((sum, point) => sum + (point.usageValue ?? 0), 0);

  const energyCharge = calculateTieredEnergyCharge(monthUsage);
  const subtotal = energyCharge + MONTHLY_SERVICE_CHARGE_UGX;
  return Math.round(subtotal * (1 + VAT_RATE));
}

export function formatUgxAmount(value: number): string {
  return new Intl.NumberFormat('en-UG', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value);
}

export function getUsageTier(usageValue: number | null, values: Array<number | null>): number {
  if (usageValue === null) {
    return 0;
  }

  const measured = values.filter((value): value is number => value !== null);
  if (measured.length === 0) {
    return 1;
  }

  const max = Math.max(...measured);
  const min = Math.min(...measured);
  if (max === min) {
    return 2;
  }

  const ratio = (usageValue - min) / (max - min);
  if (ratio < 0.2) return 1;
  if (ratio < 0.45) return 2;
  if (ratio < 0.7) return 3;
  return 4;
}

export function formatUsageValue(usageValue: number | null): string {
  if (usageValue === null) {
    return '--';
  }

  return Number.isInteger(usageValue) ? `${usageValue}` : usageValue.toFixed(1);
}

export function describeSummaryDate(value?: string): string {
  if (!value) {
    return '--';
  }

  const date = parseIsoDate(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function calculateTieredEnergyCharge(usageKwh: number): number {
  let remaining = usageKwh;
  let total = 0;

  for (const tier of BILLING_TARIERS) {
    if (remaining <= 0) {
      break;
    }

    const billedKwh = Math.min(remaining, tier.limit);
    total += billedKwh * tier.rate;
    remaining -= billedKwh;
  }

  return total;
}
