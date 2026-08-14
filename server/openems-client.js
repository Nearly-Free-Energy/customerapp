import { randomUUID } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 20_000;
const DAILY_RANGE_CONCURRENCY = 2;

export class OpenEmsError extends Error {
  constructor(message, code = 'OPENEMS_ERROR', status = null) {
    super(message);
    this.name = 'OpenEmsError';
    this.code = code;
    this.status = status;
  }
}

export function resolveOpenEmsConfig(env = process.env) {
  const baseUrl = env.OPENEMS_BASE_URL?.trim();
  const username = env.OPENEMS_USERNAME?.trim();
  const password = env.OPENEMS_PASSWORD;

  if (!baseUrl || !username || !password) {
    throw new OpenEmsError(
      'OpenEMS is not configured. Set OPENEMS_BASE_URL, OPENEMS_USERNAME, and OPENEMS_PASSWORD.',
      'NOT_CONFIGURED',
    );
  }

  return {
    baseUrl,
    username,
    password,
    timeoutMs: parsePositiveInteger(env.OPENEMS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

export function createOpenEmsClient(config = resolveOpenEmsConfig(), options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = resolveJsonRpcEndpoint(config.baseUrl);
  const authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64')}`;

  async function callEdge(edgeId, method, params) {
    if (!edgeId?.trim()) {
      throw new OpenEmsError('An OpenEMS Edge ID is required.', 'INVALID_MAPPING');
    }

    const payloadId = randomUUID();
    const body = await postJsonRpc({
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'edgeRpc',
      params: {
        edgeId: edgeId.trim(),
        payload: {
          jsonrpc: '2.0',
          id: payloadId,
          method,
          params,
        },
      },
    });

    throwForJsonRpcError(body);
    const payload = body?.result?.payload;
    if (!payload || typeof payload !== 'object') {
      throw new OpenEmsError('OpenEMS returned a response without an Edge-RPC payload.', 'INVALID_RESPONSE');
    }
    throwForJsonRpcError(payload);

    if (!payload.result || typeof payload.result !== 'object') {
      throw new OpenEmsError('OpenEMS returned an invalid Edge-RPC result.', 'INVALID_RESPONSE');
    }
    return payload.result;
  }

  async function postJsonRpc(body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new OpenEmsError(`OpenEMS request failed with HTTP ${response.status}.`, 'HTTP_ERROR', response.status);
      }

      try {
        return await response.json();
      } catch {
        throw new OpenEmsError('OpenEMS returned invalid JSON.', 'INVALID_RESPONSE');
      }
    } catch (error) {
      if (error instanceof OpenEmsError) throw error;
      if (error && typeof error === 'object' && error.name === 'AbortError') {
        throw new OpenEmsError('OpenEMS request timed out.', 'TIMEOUT');
      }
      throw new OpenEmsError(
        `Unable to reach OpenEMS: ${error instanceof Error ? error.message : 'unknown network error'}.`,
        'NETWORK_ERROR',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async function queryRangeEnergy({ edgeId, channel, fromDate, toDate, timezone }) {
    const result = await callEdge(edgeId, 'queryHistoricTimeseriesEnergy', {
      fromDate,
      toDate,
      channels: [channel],
      timezone,
    });

    return parseRangeEnergyResponse(result, channel);
  }

  return {
    getEdgeConfig(edgeId) {
      return callEdge(edgeId, 'getEdgeConfig', {});
    },

    async queryDailyEnergy({ edgeId, channel, fromDate, toDate, timezone, currentDate, historyStartDate }) {
      const dates = listIsoDates(fromDate, toDate);
      const readings = [];

      for (let index = 0; index < dates.length; index += DAILY_RANGE_CONCURRENCY) {
        const batch = dates.slice(index, index + DAILY_RANGE_CONCURRENCY);
        readings.push(...await Promise.all(batch.map(async (date) => {
          try {
            const value = await queryRangeEnergy({
              edgeId,
              channel,
              fromDate: date,
              toDate: date === currentDate ? date : addIsoDays(date, 1),
              timezone,
            });
            return { date, value };
          } catch (error) {
            const predatesHistory = historyStartDate && date < historyStartDate;
            if (predatesHistory && error instanceof OpenEmsError && error.code === 'HTTP_ERROR' && error.status === 400) {
              return { date, value: null };
            }
            throw error;
          }
        })));
      }

      return readings;
    },

    queryRangeEnergy,
  };
}

function listIsoDates(fromDate, toDate) {
  if (fromDate > toDate) {
    throw new OpenEmsError('OpenEMS date range is invalid.', 'INVALID_RANGE');
  }

  const dates = [];
  for (let date = fromDate; date <= toDate; date = addIsoDays(date, 1)) dates.push(date);
  return dates;
}

function addIsoDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new OpenEmsError(`OpenEMS date is invalid: ${date}.`, 'INVALID_RANGE');
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function parseRangeEnergyResponse(result, channel) {
  if (!result?.data || !Object.prototype.hasOwnProperty.call(result.data, channel)) {
    throw new OpenEmsError('OpenEMS returned malformed historical range energy.', 'INVALID_RESPONSE');
  }

  const value = result?.data?.[channel];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new OpenEmsError('OpenEMS returned malformed historical range energy.', 'INVALID_RESPONSE');
  }
  return value;
}

export function convertEnergyToKwh(value, unit = 'Wh') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new OpenEmsError('OpenEMS returned a negative or invalid energy value.', 'INVALID_ENERGY');
  }

  const normalizedUnit = unit.trim().toLowerCase();
  if (normalizedUnit === 'wh') return value / 1000;
  if (normalizedUnit === 'kwh') return value;
  throw new OpenEmsError(`Unsupported OpenEMS energy unit: ${unit || '(empty)'}.`, 'INVALID_UNIT');
}

export function findEnergyChannelCandidates(edgeConfig, meterId = '') {
  const components = edgeConfig?.components;
  if (!components || typeof components !== 'object') return [];

  const normalizedMeterId = meterId.toLowerCase();
  const candidates = [];

  for (const [componentId, component] of Object.entries(components)) {
    if (!component || typeof component !== 'object' || !component.channels || typeof component.channels !== 'object') {
      continue;
    }

    for (const [channelId, channel] of Object.entries(component.channels)) {
      if (!channel || typeof channel !== 'object') continue;
      const unit = typeof channel.unit === 'string' ? channel.unit : '';
      if (!['wh', 'kwh'].includes(unit.toLowerCase())) continue;

      const address = `${componentId}/${channelId}`;
      const searchable = `${address} ${component.alias ?? ''} ${channel.text ?? ''}`.toLowerCase();
      if (!/energy/.test(searchable) || !/(buy|consum|import|grid)/.test(searchable)) continue;

      let score = 0;
      if (/gridbuyactiveenergy|activeconsumptionenergy/.test(searchable)) score += 20;
      if (/buy|import/.test(searchable)) score += 10;
      if (componentId === '_sum') score += 5;
      if (normalizedMeterId && searchable.includes(normalizedMeterId)) score += 100;

      candidates.push({ address, unit, score, text: channel.text ?? '', componentAlias: component.alias ?? '' });
    }
  }

  if (candidates.length === 0) {
    candidates.push({
      address: '_sum/ConsumptionActiveEnergy',
      unit: 'Wh',
      score: 25,
      text: 'Consumption Active Energy',
      componentAlias: components._sum?.alias ?? '',
    });

    for (const [componentId, component] of Object.entries(components)) {
      if (componentId === '_sum' || (normalizedMeterId && componentId.toLowerCase() !== normalizedMeterId)) continue;
      candidates.push({
        address: `${componentId}/ActiveConsumptionEnergy`,
        unit: 'Wh',
        score: normalizedMeterId ? 100 : 10,
        text: 'Active Consumption Energy',
        componentAlias: component?.alias ?? '',
      });
    }
  }

  return candidates.sort((left, right) => right.score - left.score || left.address.localeCompare(right.address));
}

function resolveJsonRpcEndpoint(baseUrl) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(normalizedBase);
  if (!url.pathname.endsWith('/jsonrpc/')) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/jsonrpc`;
  }
  return url.toString();
}

function throwForJsonRpcError(message) {
  if (!message?.error) return;
  const code = message.error.code ?? 'unknown';
  const detail = message.error.message ?? 'Unknown OpenEMS JSON-RPC error.';
  throw new OpenEmsError(`OpenEMS JSON-RPC error ${code}: ${detail}`, 'JSON_RPC_ERROR');
}

function formatDateInTimeZone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
