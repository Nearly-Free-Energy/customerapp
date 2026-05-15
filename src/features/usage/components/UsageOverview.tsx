import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getUsage } from '../../../api';
import { BottomControlTray } from '../../../components/BottomControlTray';
import { UsageSummary } from '../../../components/UsageSummary';
import { MonthlyCalendar } from '../../../components/MonthlyCalendar';
import type { UtilityAccount, UtilityService } from '../../../models/customer';
import type { UsageApiResponse } from '../../../models/usage';
import { addMonths, formatMonthYear, parseIsoDate } from '../../../utils/date';
import { buildUsageLookup, getMonthDays, summarizePeriod } from '../../../utils/usage';

const INITIAL_ANCHOR_DATE = parseIsoDate('2026-03-22');

type UsageOverviewProps = {
  accessToken: string;
  accounts: UtilityAccount[];
  services: UtilityService[];
  previewUsageData?: UsageApiResponse;
};

export function UsageOverview({ accessToken, accounts, services, previewUsageData }: UsageOverviewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [anchorDate, setAnchorDate] = useState<Date>(INITIAL_ANCHOR_DATE);
  const [selectedDayKey, setSelectedDayKey] = useState<string | undefined>(undefined);
  const [usageData, setUsageData] = useState<UsageApiResponse | null>(previewUsageData ?? null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);
  const electricServices = services.filter((service) => service.serviceType === 'electric' && service.status === 'active');
  const requestedServiceId = searchParams.get('serviceId');
  const selectedServiceId = requestedServiceId ?? electricServices[0]?.id ?? undefined;

  useEffect(() => {
    if (previewUsageData) {
      return;
    }

    if (!requestedServiceId && electricServices[0]?.id) {
      setSearchParams({ serviceId: electricServices[0].id }, { replace: true });
    }
  }, [electricServices, previewUsageData, requestedServiceId, setSearchParams]);

  useEffect(() => {
    if (previewUsageData) {
      setUsageData(previewUsageData);
      setUsageError(null);
      setIsLoadingUsage(false);
      setAnchorDate(parseIsoDate(previewUsageData.today));
      setSelectedDayKey(undefined);
      return;
    }

    if (!selectedServiceId) {
      setUsageData(null);
      setUsageError('No active electric service is available for usage.');
      setIsLoadingUsage(false);
      return;
    }

    let isMounted = true;

    async function loadUsage() {
      setIsLoadingUsage(true);
      setUsageError(null);

      try {
        const nextUsage = await getUsage(accessToken, selectedServiceId);
        if (!isMounted) {
          return;
        }

        setUsageData(nextUsage);
        setAnchorDate(parseIsoDate(nextUsage.today));
        setSelectedDayKey(undefined);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Unable to load usage.';
        setUsageError(message);
      } finally {
        if (isMounted) {
          setIsLoadingUsage(false);
        }
      }
    }

    void loadUsage();

    return () => {
      isMounted = false;
    };
  }, [accessToken, previewUsageData, selectedServiceId]);

  const usagePoints = usageData?.points ?? [];
  const usageLookup = buildUsageLookup(usagePoints);
  const fallbackUnit = usageData?.unit ?? 'kWh';
  const usageToday = parseIsoDate(usageData?.today ?? '2026-03-25');
  const monthDays = getMonthDays(anchorDate, usageLookup, usageToday, fallbackUnit);
  const visibleDays = monthDays.filter((day) => day.isCurrentMonth);
  const summary = summarizePeriod(visibleDays, usagePoints, usageToday, anchorDate);
  const periodLabel = formatMonthYear(anchorDate);
  const isViewingCurrentMonth =
    anchorDate.getFullYear() === usageToday.getFullYear() && anchorDate.getMonth() === usageToday.getMonth();

  function handleNavigate(step: -1 | 1) {
    setSelectedDayKey(undefined);
    setAnchorDate((current) => addMonths(current, step));
  }

  function handleServiceChange(nextServiceId: string) {
    setSearchParams({ serviceId: nextServiceId });
  }

  function formatServiceOptionLabel(service: UtilityService) {
    const owningAccount = accounts.find((account) => account.id === service.utilityAccountId);
    const firstName = owningAccount?.displayName.trim().split(/\s+/)[0];
    return firstName ? `${firstName} - ${service.serviceName}` : service.serviceName;
  }

  return (
    <>
      {isLoadingUsage ? <p className="usage-status-message">Loading usage history...</p> : null}
      {usageError ? <p className="usage-status-message" role="alert">{usageError}</p> : null}
      {usageData?.source === 'seeded-demo' ? (
        <p className="usage-status-message">
          Showing seeded platform demo data from the backend until telemetry-backed usage snapshots are available.
        </p>
      ) : null}

      {electricServices.length > 1 ? (
        <section className="service-switcher" aria-label="Service selector">
          <label className="service-switcher__label" htmlFor="usage-service-selector">
            Service
          </label>
          <select
            id="usage-service-selector"
            className="service-switcher__select"
            value={selectedServiceId}
            onChange={(event) => handleServiceChange(event.target.value)}
          >
            {electricServices.map((service) => (
              <option key={service.id} value={service.id}>
                {formatServiceOptionLabel(service)}
              </option>
            ))}
          </select>
        </section>
      ) : null}

      <UsageSummary summary={summary} />

      <MonthlyCalendar days={monthDays} selectedKey={selectedDayKey} onSelect={setSelectedDayKey} />

      <BottomControlTray
        label={periodLabel}
        onPrevious={() => handleNavigate(-1)}
        onNext={() => handleNavigate(1)}
        canNavigateNext={!isViewingCurrentMonth}
      />
    </>
  );
}
