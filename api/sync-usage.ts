import { fetchAuthorizedCustomerContext } from '../server/customer-data.js';
import { createAuthVerifier, extractBearerToken } from '../server/api-auth.js';
import { OpenEmsError } from '../server/openems-client.js';
import { syncOpenEmsService } from '../server/openems-sync.js';

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

const verifyAccessToken = createAuthVerifier();
const inFlight = new Map<string, Promise<unknown>>();
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 15_000;

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const token = extractBearerToken(request.headers);
  if (!token) {
    response.status(401).json({ error: 'Missing bearer token.' });
    return;
  }

  let user: { email: string };
  try {
    user = await verifyAccessToken(token);
  } catch (error) {
    response.status(401).json({ error: error instanceof Error ? error.message : 'Unable to verify the Supabase session.' });
    return;
  }

  try {
    const serviceId = extractServiceId(request.body);
    if (!serviceId) {
      response.status(400).json({ error: 'A serviceId is required.' });
      return;
    }

    const customer = await fetchAuthorizedCustomerContext(user.email);
    const service = customer?.services.find((candidate) => candidate.id === serviceId && candidate.status === 'active');
    if (!service) {
      response.status(403).json({ error: 'Requested service is not available for this account.' });
      return;
    }

    const key = serviceId;
    const retryAt = cooldowns.get(key) ?? 0;
    if (retryAt > Date.now()) {
      response.status(429).json({
        error: 'Please wait before synchronizing this service again.',
        retryAfterSeconds: Math.ceil((retryAt - Date.now()) / 1000),
      });
      return;
    }
    if (inFlight.has(key)) {
      response.status(409).json({ error: 'This service is already being synchronized.' });
      return;
    }

    const synchronization = syncOpenEmsService(serviceId);
    inFlight.set(key, synchronization);
    try {
      const result = await synchronization;
      cooldowns.set(key, Date.now() + COOLDOWN_MS);
      response.status(200).json({ serviceId, updatedDays: result.updatedDays, syncedAt: result.syncedAt });
    } finally {
      inFlight.delete(key);
    }
  } catch (error) {
    if (error instanceof OpenEmsError && error.code === 'NOT_OPENEMS') {
      response.status(409).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Unable to synchronize usage.';
    response.status(error instanceof OpenEmsError ? 502 : 500).json({ error: message });
  }
}

function extractServiceId(body: unknown): string | null {
  let value = body;
  if (typeof body === 'string') {
    try {
      value = JSON.parse(body) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || !('serviceId' in value)) return null;
  const serviceId = (value as { serviceId?: unknown }).serviceId;
  return typeof serviceId === 'string' && serviceId.trim() ? serviceId.trim() : null;
}
