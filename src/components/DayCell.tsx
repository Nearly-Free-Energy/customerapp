import type { UsageCalendarDay } from '../models/usage';
import { formatUsageValue, getUsageTier } from '../utils/usage';

type DayCellProps = {
  day: UsageCalendarDay;
  comparisonValues: Array<number | null>;
  variant: 'week' | 'month';
  selected?: boolean;
  onSelect?: (key: string) => void;
};

export function DayCell({ day, comparisonValues, variant, selected = false, onSelect }: DayCellProps) {
  const tier = day.isFuture ? 0 : getUsageTier(day.usageValue, comparisonValues);
  const classes = [
    'day-cell',
    `day-cell--tier-${tier}`,
    variant === 'month' ? 'day-cell--month' : 'day-cell--week',
    day.isFuture ? 'day-cell--muted' : '',
    day.isCurrentMonth === false ? 'day-cell--outside' : '',
    selected ? 'day-cell--selected' : '',
    day.isPartial && !day.isFuture ? 'day-cell--partial' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const fullDateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(day.date);

  return (
    <button
      type="button"
      className={classes}
      onClick={() => onSelect?.(day.key)}
      aria-pressed={selected}
      aria-label={`${fullDateLabel}, ${formatUsageValue(day.usageValue)} ${day.unit}${day.isPartial ? ' (today so far)' : ''}`}
    >
      <span className="day-cell__date">{day.date.getDate()}</span>
      <span className="day-cell__usage">{formatUsageValue(day.usageValue)}</span>
      <span className="day-cell__unit">{day.isPartial && !day.isFuture ? 'so far' : day.unit}</span>
    </button>
  );
}
