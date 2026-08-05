import type { MeApiResponse } from './models/customer';
import type { UsageApiResponse } from './models/usage';

export async function getMe(accessToken: string): Promise<MeApiResponse> {
  return requestJson<MeApiResponse>('/api/me', accessToken, 'Unable to verify your session.');
}

export async function getUsage(accessToken: string, serviceId?: string): Promise<UsageApiResponse> {
  const query = serviceId ? `?serviceId=${encodeURIComponent(serviceId)}` : '';
  return requestJson<UsageApiResponse>(`/api/usage${query}`, accessToken, 'Unable to load usage.');
}

export async function syncUsage(
  accessToken: string,
  serviceId: string,
): Promise<{ serviceId: string; updatedDays: number; syncedAt: string }> {
  return requestJson('/api/sync-usage', accessToken, 'Unable to synchronize usage.', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceId }),
  });
}

async function requestJson<T>(
  url: string,
  accessToken: string,
  defaultErrorMessage: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await response.text();
  let payload: Record<string, unknown> | null = null;

  if (body) {
    try {
      payload = JSON.parse(body) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (payload && typeof payload.error === 'string') {
      throw new Error(payload.error);
    }

    if (body) {
      throw new Error(body.split('\n')[0] || defaultErrorMessage);
    }

    throw new Error(defaultErrorMessage);
  }

  if (!payload) {
    throw new Error(defaultErrorMessage);
  }

  return payload as unknown as T;
}
