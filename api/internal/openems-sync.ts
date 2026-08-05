import { timingSafeEqual } from 'node:crypto';
import { syncAllOpenEmsMeters } from '../../server/openems-sync.js';

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const configuredSecret = process.env.OPENEMS_SYNC_SECRET;
  const authorization = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;
  const suppliedSecret = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';

  if (!configuredSecret || !secretsMatch(configuredSecret, suppliedSecret)) {
    response.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  try {
    const result = await syncAllOpenEmsMeters();
    response.status(200).json(result);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to synchronize OpenEMS meters.' });
  }
}

function secretsMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}
