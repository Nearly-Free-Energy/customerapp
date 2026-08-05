import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  fetchCustomer: vi.fn(),
  syncService: vi.fn(),
  syncAll: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('../server/customer-data.js', () => ({
  fetchAuthorizedCustomerContext: mocks.fetchCustomer,
}));
vi.mock('../server/openems-sync.js', () => ({
  syncOpenEmsService: mocks.syncService,
  syncAllOpenEmsMeters: mocks.syncAll,
}));

function createResponseRecorder() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      body = value;
    },
  };
  return { response, getStatus: () => statusCode, getBody: () => body };
}

describe('OpenEMS synchronization endpoints', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it.each([
    'aaron.tushabe@nearlyfreeenergy.com',
    'hillary.arinda@nearlyfreeenergy.com',
    'dansturn.kimbowa@nearlyfreeenergy.com',
  ])('allows an authorized shared-access customer to sync the service (%s)', async (email) => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secret');
    mocks.getUser.mockResolvedValue({ data: { user: { email } }, error: null });
    mocks.fetchCustomer.mockResolvedValue({ services: [{ id: 'service-openems', status: 'active' }] });
    mocks.syncService.mockResolvedValue({ updatedDays: 4, syncedAt: '2026-08-05T12:00:00Z' });
    const { default: handler } = await import('../api/sync-usage');
    const recorder = createResponseRecorder();

    await handler(
      { method: 'POST', headers: { authorization: 'Bearer valid' }, body: { serviceId: 'service-openems' } },
      recorder.response,
    );

    expect(recorder.getStatus()).toBe(200);
    expect(recorder.getBody()).toEqual({ serviceId: 'service-openems', updatedDays: 4, syncedAt: '2026-08-05T12:00:00Z' });
  });

  it('rejects a customer who cannot access the requested service', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secret');
    mocks.getUser.mockResolvedValue({ data: { user: { email: 'other@example.com' } }, error: null });
    mocks.fetchCustomer.mockResolvedValue({ services: [] });
    const { default: handler } = await import('../api/sync-usage');
    const recorder = createResponseRecorder();

    await handler(
      { method: 'POST', headers: { authorization: 'Bearer valid' }, body: { serviceId: 'service-openems' } },
      recorder.response,
    );

    expect(recorder.getStatus()).toBe(403);
    expect(mocks.syncService).not.toHaveBeenCalled();
  });

  it('requires the scheduler bearer secret', async () => {
    vi.stubEnv('OPENEMS_SYNC_SECRET', 'scheduler-secret');
    const { default: handler } = await import('../api/internal/openems-sync');
    const unauthorized = createResponseRecorder();
    await handler({ method: 'POST', headers: { authorization: 'Bearer wrong' } }, unauthorized.response);
    expect(unauthorized.getStatus()).toBe(401);

    mocks.syncAll.mockResolvedValue({ processedMeters: 1, successCount: 1, errorCount: 0, updatedDays: 4, meters: [] });
    const authorized = createResponseRecorder();
    await handler({ method: 'POST', headers: { authorization: 'Bearer scheduler-secret' } }, authorized.response);
    expect(authorized.getStatus()).toBe(200);
    expect(mocks.syncAll).toHaveBeenCalledOnce();
  });
});
