import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import type { MeApiResponse } from './models/customer';
import type { UsageApiResponse } from './models/usage';

const authStateListeners: Array<(event: string, session: unknown) => void> = [];
const apiMocks = vi.hoisted(() => ({
  getMe: vi.fn(async (): Promise<MeApiResponse> => ({
    email: 'customer@example.com',
    profile: {
      id: 'profile-demo',
      displayName: 'Customer Demo Profile',
      status: 'active',
    },
    account: {
      id: 'account-demo',
      accountNumber: 'customer-demo',
      displayName: 'Customer Demo Account',
      status: 'active',
    },
    accounts: [
      {
        id: 'account-demo',
        accountNumber: 'customer-demo',
        displayName: 'Customer Demo Account',
        status: 'active',
      },
    ],
    services: [
      {
        id: 'service-demo',
        utilityAccountId: 'account-demo',
        serviceType: 'electric',
        serviceName: 'Customer Demo Account Electric Service',
        serviceAddress: null,
        status: 'active',
      },
    ],
    microgrids: [
      {
        id: 'microgrid-demo',
        microgridCode: 'demo-microgrid',
        displayName: 'Demo Microgrid',
        status: 'active',
        timezone: 'Africa/Kampala',
        gateways: [
          {
            id: 'gateway-demo',
            gatewaySlug: 'gw-aaron',
            displayName: 'Aaron Test Gateway',
            status: 'active',
            devices: [
              {
                id: 'device-demo',
                deviceSlug: 'meter-main',
                deviceType: 'single-phase-smart-meter',
                vendorModel: 'Chint DDSU666',
                status: 'active',
              },
            ],
          },
        ],
      },
    ],
  })),
  getUsage: vi.fn(async (): Promise<UsageApiResponse> => ({
    accountId: 'account-demo',
    serviceId: 'service-demo',
    serviceName: 'Customer Demo Account Electric Service',
    unit: 'kWh',
    source: 'seeded-demo',
    today: '2026-03-25',
    points: [
      { date: '2026-03-22', usageValue: 31, unit: 'kWh', isFuture: false },
      { date: '2026-03-23', usageValue: 27, unit: 'kWh', isFuture: false },
      { date: '2026-03-24', usageValue: 24, unit: 'kWh', isFuture: false },
      { date: '2026-03-25', usageValue: 22, unit: 'kWh', isFuture: false },
    ],
  })),
}));

vi.mock('./api', () => ({
  getMe: apiMocks.getMe,
  getUsage: apiMocks.getUsage,
}));

vi.mock('./supabase', () => {
  const signInWithOtp = vi.fn(async () => ({ error: null }));
  const signOut = vi.fn(async () => ({ error: null }));
  const getSession = vi.fn(async () => ({
    data: {
      session: {
        access_token: 'test-token',
        user: {
          email: 'customer@example.com',
        },
      },
    },
    error: null,
  }));

  return {
    supabase: {
      auth: {
        signInWithOtp,
        signOut,
        getSession,
        onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
          authStateListeners.push(callback);
          return {
            data: {
              subscription: {
                unsubscribe: vi.fn(),
              },
            },
          };
        },
      },
    },
  };
});

