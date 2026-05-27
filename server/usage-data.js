import { fetchAuthorizedCustomerContext } from './customer-data.js';
import { createServerSupabaseClient } from './supabase-admin.js';

const FALLBACK_BASE_USAGE = [
  28, 24, 22, 20, 19, 18, 23, 26, 30, 31, 27, 25, 24, 21, 18, 17, 20, 29, 34, 37, 32, 26,
  24, 22, 19, 21, 25, 28, 35, 39, 33, 29, 26, 23, 22, 20, 18, 19, 24, 30, 38, 41, 36, 31,
  27, 24, 22, 21, 20, 23, 27, 31, 34, 40, 42, 37, 32, 28, 25, 24, 26, 29, 33, 36, 39, 35,
  30, 27, 22, 20, 18, 17, 19, 21, 28, 32, 34, 38, 36, 31, 29, 26, 24, 22, 21, 20, 23, 25,
  27, 33, 37, 40,
];

export async function fetchAuthorizedUsage(email, serviceIdOrClient = null, maybeClient = null) {
  const serviceId =
    typeof serviceIdOrClient === 'string' || serviceIdOrClient === null ? serviceIdOrClient : null;
  const client =
    typeof serviceIdOrClient === 'string' || serviceIdOrClient === null
      ? maybeClient ?? createServerSupabaseClient()
      : serviceIdOrClient;

  return fetchAuthorizedUsageForService(email, serviceId, client);
}

export async function fetchAuthorizedUsageForService(email, serviceId = null, client = createServerSupabaseClient()) {
  const customer = await fetchAuthorizedCustomerContext(email, client);
  if (!customer) {
    return null;
  }

  const electricServices = customer.services.filter((service) => service.serviceType === 'electric' && service.status === 'active');
  const electricService = serviceId ? electricServices.find((service) => service.id === serviceId) ?? null : electricServices[0] ?? null;

  if (serviceId && !electricService) {
    const error = new Error('Requested service is not available for this account.');
    error.name = 'InvalidServiceError';
    throw error;
  }

  if (!electricService) {
    return buildEmptyUsagePayload(customer.account.id);
  }

  const { data, error } = await client
    .from('usage_daily_snapshots')
    .select('usage_date, usage_kwh, source, is_partial, synced_at')
    .eq('utility_service_id', electricService.id)
    .order('usage_date', { ascending: true });

  if (error) {
    throw new Error(`Unable to load usage history: ${error.message}`);
  }

  if (!data || data.length === 0) {
    if (shouldUseSeededFallback()) {
      return buildFallbackUsagePayload(customer.account.id, electricService);
    }

    return buildEmptyUsagePayload(customer.account.id, electricService);
  }

  const lastRow = data[data.length - 1];
  const latestSyncedAt = data.reduce((latest, row) => {
    if (!row.synced_at) return latest;
    if (!latest) return row.synced_at;
    return row.synced_at > latest ? row.synced_at : latest;
  }, null);

  return {
    accountId: customer.account.id,
    serviceId: electricService.id,
    serviceName: electricService.serviceName,
    unit: 'kWh',
    source: normalizeUsageSource(lastRow?.source),
    today: lastRow?.usage_date ?? formatIsoDate(new Date()),
    lastSyncedAt: latestSyncedAt,
    points: data.map((row) => ({
      date: row.usage_date,
      usageValue: row.usage_kwh === null ? null : Number(row.usage_kwh),
      unit: 'kWh',
      isFuture: false,
      isPartial: row.is_partial ?? false,
    })),
  };
}

function buildEmptyUsagePayload(accountId, service) {
  return {
    accountId,
    serviceId: service?.id ?? null,
    serviceName: service?.serviceName ?? null,
    unit: 'kWh',
    source: 'database',
    today: formatIsoDate(new Date()),
    points: [],
  };
}

function buildFallbackUsagePayload(accountId, service) {
  const startDate = new Date(2026, 0, 1);
  const today = new Date(2026, 2, 25);

  return {
    accountId,
    serviceId: service.id,
    serviceName: service.serviceName,
    unit: 'kWh',
    source: 'seeded-demo',
    today: formatIsoDate(today),
    points: FALLBACK_BASE_USAGE.map((usage, index) => {
      const date = addDays(startDate, index);
      return {
        date: formatIsoDate(date),
        usageValue: usage,
        unit: 'kWh',
        isFuture: date.getTime() > startOfDay(today).getTime(),
      };
    }),
  };
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shouldUseSeededFallback() {
  return process.env.ENABLE_USAGE_DEMO_FALLBACK === 'true';
}

function normalizeUsageSource(source) {
  if (source === 'nextcloud-import') return 'nextcloud-import';
  if (source === 'pi-direct' || source === 'pi-direct-backfill') return 'pi-direct';
  return 'database';
}
