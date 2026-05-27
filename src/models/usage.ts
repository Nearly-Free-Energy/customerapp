export type UsageUnit = 'kWh' | 'gallons' | 'therms';

export type UsagePoint = {
  date: string;
  usageValue: number | null;
  unit: UsageUnit;
  isFuture?: boolean;
  isPartial?: boolean;
};

export type UsageApiResponse = {
  accountId: string;
  serviceId: string | null;
  serviceName: string | null;
  unit: UsageUnit;
  source: 'database' | 'seeded-demo' | 'nextcloud-import' | 'pi-direct';
  today: string;
  lastSyncedAt?: string | null;
  points: UsagePoint[];
};

export type UsagePeriodSummary = {
  totalUsage: number;
  averageDailyUsage: number;
  currentUsageCashUgx: number;
  estimatedMonthlyBillUgx: number;
  unit: UsageUnit;
  highestUsageDay?: string;
  lowestUsageDay?: string;
};

export type UsageCalendarDay = {
  date: Date;
  key: string;
  usageValue: number | null;
  unit: UsageUnit;
  isFuture: boolean;
  isCurrentMonth?: boolean;
  isPartial?: boolean;
};
