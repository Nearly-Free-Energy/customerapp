import { Session } from '@supabase/supabase-js';
import { FormEvent, useEffect, useState } from 'react';
import { getMe } from '../../../api';
import type { CustomerProfile, Microgrid, UtilityAccount, UtilityService } from '../../../models/customer';
import { supabase } from '../../../supabase';

export type PortalSessionState =
  | {
      status: 'checking';
      email: string;
      authError: string | null;
      authMessage: string | null;
      isSendingLink: boolean;
      signInCooldownSeconds: number;
    }
  | {
      status: 'signedOut';
      email: string;
      authError: string | null;
      authMessage: string | null;
      isSendingLink: boolean;
      signInCooldownSeconds: number;
    }
  | {
      status: 'verifying';
      email: string;
      authError: string | null;
      authMessage: string | null;
      isSendingLink: boolean;
      signInCooldownSeconds: number;
    }
  | {
      status: 'signedIn';
      email: string;
      profile: CustomerProfile;
      account: UtilityAccount;
      accounts: UtilityAccount[];
      services: UtilityService[];
      microgrids: Microgrid[];
      session: Session;
      authError: string | null;
      authMessage: string | null;
      isSendingLink: boolean;
      signInCooldownSeconds: number;
    };

type UsePortalSessionResult = {
  state: PortalSessionState;
  handleEmailChange: (value: string) => void;
  handleSignIn: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleSignOut: () => Promise<void>;
};

export function usePortalSession(): UsePortalSessionResult {
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSendingLink, setIsSendingLink] = useState(false);
  const [signInCooldownSeconds, setSignInCooldownSeconds] = useState(0);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [account, setAccount] = useState<UtilityAccount | null>(null);
  const [accounts, setAccounts] = useState<UtilityAccount[]>([]);
  const [services, setServices] = useState<UtilityService[]>([]);
  const [microgrids, setMicrogrids] = useState<Microgrid[]>([]);
  const [isVerifyingSession, setIsVerifyingSession] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadSession() {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) {
        return;
      }

      if (error) {
        setAuthError(error.message);
      } else {
        setSession(data.session);
        setVerifiedEmail(null);
        setProfile(null);
        setAccount(null);
        setAccounts([]);
        setServices([]);
        setMicrogrids([]);
        if (data.session?.user.email) {
          setEmail(data.session.user.email);
        }
      }

      setIsAuthReady(true);
    }

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsAuthReady(true);
      setVerifiedEmail(null);
      setProfile(null);
      setAccount(null);
      setAccounts([]);
      setServices([]);
      setMicrogrids([]);

      if (nextSession?.user.email) {
        setEmail(nextSession.user.email);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (signInCooldownSeconds <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setSignInCooldownSeconds((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [signInCooldownSeconds]);

  useEffect(() => {
    let isMounted = true;

    async function verifySession() {
      if (!session?.access_token || !session.user.email) {
        setVerifiedEmail(null);
        setProfile(null);
        setAccount(null);
        setAccounts([]);
        setServices([]);
        setMicrogrids([]);
        setIsVerifyingSession(false);
        return;
      }

      setIsVerifyingSession(true);

      try {
        const profile = await getMe(session.access_token);
        if (!isMounted) {
          return;
        }

        setVerifiedEmail(profile.email);
        setProfile(profile.profile);
        setAccount(profile.account);
        setAccounts(profile.accounts ?? [profile.account]);
        setServices(profile.services);
        setMicrogrids(profile.microgrids);
        setAuthError(null);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setVerifiedEmail(null);
        setProfile(null);
        setAccount(null);
        setAccounts([]);
        setServices([]);
        setMicrogrids([]);
        setAuthMessage(null);

        const message = error instanceof Error ? error.message : 'Unable to verify your session.';
        await supabase.auth.signOut();
        setSession(null);
        setAuthError(message);
      } finally {
        if (isMounted) {
          setIsVerifyingSession(false);
        }
      }
    }

    void verifySession();

    return () => {
      isMounted = false;
    };
  }, [session]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signInCooldownSeconds > 0) {
      return;
    }

    setAuthError(null);
    setAuthMessage(null);
    setIsSendingLink(true);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      setAuthError(error.message);
      setSignInCooldownSeconds(extractCooldownSeconds(error.message));
    } else {
      setAuthMessage('Check your email for the secure sign-in link.');
      setSignInCooldownSeconds(60);
    }

    setIsSendingLink(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setSession(null);
    setVerifiedEmail(null);
    setProfile(null);
    setAccount(null);
    setAccounts([]);
    setServices([]);
    setMicrogrids([]);
    setAuthMessage(null);
    setAuthError(null);
  }

  if (!isAuthReady) {
    return {
      state: {
        status: 'checking',
        email,
        authError,
        authMessage,
        isSendingLink,
        signInCooldownSeconds,
      },
      handleEmailChange: setEmail,
      handleSignIn,
      handleSignOut,
    };
  }

  if (!session) {
    return {
      state: {
        status: 'signedOut',
        email,
        authError,
        authMessage,
        isSendingLink,
        signInCooldownSeconds,
      },
      handleEmailChange: setEmail,
      handleSignIn,
      handleSignOut,
    };
  }

  if (isVerifyingSession || !verifiedEmail) {
    return {
      state: {
        status: 'verifying',
        email,
        authError,
        authMessage,
        isSendingLink,
        signInCooldownSeconds,
      },
      handleEmailChange: setEmail,
      handleSignIn,
      handleSignOut,
    };
  }

  if (!profile || !account) {
    return {
      state: {
        status: 'verifying',
        email,
        authError,
        authMessage,
        isSendingLink,
        signInCooldownSeconds,
      },
      handleEmailChange: setEmail,
      handleSignIn,
      handleSignOut,
    };
  }

  return {
    state: {
      status: 'signedIn',
      email: verifiedEmail,
      profile,
      account,
      accounts,
      services,
      microgrids,
      session,
      authError,
      authMessage,
      isSendingLink,
      signInCooldownSeconds,
    },
    handleEmailChange: setEmail,
    handleSignIn,
    handleSignOut,
  };
}

function extractCooldownSeconds(message: string): number {
  const match = message.match(/after\s+(\d+)\s+seconds?/i);
  return match ? Number(match[1]) : 0;
}
