import { afterEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  }),
}));

function createResponseRecorder() {
  let statusCode = 200;
  let jsonBody: unknown;

  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(body: unknown) {
      jsonBody = body;
    },
  };

  return {
    response,
    getStatus: () => statusCode,
    getBody: () => jsonBody,
  };
}

function createQueryChain(result: { data: unknown; error: Error | null }, options?: { resolveOnOrder?: boolean }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: options?.resolveOnOrder ? vi.fn().mockResolvedValue(result) : vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => result),
    then: undefined,
  };
}

function createEmptyAccessChain() {
  return createQueryChain({ data: [], error: null }, { resolveOnOrder: true });
}

describe('/api/usage', () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_test');

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    mockGetUser.mockReset();
    mockFrom.mockReset();
  });

  it('returns imported usage snapshots for an authenticated customer', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          email: 'customer@example.com',
        },
      },
      error: null,
    });
    mockFrom.mockReturnValueOnce(
      createQueryChain({
        data: {
          id: 'profile-demo',
          email: 'customer@example.com',
          display_name: 'Customer Demo Profile',
          status: 'active',
        },
        error: null,
      }),
    );
    mockFrom.mockReturnValueOnce(
      createQueryChain(
        {
          data: [
            {
              id: 'account-demo',
              customer_profile_id: 'profile-demo',
              account_number: 'customer-demo',
              display_name: 'Customer Demo Account',
              status: 'active',
            },
          ],
          error: null,
        },
        { resolveOnOrder: true },
      ),
    );
    mockFrom.mockReturnValueOnce(createEmptyAccessChain());
    mockFrom.mockReturnValueOnce(
      createQueryChain(
        {
          data: [
            {
              id: 'service-electric',
              utility_account_id: 'account-demo',
              service_type: 'electric',
              service_name: 'Customer Demo Account Electric Service',
              service_address: null,
              status: 'active',
            },
          ],
          error: null,
        },
        { resolveOnOrder: true },
      ),
    );
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      in: vi.fn(async () => ({
        data: [],
        error: null,
      })),
    });
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            usage_date: '2026-03-22',
            usage_kwh: 31.2,
            source: 'nextcloud-import',
          },
          {
            usage_date: '2026-03-23',
            usage_kwh: 27.8,
            source: 'nextcloud-import',
          },
        ],
        error: null,
      }),
    });

    const { default: handler } = await import('../api/usage');
    const recorder = createResponseRecorder();

    await handler(
      {
        method: 'GET',
        url: '/api/usage?serviceId=service-electric',
        headers: {
          authorization: 'Bearer valid-token',
        },
      },
      recorder.response,
    );

    expect(recorder.getStatus()).toBe(200);
    expect(recorder.getBody()).toEqual({
      accountId: 'account-demo',
      serviceId: 'service-electric',
      serviceName: 'Customer Demo Account Electric Service',
      unit: 'kWh',
      source: 'nextcloud-import',
      today: '2026-03-23',
      lastSyncedAt: null,
      points: [
        {
          date: '2026-03-22',
          usageValue: 31.2,
          unit: 'kWh',
          isFuture: false,
          isPartial: false,
        },
        {
          date: '2026-03-23',
          usageValue: 27.8,
          unit: 'kWh',
          isFuture: false,
          isPartial: false,
        },
      ],
    });
  });

  it('returns an empty database payload when no imported snapshots exist and fallback is disabled', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          email: 'customer@example.com',
        },
      },
      error: null,
    });
    mockFrom.mockReturnValueOnce(
      createQueryChain({
        data: {
          id: 'profile-demo',
          email: 'customer@example.com',
          display_name: 'Customer Demo Profile',
          status: 'active',
        },
        error: null,
      }),
    );
    mockFrom.mockReturnValueOnce(
      createQueryChain(
        {
          data: [
            {
              id: 'account-demo',
              customer_profile_id: 'profile-demo',
              account_number: 'customer-demo',
              display_name: 'Customer Demo Account',
              status: 'active',
            },
          ],
          error: null,
        },
        { resolveOnOrder: true },
      ),
    );
    mockFrom.mockReturnValueOnce(createEmptyAccessChain());
    mockFrom.mockReturnValueOnce(
      createQueryChain(
        {
          data: [
            {
              id: 'service-electric',
              utility_account_id: 'account-demo',
              service_type: 'electric',
              service_name: 'Customer Demo Account Electric Service',
              service_address: null,
              status: 'active',
            },
          ],
          error: null,
        },
        { resolveOnOrder: true },
      ),
    );
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      in: vi.fn(async () => ({
        data: [],
        error: null,
      })),
    });
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [],
        error: null,
      }),
    });

    const { default: handler } = await import('../api/usage');
    const recorder = createResponseRecorder();

    await handler(
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer valid-token',
        },
      },
      recorder.response,
    );

    expect(recorder.getStatus()).toBe(200);
    expect(recorder.getBody()).toMatchObject({
      accountId: 'account-demo',
      serviceId: 'service-electric',
      source: 'database',
      points: [],
    });
  });

  it('returns 403 when the requested service is not available for the account', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          email: 'customer@example.com',
        },
      },
      error: null,
    });
    mockFrom.mockReturnValueOnce(
      createQueryChain({
        data: {
          id: 'profile-demo',
          email: 'customer@example.com',
          display_name: 'Customer Demo Profile',
          status: 'active',
        },
        error: null,
      }),
    );
    mockFrom.mockReturnValueOnce(
      createQueryChain(
        {
          data: [
            {
              id: 'account-demo',
              customer_profile_id: 'profile-demo',
              account_number: 'customer-demo',
              display_name: 'Customer Demo Account',
              status: 'active',
            },
          ],
          error: null,
        },
        { resolveOnOrder: true },
      ),
    );
    mockFrom.mockReturnValueOnce(createEmptyAccessChain());
    mockFrom.mockReturnValueOnce(
      createQueryChain(
        {
          data: [
            {
              id: 'service-electric',
              utility_account_id: 'account-demo',
              service_type: 'electric',
              service_name: 'Customer Demo Account Electric Service',
              service_address: null,
              status: 'active',
            },
          ],
          error: null,
        },
        { resolveOnOrder: true },
      ),
    );
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      in: vi.fn(async () => ({
        data: [],
        error: null,
      })),
    });

    const { default: handler } = await import('../api/usage');
    const recorder = createResponseRecorder();

    await handler(
      {
        method: 'GET',
        url: '/api/usage?serviceId=service-other',
        headers: {
          authorization: 'Bearer valid-token',
        },
      },
      recorder.response,
    );

    expect(recorder.getStatus()).toBe(403);
    expect(recorder.getBody()).toEqual({
      error: 'Requested service is not available for this account.',
    });
  });
});