describe('Electricity consumption dashboard', () => {
  function renderApp(initialEntry = '/') {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <App />
      </MemoryRouter>,
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
    authStateListeners.length = 0;
    apiMocks.getMe.mockReset();
    apiMocks.getUsage.mockReset();
    apiMocks.getMe.mockResolvedValue({
      email: 'customer@example.com',
      profile: {
        id: 'profile-demo',
        displayName: 'Customer Demo Profile',
        status: 'active',
      },
      account: {
        id: 'account-demo',
        accountNumber: 'customer-demo',
        displayName: 'Customer Demo Account',
        status: 'active',
      },
      accounts: [
        {
          id: 'account-demo',
          accountNumber: 'customer-demo',
          displayName: 'Customer Demo Account',
          status: 'active',
        },
        {
          id: 'account-other',
          accountNumber: 'customer-other',
          displayName: 'Ntale Peter',
          status: 'active',
        },
      ],
      services: [
        {
          id: 'service-demo',
          utilityAccountId: 'account-demo',
          serviceType: 'electric',
          serviceName: 'Customer Demo Account Electric Service',
          serviceAddress: null,
          status: 'active',
        },
      ],
      microgrids: [
        {
          id: 'microgrid-demo',
          microgridCode: 'demo-microgrid',
          displayName: 'Demo Microgrid',
          status: 'active',
          timezone: 'Africa/Kampala',
          gateways: [
            {
              id: 'gateway-demo',
              gatewaySlug: 'gw-aaron',
              displayName: 'Aaron Test Gateway',
              status: 'active',
              devices: [
                {
                  id: 'device-demo',
                  deviceSlug: 'meter-main',
                  deviceType: 'single-phase-smart-meter',
                  vendorModel: 'Chint DDSU666',
                  status: 'active',
                },
              ],
            },
          ],
        },
      ],
    });
    apiMocks.getUsage.mockResolvedValue({
      accountId: 'account-demo',
      serviceId: 'service-demo',
      serviceName: 'Customer Demo Account Electric Service',
      unit: 'kWh',
      source: 'seeded-demo',
      today: '2026-03-25',
      points: [
        { date: '2026-03-22', usageValue: 31, unit: 'kWh', isFuture: false },
        { date: '2026-03-23', usageValue: 27, unit: 'kWh', isFuture: false },
        { date: '2026-03-24', usageValue: 24, unit: 'kWh', isFuture: false },
        { date: '2026-03-25', usageValue: 22, unit: 'kWh', isFuture: false },
      ],
    });
  });

  it('renders the signed-in dashboard and keeps controls at the bottom', async () => {
    renderApp();

    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as customer@example.com for Customer Demo Account/i)).not.toBeInTheDocument();
    expect(apiMocks.getMe).toHaveBeenCalledWith('test-token');
    expect(apiMocks.getUsage).toHaveBeenCalledWith('test-token', 'service-demo');
    expect(screen.queryByRole('heading', { name: 'Electricity Consumption' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Monthly utility usage')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Usage' })).toHaveClass('section-nav__link--active');
    expect(screen.getByRole('link', { name: 'Account' })).toBeInTheDocument();

    const weekdayRow = screen.getByLabelText('Monthly utility usage').querySelector('.weekday-row');
    expect(weekdayRow).not.toBeNull();

    for (const weekday of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      expect(within(weekdayRow as HTMLElement).getByText(weekday, { selector: 'span' })).toBeInTheDocument();
    }

    const controls = screen.getByLabelText('Bottom calendar controls');
    expect(within(controls).queryByRole('button', { name: 'Week' })).not.toBeInTheDocument();
    expect(within(controls).queryByRole('button', { name: 'Month' })).not.toBeInTheDocument();
    expect(within(controls).getByText('Mar 2026')).toBeInTheDocument();
    expect(await screen.findByText(/Showing seeded platform demo data from the backend/i)).toBeInTheDocument();
    expect(screen.getByText('Estimated End of Month Bill')).toBeInTheDocument();
  });

  it('renders a service selector and reloads usage when switching services', async () => {
    const user = userEvent.setup();
    apiMocks.getMe.mockResolvedValueOnce({
      email: 'customer@example.com',
      profile: {
        id: 'profile-demo',
        displayName: 'Customer Demo Profile',
        status: 'active',
      },
      account: {
        id: 'account-demo',
        accountNumber: 'customer-demo',
        displayName: 'Customer Demo Account',
        status: 'active',
      },
      accounts: [
        {
          id: 'account-demo',
          accountNumber: 'customer-demo',
          displayName: 'Customer Demo Account',
          status: 'active',
        },
        {
          id: 'account-other',
          accountNumber: 'customer-other',
          displayName: 'Ntale Peter',
          status: 'active',
        },
      ],
      services: [
        {
          id: 'service-a',
          utilityAccountId: 'account-demo',
          serviceType: 'electric',
          serviceName: 'Electric Service • 221123297561',
          serviceAddress: null,
          status: 'active',
        },
        {
          id: 'service-b',
          utilityAccountId: 'account-other',
          serviceType: 'electric',
          serviceName: 'Electric Service • 200326019929',
          serviceAddress: null,
          status: 'active',
        },
      ],
      microgrids: [],
    });
    apiMocks.getUsage.mockResolvedValue({
      accountId: 'account-demo',
      serviceId: 'service-a',
      serviceName: 'Electric Service • 221123297561',
      unit: 'kWh',
      source: 'nextcloud-import',
      today: '2026-03-25',
      points: [
        { date: '2026-03-22', usageValue: 31, unit: 'kWh', isFuture: false },
        { date: '2026-03-23', usageValue: 27, unit: 'kWh', isFuture: false },
      ],
    });

    renderApp('/usage');

    const selector = await screen.findByLabelText('Service');
    expect(selector).toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: 'Customer - Electric Service • 221123297561' })).toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: 'Ntale - Electric Service • 200326019929' })).toBeInTheDocument();
    expect(apiMocks.getUsage).toHaveBeenCalledWith('test-token', 'service-a');

    apiMocks.getUsage.mockResolvedValueOnce({
      accountId: 'account-demo',
      serviceId: 'service-b',
      serviceName: 'Electric Service • 200326019929',
      unit: 'kWh',
      source: 'nextcloud-import',
      today: '2026-03-25',
      points: [
        { date: '2026-03-24', usageValue: 19, unit: 'kWh', isFuture: false },
        { date: '2026-03-25', usageValue: 18, unit: 'kWh', isFuture: false },
      ],
    });

    await user.selectOptions(selector, 'service-b');
    expect(apiMocks.getUsage).toHaveBeenLastCalledWith('test-token', 'service-b');
  });

  it('stays in month view and shows a month label', async () => {
    renderApp();

    await screen.findByLabelText('Monthly utility usage');

    expect(screen.getByLabelText('Monthly utility usage')).toBeInTheDocument();
    expect(screen.getByText('Mar 2026')).toBeInTheDocument();
  });

  it('disables future-month navigation while allowing a return from past months', async () => {
    const user = userEvent.setup();
    renderApp();

    await screen.findByLabelText('Monthly utility usage');
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous period' }));
    expect(screen.getByText('Feb 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next period' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Next period' }));
    expect(screen.getByText('Mar 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();
  });

  it('uses only the selected calendar month for all summary cards in month view', async () => {
    apiMocks.getUsage.mockResolvedValueOnce({
      accountId: 'account-demo',
      serviceId: 'service-demo',
      serviceName: 'Customer Demo Account Electric Service',
      unit: 'kWh',
      source: 'nextcloud-import',
      today: '2026-04-15',
      points: [
        { date: '2026-03-31', usageValue: 99, unit: 'kWh', isFuture: false },
        { date: '2026-04-01', usageValue: 10, unit: 'kWh', isFuture: false },
        { date: '2026-04-02', usageValue: 20, unit: 'kWh', isFuture: false },
        { date: '2026-05-01', usageValue: 77, unit: 'kWh', isFuture: false },
      ],
    });

    renderApp('/usage');

    await screen.findByText('Apr 2026');

    const summary = screen.getByLabelText('Usage period summary');
    expect(within(summary).getByText('30 kWh')).toBeInTheDocument();
    expect(within(summary).getByText('UGX 24,087')).toBeInTheDocument();
    expect(within(summary).getByText('UGX 370,429')).toBeInTheDocument();
  });

  it('renders the sign-in form when there is no session', async () => {
    const { supabase } = await import('./supabase');
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: null },
      error: null,
    } as never);

    renderApp();

    expect(await screen.findByRole('heading', { name: 'Sign in to view your energy dashboard' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeInTheDocument();
  });

  it('sends a magic link from the sign-in form', async () => {
    const { supabase } = await import('./supabase');
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: null },
      error: null,
    } as never);

    const user = userEvent.setup();
    renderApp();

    await screen.findByRole('heading', { name: 'Sign in to view your energy dashboard' });
    await user.type(screen.getByLabelText('Email address'), 'person@example.com');
    await user.click(screen.getByRole('button', { name: 'Send sign-in link' }));

    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'person@example.com',
      options: {
        emailRedirectTo: window.location.origin,
      },
    });
    expect(await screen.findByText('Check your email for the secure sign-in link.')).toBeInTheDocument();
  });

  it('disables magic link retries during Supabase cooldown', async () => {
    const { supabase } = await import('./supabase');
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: null },
      error: null,
    } as never);
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValueOnce({
      error: {
        message: 'For security purposes, you can only request this after 43 seconds.',
      },
    } as never);
    const initialSignInCallCount = vi.mocked(supabase.auth.signInWithOtp).mock.calls.length;

    const user = userEvent.setup();
    renderApp();

    await screen.findByRole('heading', { name: 'Sign in to view your energy dashboard' });
    await user.type(screen.getByLabelText('Email address'), 'pokello8@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Send sign-in link' }));

    expect(await screen.findByText('For security purposes, you can only request this after 43 seconds.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again in 43s' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Try again in 43s' }));

    expect(supabase.auth.signInWithOtp).toHaveBeenCalledTimes(initialSignInCallCount + 1);
  });

  it('signs out when the user clicks sign out', async () => {
    const { supabase } = await import('./supabase');
    const user = userEvent.setup();
    renderApp();

    const signOutButton = await screen.findByRole('button', { name: 'Sign out' });
    await user.click(signOutButton);

    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it('returns to the signed-out state when backend verification fails', async () => {
    apiMocks.getMe.mockRejectedValueOnce(new Error('Unable to verify your session.'));

    renderApp();

    expect(await screen.findByText('Unable to verify your session.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in to view your energy dashboard' })).toBeInTheDocument();
  });

  it('shows the unmapped-user message when the backend rejects a signed-in user without a customer profile', async () => {
    apiMocks.getMe.mockRejectedValueOnce(
      new Error('Your account is signed in, but it is not linked to a customer profile yet.'),
    );

    renderApp();

    expect(
      await screen.findByText('Your account is signed in, but it is not linked to a customer profile yet.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in to view your energy dashboard' })).toBeInTheDocument();
  });

  it('renders the account route with customer profile and services', async () => {
    renderApp('/account');

    expect(await screen.findByLabelText('Account overview')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Account' })).toHaveClass('section-nav__link--active');
    expect(screen.getByText('Customer Demo Profile')).toBeInTheDocument();
    expect(screen.getByText('Customer Demo Account Electric Service')).toBeInTheDocument();
    expect(screen.getByText('Demo Microgrid')).toBeInTheDocument();
    expect(screen.getByText(/Aaron Test Gateway/)).toBeInTheDocument();
    expect(screen.getByText(/Chint DDSU666/)).toBeInTheDocument();
  });
});
