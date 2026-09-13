import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import apiClient from '../api/client';
import { getSecurityPassword, clearSecurityPassword, saveSecurityPassword } from '../utils/crypto';

interface SecurityPasswordContextType {
  hasSecurityPassword: boolean | null; // null = loading, true/false = has/hasn't
  isVerified: boolean; // Whether password has been verified this session
  securityPassword: string | null; // The actual password (only stored in memory)
  passwordVerificationFailed: boolean; // True if auto-verification from cookie failed
  isAutoVerifying: boolean; // True if currently attempting auto-verification from cookie
  checkSecurityPassword: () => Promise<void>;
  verifySecurityPassword: (password: string) => Promise<{ success: boolean; error?: string }>;
  clearVerification: () => void;
}

const SecurityPasswordContext = createContext<SecurityPasswordContextType | undefined>(undefined);

export const SecurityPasswordProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user, isLoading, getSessionGeneration } = useAuth();
  const [hasSecurityPassword, setHasSecurityPassword] = useState<boolean | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [securityPassword, setSecurityPassword] = useState<string | null>(null);
  const [passwordVerificationFailed, setPasswordVerificationFailed] = useState(false);
  const [isAutoVerifying, setIsAutoVerifying] = useState(false); // Track auto-verification state
  // In-flight check marker keyed by session generation: an old session's check
  // must never suppress the new session's check (F18 re-review).
  const checkingRef = useRef<{ generation: number } | null>(null);
  const wasAuthenticatedRef = useRef(false); // Track previous auth state
  const isAuthenticatedRef = useRef(isAuthenticated); // Live auth state for race guards
  // Live view of passwordVerificationFailed: the gate below must read the
  // CURRENT value, not a closure from when the callback was created, so an
  // account switch does not evaluate B's check against A's failure flag (F18
  // inline review).
  const passwordVerificationFailedRef = useRef(passwordVerificationFailed);

  // Keep isAuthenticatedRef in sync with isAuthenticated
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  // Keep passwordVerificationFailedRef in sync with the state
  useEffect(() => {
    passwordVerificationFailedRef.current = passwordVerificationFailed;
  }, [passwordVerificationFailed]);

  // Check if user has security password
  const checkSecurityPassword = useCallback(async () => {
    if (!isAuthenticated) {
      setHasSecurityPassword(null);
      setIsVerified(false);
      setSecurityPassword(null);
      setPasswordVerificationFailed(false);
      return;
    }

    // Capture the session this check belongs to (F18: guards must detect an
    // account switch, not just a true/false auth flip).
    const generation = getSessionGeneration();

    // Prevent concurrent checks within the SAME session only (fixes StrictMode
    // double-call issue) — a newer session's check must start immediately even
    // while an older session's check is still pending.
    if (checkingRef.current && checkingRef.current.generation === generation) {
      return;
    }

    checkingRef.current = { generation };

    try {
      const response = await apiClient.getSecurityPasswordStatus();

      // CRITICAL FIX: Check LIVE auth state + session generation after async call
      if (!isAuthenticatedRef.current || getSessionGeneration() !== generation) {
        console.log('User logged out or switched account during checkSecurityPassword, aborting');
        return;
      }

      if (response.success && response.data) {
        setHasSecurityPassword(response.data.has_security_password);

        // Try to auto-load password from cookie ONLY ONCE
        if (response.data.has_security_password && user?.username && !passwordVerificationFailedRef.current) {
          setIsAutoVerifying(true); // Start auto-verification

          const savedPassword = await getSecurityPassword(user.username);

          // Check LIVE auth state + session again after second async call.
          // On staleness, return WITHOUT touching state — setIsAutoVerifying
          // may already belong to a newer session's check (F18 re-review).
          if (!isAuthenticatedRef.current || getSessionGeneration() !== generation) {
            console.log('User logged out or switched account during password retrieval, aborting');
            return;
          }

          if (savedPassword) {
            console.log('Attempting auto-verification with saved password...');

            // Auto-verify with saved password
            const verifyResponse = await apiClient.getUserData({ password: savedPassword });

            // Final LIVE auth + session check after verification (same rule:
            // no state mutation — including the auto-verify flag — when stale).
            if (!isAuthenticatedRef.current || getSessionGeneration() !== generation) {
              console.log('User logged out or switched account during auto-verification, aborting');
              return;
            }

            if (verifyResponse.success) {
              console.log('Auto-verification successful');
              setIsVerified(true);
              setSecurityPassword(savedPassword);
              setPasswordVerificationFailed(false);
            } else {
              if (verifyResponse.status === 401) {
                // Cookie password is invalid, clear it and mark as failed
                console.warn('Auto-verification failed - cookie password is invalid');

                // CRITICAL FIX: Await cookie cleanup to ensure it completes.
                // Target only this user's namespaced cookie (F18).
                try {
                  await clearSecurityPassword(user.username);
                } catch (error) {
                  console.error('Failed to clear security password cookie:', error);
                }

                // F18 re-review: only flag the session this check belongs to —
                // never poison a newer session's auto-verify with A's failure.
                if (getSessionGeneration() !== generation) {
                  return;
                }
                setPasswordVerificationFailed(true); // Prevent infinite retries!
              } else {
                console.warn('Auto-verification failed due to non-auth error, will retry later');
              }
            }
          }

          // End auto-verification (only for our own session — a newer session
          // manages its own flag).
          if (getSessionGeneration() === generation) {
            setIsAutoVerifying(false);
          }
        }
      }
    } catch (error) {
      console.error('Failed to check security password status:', error);
    } finally {
      // Only release the marker if it still belongs to this session's check,
      // so a stale finally cannot clear a newer session's in-flight marker.
      if (checkingRef.current?.generation === generation) {
        checkingRef.current = null;
      }
      // Exception safety: an unexpected rejection inside the auto-verify chain
      // must not leave the auto-verify flag stuck true for this session (F18
      // inline review). A newer session owns its own flag.
      if (getSessionGeneration() === generation) {
        setIsAutoVerifying(false);
      }
    }
  }, [isAuthenticated, user, getSessionGeneration]);

  // Verify security password
  const verifySecurityPassword = useCallback(async (password: string): Promise<{ success: boolean; error?: string }> => {
    if (password.length !== 6 || !/^\d{6}$/.test(password)) {
      return { success: false, error: 'Password must be 6 digits' };
    }

    try {
      // Capture the session this verification belongs to; a stale success must
      // never mark a new account's session as verified (F18).
      const generation = getSessionGeneration();

      // Verify by attempting to get user data with this password
      const response = await apiClient.getUserData({ password });

      if (getSessionGeneration() !== generation || !isAuthenticatedRef.current) {
        return { success: false, error: 'Verification aborted: session changed' };
      }

      if (response.success) {
        // Save password to cookie for auto-login next time FIRST
        if (user?.username) {
          const saved = await saveSecurityPassword(password, user.username);
          if (!saved) {
            console.error('Failed to save security password to cookie');
            // Continue anyway, but user will need to re-enter on refresh
          }

          // F18 re-review: the account may have switched while the PIN cookie
          // was being written — A's verification must never unlock B's session.
          if (getSessionGeneration() !== generation) {
            return { success: false, error: 'Verification aborted: session changed' };
          }
        }

        // Only set verified state after successful save attempt
        setIsVerified(true);
        setSecurityPassword(password);
        setPasswordVerificationFailed(false); // Reset failure flag

        return { success: true };
      } else {
        if (response.status === 401) {
          // Password is wrong - DO NOT retry automatically
          setPasswordVerificationFailed(true);
          return { success: false, error: response.error || 'Invalid password' };
        }
        return { success: false, error: response.error || 'Verification failed' };
      }
    } catch (error) {
      console.error('Verification error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Verification failed' };
    }
  }, [user, getSessionGeneration]);

  // Clear verification state
  const clearVerification = useCallback(async () => {
    setIsVerified(false);
    setSecurityPassword(null);
    setPasswordVerificationFailed(false);
    passwordVerificationFailedRef.current = false;

    // Await cookie cleanup to ensure it completes — only this user's cookie.
    try {
      await clearSecurityPassword(user?.username);
    } catch (error) {
      console.error('Failed to clear security password cookie in clearVerification:', error);
    }
  }, [user?.username]);

  // F18 re-review: verification state is per-account. A direct account switch
  // (A → B) keeps isAuthenticated true, so the logout effect below never fires
  // and B would inherit A's verified flag / in-memory PIN. Reset the whole
  // security-session state whenever the account identity changes. Declared
  // BEFORE the auth-change effect so a fresh account always starts from a
  // clean slate (including the live failure-flag ref). The in-flight check
  // marker is NOT reset here: it is keyed by session generation, so a new
  // account's check is never suppressed by an older session's marker, and
  // clearing it would let React StrictMode's effect replay launch duplicate
  // same-session checks (F18 follow-up review).
  useEffect(() => {
    setIsVerified(false);
    setSecurityPassword(null);
    setPasswordVerificationFailed(false);
    passwordVerificationFailedRef.current = false;
    setIsAutoVerifying(false);
  }, [user?.username]);

  // Check security password status on auth change
  useEffect(() => {
    // Don't run while auth is still loading
    if (isLoading) return;

    checkSecurityPassword();
  }, [checkSecurityPassword, isLoading]);

  // Clear verification on ACTUAL logout (not initial load or auth refresh)
  useEffect(() => {
    // Don't run while auth is still loading
    if (isLoading) return;

    // Track auth state changes
    const wasAuthenticated = wasAuthenticatedRef.current;
    wasAuthenticatedRef.current = isAuthenticated;

    // Only clear on TRUE logout (was authenticated -> not authenticated)
    // NOT on initial load (was never authenticated)
    // NOT on transient auth refresh blips
    if (wasAuthenticated && !isAuthenticated) {
      // Additional safety: double-check user is actually gone
      // This prevents clearing on brief auth refresh fluctuations
      const confirmLogout = setTimeout(async () => {
        // If still not authenticated after 100ms, it's a real logout
        if (!isAuthenticated) {
          console.log('Confirmed logout, clearing security password state');
          await clearVerification();
          setHasSecurityPassword(null);
        }
      }, 100);

      return () => clearTimeout(confirmLogout);
    }
  }, [isAuthenticated, isLoading, clearVerification]);

  return (
    <SecurityPasswordContext.Provider
      value={{
        hasSecurityPassword,
        isVerified,
        securityPassword,
        passwordVerificationFailed,
        isAutoVerifying,
        checkSecurityPassword,
        verifySecurityPassword,
        clearVerification,
      }}
    >
      {children}
    </SecurityPasswordContext.Provider>
  );
};

export const useSecurityPassword = () => {
  const context = useContext(SecurityPasswordContext);
  if (!context) {
    throw new Error('useSecurityPassword must be used within a SecurityPasswordProvider');
  }
  return context;
};
