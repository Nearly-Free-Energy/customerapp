import { Navigate, Route, Routes } from 'react-router-dom';
import { AccountOverview } from './features/account/components/AccountOverview';
import { AuthStatusScreen } from './features/auth/components/AuthStatusScreen';
import { SignInScreen } from './features/auth/components/SignInScreen';
import { usePortalSession } from './features/auth/hooks/usePortalSession';
import { DashboardScreen } from './features/dashboard/components/DashboardScreen';
import { UsageOverview } from './features/usage/components/UsageOverview';
import type { UtilityAccount, UtilityService } from './models/customer';
import type { UsageApiResponse } from './models/usage';

const previewAccount: UtilityAccount = {
  id: 'preview-account',
  accountNumber: 'preview-account',
  displayName: 'Preview Customer',
  status: 'active',
};

const previewServices: UtilityService[] = [
  {
    id: 'preview-service',
    utilityAccountId: 'preview-account',
    serviceType: 'electric',
    serviceName: 'Electric Service',
    serviceAddress: null,
    status: 'active',
  },
];

const previewUsageData: UsageApiResponse = {
  accountId: 'preview-account',
  serviceId: 'preview-service',
  serviceName: 'Electric Service',
  unit: 'kWh',
  source: 'seeded-demo',
  today: '2026-03-25',
  points: [
    { date: '2026-03-22', usageValue: 31, unit: 'kWh', isFuture: false },
    { date: '2026-03-23', usageValue: 27, unit: 'kWh', isFuture: false },
    { date: '2026-03-24', usageValue: 24, unit: 'kWh', isFuture: false },
    { date: '2026-03-25', usageValue: 22, unit: 'kWh', isFuture: false },
  ],
};

function App() {
  const isLocalPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'usage';
  const { state, handleEmailChange, handleSignIn, handleSignOut } = usePortalSession();

  if (isLocalPreview) {
    return (
      <DashboardScreen email="preview@example.com" accountName={previewAccount.displayName} onSignOut={async () => undefined}>
        <UsageOverview
          accessToken="preview-token"
          accounts={[previewAccount]}
          services={previewServices}
          previewUsageData={previewUsageData}
        />
      </DashboardScreen>
    );
  }

  if (state.status === 'checking') {
    return <AuthStatusScreen title="Electricity Consumption" message="Checking your session..." />;
  }

  if (state.status === 'signedOut') {
    return (
      <SignInScreen
        email={state.email}
        authError={state.authError}
        authMessage={state.authMessage}
        isSendingLink={state.isSendingLink}
        signInCooldownSeconds={state.signInCooldownSeconds}
        onEmailChange={handleEmailChange}
        onSubmit={handleSignIn}
      />
    );
  }

  if (state.status === 'verifying') {
    return <AuthStatusScreen title="Electricity Consumption" message="Verifying your secure session..." />;
  }

  const signedInState = state;
  const accountName =
    signedInState.accounts.length > 1
      ? `${signedInState.profile.displayName} (${signedInState.accounts.length} utility accounts)`
      : signedInState.account.displayName;

  return (
    <Routes>
      <Route
        path="/usage"
        element={
          <DashboardScreen email={signedInState.email} accountName={accountName} onSignOut={handleSignOut}>
            <UsageOverview
              accessToken={signedInState.session.access_token}
              accounts={signedInState.accounts}
              services={signedInState.services}
            />
          </DashboardScreen>
        }
      />
      <Route
        path="/account"
        element={
          <DashboardScreen
            email={signedInState.email}
            accountName={accountName}
            onSignOut={handleSignOut}
          >
            <AccountOverview
              profile={signedInState.profile}
              account={signedInState.account}
              accounts={signedInState.accounts}
              services={signedInState.services}
              microgrids={signedInState.microgrids}
            />
          </DashboardScreen>
        }
      />
      <Route path="/" element={<Navigate to="/usage" replace />} />
      <Route path="*" element={<Navigate to="/usage" replace />} />
    </Routes>
  );
}

export default App;
