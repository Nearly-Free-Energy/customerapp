import { FormEvent } from 'react';

type SignInScreenProps = {
  email: string;
  authError: string | null;
  authMessage: string | null;
  isSendingLink: boolean;
  signInCooldownSeconds: number;
  onEmailChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function SignInScreen({
  email,
  authError,
  authMessage,
  isSendingLink,
  signInCooldownSeconds,
  onEmailChange,
  onSubmit,
}: SignInScreenProps) {
  const isSubmitDisabled = isSendingLink || signInCooldownSeconds > 0;
  const buttonLabel = isSendingLink
    ? 'Sending link...'
    : signInCooldownSeconds > 0
      ? `Try again in ${signInCooldownSeconds}s`
      : 'Send sign-in link';

  return (
    <main className="app-shell">
      <section className="dashboard-card dashboard-card--narrow">
        <div className="eyebrow">Customer energy portal</div>
        <div className="auth-card">
          <img className="auth-card__logo" src="/assets/nfe-site-logo.png" alt="Nearly Free Energy" />
          <h1>Sign in to view your energy dashboard</h1>
          <p className="subtitle">
            Enter your email address and we&apos;ll send you a secure sign-in link. For now, the dashboard still uses
            demo data after sign-in while we complete the real-data integration.
          </p>

          {authError ? (
            <div className="status-banner status-banner--error" role="alert">
              {authError}
            </div>
          ) : null}

          {authMessage ? (
            <div className="status-banner status-banner--info" role="status">
              {authMessage}
            </div>
          ) : null}

          <form className="auth-form" onSubmit={onSubmit}>
            <label className="auth-form__label" htmlFor="email">
              Email address
            </label>
            <input
              id="email"
              className="auth-form__input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="you@example.com"
              required
            />
            <button type="submit" className="auth-form__button" disabled={isSubmitDisabled}>
              {buttonLabel}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
