import type { UsageCalendarDay, UsagePeriodSummary, UsagePoint, UsageUnit } from '../models/usage';
import { addDays, eachDayOfInterval, endOfMonth, endOfWeek, formatIsoDate, parseIsoDate, startOfMonth, startOfWeek } from './date';

// NFE's OWN monthly service charge - a deliberate premium over UEDCL's (which is
// 3,360 on NFE's Code 10.2 bill), NOT a pass-through. Launched at 5,320 for a
// better experience than UEDCL; raised by 2,000 to 7,320 for the battery backup
// that now covers daytime outages. Business rate, not the regulator's. See #15 + docs.
const MONTHLY_SERVICE_CHARGE_UGX = 7320;
const VAT_RATE = 0.18;
const BILLING_TARIERS = [
  { limit: 15, rate: 250 },
  { limit: 65, rate: 756.2 },
  { limit: 70, rate: 412.0 },
  { limit: Number.POSITIVE_INFINITY, rate: 756.2 },
] as const;

// Lifeline (first 15 units at 250) applies only to domestic customers whose rolling
// average over the previous 6 COMPLETE months is <= 100 kWh (ERA). Enforcement waits
// for a defendable 6-month window; before that the customer is never denied (court-
// safe: you cannot apply the tariff on a basis the regulation does not define). See #16.
const LIFELINE_WINDOW_MONTHS = 6;
const LIFELINE_MAX_AVG_KWH = 100;

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
    isPartial: match?.isPartial ?? false,
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
  const fullyMeasuredCutoff = addDays(today, -2);
  const sorted = [...measuredDays].sort((left, right) => (left.usageValue ?? 0) - (right.usageValue ?? 0));

  // Lifeline eligibility from the customer's own history. Defaults to eligible until
  // there is a defendable 6-month window of complete months (see isLifelineEligible).
  const lifelineEligible = isLifelineEligible(completeMonthlyTotals(usagePoints, today));
  const currentUsageCashUgx = calculateCurrentUsageCashUgx(usagePoints, today, billingMonthAnchor, lifelineEligible);

  // Use the last 5 fully-measured days (rolling window) for the daily pace.
  // This avoids zero days from before the customer joined skewing the average.
  // On the last day of the month remaining days = 0, so estimate = current bill automatically.
  const recentDays = [...measuredDays]
    .filter((day) => day.date.getTime() <= fullyMeasuredCutoff.getTime())
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 7);
  const recentUsage = recentDays.reduce((sum, day) => sum + (day.usageValue ?? 0), 0);
  const activeDailyAverage = recentDays.length > 0 ? recentUsage / recentDays.length : 0;

  return {
    totalUsage: roundToTwo(totalUsage),
    averageDailyUsage: roundToTwo(averageDailyUsage),
    currentUsageCashUgx,
    estimatedMonthlyBillUgx: calculateEstimatedMonthlyBillUgx(totalUsage, activeDailyAverage, billingMonthAnchor, today, lifelineEligible),
    unit,
    lowestUsageDay: sorted[0]?.key,
    highestUsageDay: sorted[sorted.length - 1]?.key,
  };
}

export function calculateCurrentUsageCashUgx(points: UsagePoint[], today: Date, billingMonthAnchor: Date = today, lifelineEligible = true): number {
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

  return calculateBillUgx(monthUsage, lifelineEligible);
}

export function calculateEstimatedMonthlyBillUgx(
  currentUsageKwh: number,
  averageDailyUsage: number,
  billingMonthAnchor: Date,
  today: Date,
  lifelineEligible = true,
): number {
  const daysInMonth = endOfMonth(billingMonthAnchor).getDate();
  const remainingDays = Math.max(0, daysInMonth - today.getDate());
  return calculateBillUgx(currentUsageKwh + averageDailyUsage * remainingDays, lifelineEligible);
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

function calculateTieredEnergyCharge(usageKwh: number, lifelineEligible: boolean): number {
  let remaining = usageKwh;
  let total = 0;

  for (let i = 0; i < BILLING_TARIERS.length; i++) {
    if (remaining <= 0) {
      break;
    }

    const tier = BILLING_TARIERS[i];
    const billedKwh = Math.min(remaining, tier.limit);
    // A customer who is NOT lifeline-eligible gets no 250 discount on the first 15
    // units: that block is charged at the standard band rate instead.
    const rate = i === 0 && !lifelineEligible ? BILLING_TARIERS[1].rate : tier.rate;
    total += billedKwh * rate;
    remaining -= billedKwh;
  }

  return total;
}

function calculateBillUgx(usageKwh: number, lifelineEligible = true): number {
  const energyCharge = calculateTieredEnergyCharge(usageKwh, lifelineEligible);
  const subtotal = energyCharge + MONTHLY_SERVICE_CHARGE_UGX;
  return Math.round(subtotal * (1 + VAT_RATE));
}

/**
 * Aggregate daily usage points into COMPLETE calendar-month totals (kWh), most recent
 * first. A month counts as complete only if it is fully in the past (before the current
 * month) and has data for essentially the whole month (allowing a couple of missing
 * days). The current, in-progress month and any partial first month are excluded - they
 * are not defendable billing months for the lifeline test.
 */
export function completeMonthlyTotals(points: UsagePoint[], today: Date): number[] {
  const byMonth = new Map<string, { total: number; days: Set<string> }>();
  for (const point of points) {
    if (point.unit !== 'kWh' || point.usageValue === null || point.isFuture === true) {
      continue;
    }
    const key = point.date.slice(0, 7); // YYYY-MM
    const entry = byMonth.get(key) ?? { total: 0, days: new Set<string>() };
    entry.total += point.usageValue ?? 0;
    entry.days.add(point.date);
    byMonth.set(key, entry);
  }

  const currentMonth = formatIsoDate(today).slice(0, 7);
  const complete: Array<{ month: string; total: number }> = [];
  for (const [month, entry] of byMonth) {
    if (month >= currentMonth) {
      continue; // current or future month = not a complete billing month
    }
    const [year, monthNum] = month.split('-').map(Number);
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    if (entry.days.size >= daysInMonth - 2) {
      complete.push({ month, total: entry.total });
    }
  }
  complete.sort((a, b) => (a.month < b.month ? 1 : -1)); // most recent first
  return complete.map((c) => c.total);
}

/**
 * Lifeline eligibility from a customer's complete monthly totals (most recent first).
 *
 * Court-safe rule: never deny the lifeline without a defendable full 6-month window.
 * With fewer than 6 complete months we return true (eligible) - you cannot apply ERA's
 * "previous six-month period" test on an incomplete basis. With >= 6 complete months,
 * eligibility is the average of the most recent 6 being <= 100 kWh.
 */
export function isLifelineEligible(completeMonths: number[]): boolean {
  if (completeMonths.length < LIFELINE_WINDOW_MONTHS) {
    return true;
  }
  const window = completeMonths.slice(0, LIFELINE_WINDOW_MONTHS);
  const average = window.reduce((sum, value) => sum + value, 0) / LIFELINE_WINDOW_MONTHS;
  return average <= LIFELINE_MAX_AVG_KWH;
}
