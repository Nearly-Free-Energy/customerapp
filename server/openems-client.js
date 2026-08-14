import { randomUUID } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 20_000;

export class OpenEmsError extends Error {
  constructor(message, code = 'OPENEMS_ERROR') {
    super(message);
    this.name = 'OpenEmsError';
    this.code = code;
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
        throw new OpenEmsError(`OpenEMS request failed with HTTP ${response.status}.`, 'HTTP_ERROR');
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

  return {
    getEdgeConfig(edgeId) {
      return callEdge(edgeId, 'getEdgeConfig', {});
    },

    async queryDailyEnergy({ edgeId, channel, fromDate, toDate, timezone }) {
      const result = await callEdge(edgeId, 'queryHistoricTimeseriesEnergyPerPeriod', {
        fromDate,
        toDate,
        channels: [channel],
        timezone,
        resolution: { value: 1, unit: 'DAYS' },
      });

      return parseDailyEnergyResponse(result, channel, timezone);
    },

    async queryRangeEnergy({ edgeId, channel, fromDate, toDate, timezone }) {
      const result = await callEdge(edgeId, 'queryHistoricTimeseriesEnergy', {
        fromDate,
        toDate,
        channels: [channel],
        timezone,
      });

      return parseRangeEnergyResponse(result, channel);
    },
  };
}

export function parseDailyEnergyResponse(result, channel, timezone) {
  const timestamps = result?.timestamps;
  const values = result?.data?.[channel];
  if (!Array.isArray(timestamps) || !Array.isArray(values) || timestamps.length !== values.length) {
    throw new OpenEmsError('OpenEMS returned malformed historical energy data.', 'INVALID_RESPONSE');
  }

  return timestamps.map((timestamp, index) => {
    const parsedTimestamp = new Date(timestamp);
    if (Number.isNaN(parsedTimestamp.getTime())) {
      throw new OpenEmsError(`OpenEMS returned an invalid timestamp: ${timestamp}.`, 'INVALID_RESPONSE');
    }

    const value = values[index];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new OpenEmsError(`OpenEMS returned an invalid energy value for ${timestamp}.`, 'INVALID_RESPONSE');
    }

    return {
      date: formatDateInTimeZone(parsedTimestamp, timezone),
      value,
    };
  });
}

export function parseRangeEnergyResponse(result, channel) {
  const value = result?.data?.[channel];
  if (value === null || value === undefined) return null;
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
