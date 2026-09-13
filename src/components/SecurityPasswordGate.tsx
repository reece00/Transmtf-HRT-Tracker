import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Lock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useSecurityPassword } from '../contexts/SecurityPasswordContext';
import NumericKeypad from './NumericKeypad';

// Transport/timeout/server-side failure markers produced by apiClient
// (fetch errors, aborts, 5xx fallbacks, refresh failure, non-401 verify
// fallbacks). A wrong PIN instead arrives as the server's own auth message,
// so anything matching this pattern is a network-type error, not a bad PIN.
// Match ONLY explicit transport/timeout/5xx sentinels — 'authentication failed'
// etc. must NOT match, or a 401 wrong-PIN surfaces as a network error (F23 review).
const NETWORK_ERROR_PATTERN = /failed to fetch|networkerror|network error|load failed|request timeout|timeout|http 5/i;

const SecurityPasswordGate: React.FC = () => {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const { hasSecurityPassword, isVerified, isAutoVerifying, verifySecurityPassword } = useSecurityPassword();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const verifyingRef = useRef(false);

  useEffect(() => {
    if (!isVerified) setIsSuccess(false);
  }, [isVerified]);

  useEffect(() => {
    if (hasSecurityPassword === null || hasSecurityPassword === false) {
      setPassword('');
      setError('');
      setIsVerifying(false);
      setIsSuccess(false);
      setIsExiting(false);
      verifyingRef.current = false;
    }
  }, [hasSecurityPassword]);

  const handleVerify = useCallback(async (pwd: string) => {
    if (verifyingRef.current || isVerifying) return;
    if (pwd.length !== 6) return;

    setError('');
    setIsSuccess(false);
    setIsVerifying(true);
    verifyingRef.current = true;

    try {
      const result = await verifySecurityPassword(pwd);
      if (result.success) {
        setIsSuccess(true);
        setPassword('');
      } else {
        const msg = result.error || t('auth.error.invalidPassword') || 'Invalid password';
        if (msg.includes('Too many requests') || msg.includes('rate limit') || msg.includes('too many')) {
          setError(t('security.error.rateLimited') || 'Too many attempts. Please wait 5 minutes and try again.');
        } else if (NETWORK_ERROR_PATTERN.test(msg)) {
          // Network / server-side failure (non-401): retry or fall back to logout
          setError(t('security.gate.network_error') || 'Network error — you can retry or log out');
        } else {
          setError(msg);
        }
        setPassword('');
      }
    } catch {
      setError(t('common.error') || 'An error occurred');
      setPassword('');
    } finally {
      setIsVerifying(false);
      verifyingRef.current = false;
    }
  }, [isVerifying, verifySecurityPassword, t]);

  useEffect(() => {
    if (password.length === 6 && !isVerifying && !verifyingRef.current) {
      handleVerify(password);
    }
  }, [password, isVerifying, handleVerify]);

  const handleNumberPress = useCallback((num: number) => {
    if (password.length < 6 && !isVerifying) {
      setError('');
      setPassword(prev => prev + num.toString());
    }
  }, [password.length, isVerifying]);

  const handleDelete = useCallback(() => {
    if (!isVerifying) {
      setError('');
      setPassword(prev => prev.slice(0, -1));
    }
  }, [isVerifying]);

  // Recovery path: leave the gate by logging out while KEEPING local data.
  // After logout the gate unmounts (hasSecurityPassword clears) and the user
  // can still reach/export their local records.
  const handleExit = useCallback(async () => {
    if (isExiting || isVerifying) return;
    setIsExiting(true);
    setError('');
    try {
      await logout(false);
    } catch {
      setIsExiting(false);
      setError(t('common.error') || 'An error occurred');
    }
  }, [isExiting, isVerifying, logout, t]);

  if (hasSecurityPassword === null || hasSecurityPassword === false || isVerified || isAutoVerifying) {
    return null;
  }

  const iconState = isSuccess ? 'success' : error ? 'error' : 'default';

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center px-4 py-6 overflow-y-auto"
      style={{
        background: [
          'radial-gradient(ellipse 90% 60% at 10% -10%, rgba(252,207,232,0.55) 0%, transparent 55%)',
          'radial-gradient(ellipse 70% 60% at 90% 110%, rgba(221,214,254,0.5) 0%, transparent 55%)',
          'radial-gradient(ellipse 50% 40% at 50% 50%, rgba(255,255,255,0.3) 0%, transparent 70%)',
          'rgba(255,255,255,0.6)',
        ].join(', '),
        backdropFilter: 'blur(32px) saturate(220%)',
        WebkitBackdropFilter: 'blur(32px) saturate(220%)',
      }}
    >
      <div
        className="w-full max-w-sm mx-auto my-auto sg-fade-in"
        style={{
          background: 'var(--glass-bg-heavy)',
          backdropFilter: 'blur(32px) saturate(200%)',
          WebkitBackdropFilter: 'blur(32px) saturate(200%)',
          border: '1px solid var(--glass-border-strong)',
          borderRadius: '40px',
          boxShadow: 'var(--glass-shadow-modal)',
          padding: '36px 24px 28px',
        }}
      >
        {/* Icon */}
        <div className="flex flex-col items-center mb-6">
          <div
            className={`w-18 h-18 sm:w-20 sm:h-20 rounded-full flex items-center justify-center mb-5 transition-all duration-500 ${error ? 'sg-shake' : ''}`}
            style={{
              width: 72, height: 72,
              background: iconState === 'success'
                ? 'rgba(220,252,231,0.7)'
                : iconState === 'error'
                ? 'rgba(254,226,226,0.7)'
                : 'rgba(255,255,255,0.7)',
              border: `1.5px solid ${iconState === 'success' ? 'rgba(134,239,172,0.6)' : iconState === 'error' ? 'rgba(252,165,165,0.6)' : 'rgba(255,255,255,0.85)'}`,
              boxShadow: iconState === 'success'
                ? '0 4px 20px rgba(34,197,94,0.2), 0 1px 0 rgba(255,255,255,0.9) inset'
                : iconState === 'error'
                ? '0 4px 20px rgba(239,68,68,0.2), 0 1px 0 rgba(255,255,255,0.9) inset'
                : '0 4px 20px rgba(236,72,153,0.18), 0 1px 0 rgba(255,255,255,0.9) inset',
            }}
          >
            {isSuccess ? (
              <CheckCircle2 size={32} className="sg-scale-in" style={{ color: '#16a34a' }} strokeWidth={2.5} />
            ) : (
              <Lock
                size={32}
                style={{ color: error ? '#dc2626' : '#ec4899' }}
                strokeWidth={2.5}
              />
            )}
          </div>

          <h2
            className="text-xl sm:text-2xl font-semibold text-center mb-1"
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
              color: 'rgba(20,10,40,0.88)',
              letterSpacing: '-0.02em',
            }}
          >
            {isSuccess ? (t('common.success') || '验证成功') : (t('security.gate.title') || '输入安全密码')}
          </h2>

          <p
            className="text-xs sm:text-sm text-center max-w-xs"
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
              color: 'rgba(120,80,160,0.72)',
            }}
          >
            {isSuccess
              ? (t('security.gate.success') || '正在加载您的数据...')
              : (t('security.gate.description') || '输入您的 6 位 PIN 以访问加密数据')
            }
          </p>
        </div>

        {!isSuccess && (
          <>
            {/* PIN Dots */}
            <div className="flex justify-center gap-3 sm:gap-4 mb-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="transition-all duration-200"
                  style={{
                    width: 12, height: 12,
                    borderRadius: '50%',
                    transform: i < password.length ? 'scale(1.15)' : 'scale(1)',
                    background: i < password.length
                      ? error
                        ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                        : 'linear-gradient(135deg, #ec4899, #a855f7)'
                      : 'rgba(236,72,153,0.12)',
                    border: `1.5px solid ${i < password.length
                      ? error ? 'rgba(239,68,68,0.4)' : 'rgba(236,72,153,0.35)'
                      : 'rgba(236,72,153,0.22)'}`,
                    boxShadow: i < password.length && !error
                      ? '0 0 8px rgba(236,72,153,0.45), 0 2px 4px rgba(236,72,153,0.25)'
                      : 'none',
                  }}
                />
              ))}
            </div>

            {/* Error */}
            {error && (
              <div
                className="mb-5 sg-shake"
                style={{
                  background: 'rgba(254,226,226,0.55)',
                  backdropFilter: 'blur(16px) saturate(180%)',
                  border: '1px solid rgba(252,165,165,0.5)',
                  borderRadius: '16px',
                  padding: '12px 14px',
                }}
              >
                <div className="flex items-start gap-2.5">
                  <AlertCircle size={16} style={{ color: '#be123c', flexShrink: 0, marginTop: 1 }} strokeWidth={2.5} />
                  <p
                    className="text-xs sm:text-sm leading-relaxed"
                    style={{
                      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                      color: '#be123c',
                    }}
                  >
                    {error}
                  </p>
                </div>
              </div>
            )}

            {/* Loading */}
            {isVerifying && (
              <div
                className="mb-5"
                style={{
                  background: 'rgba(253,242,248,0.6)',
                  backdropFilter: 'blur(16px) saturate(180%)',
                  border: '1px solid rgba(251,207,232,0.5)',
                  borderRadius: '16px',
                  padding: '12px 14px',
                }}
              >
                <div className="flex items-center justify-center gap-2.5">
                  <div
                    className="rounded-full animate-spin"
                    style={{
                      width: 16, height: 16,
                      border: '2px solid rgba(236,72,153,0.25)',
                      borderTopColor: '#ec4899',
                    }}
                  />
                  <span
                    className="text-xs sm:text-sm"
                    style={{
                      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                      color: '#be185d',
                    }}
                  >
                    {t('common.loading') || '验证中...'}
                  </span>
                </div>
              </div>
            )}

            {/* Keypad */}
            <div className="mb-5">
              <NumericKeypad
                onNumberPress={handleNumberPress}
                onDelete={handleDelete}
                disabled={isVerifying}
              />
            </div>

            {/* Hints */}
            <div
              className="text-center space-y-1"
              style={{
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                fontSize: 11,
                color: 'rgba(150,100,185,0.6)',
              }}
            >
              <p>{t('security.gate.hint1') || '此密码用于加密云端数据'}</p>
              <p>{t('security.gate.hint2') || '每次会话只需输入一次'}</p>
            </div>

            {/* Recovery path — visually secondary exit (F23): plain text
                link, not a competing CTA. Lives inside the gate container,
                so the existing focus behaviour is unaffected. */}
            <div className="mt-4 pt-3 text-center" style={{ borderTop: '1px solid rgba(236,72,153,0.14)' }}>
              <button
                type="button"
                onClick={handleExit}
                disabled={isExiting || isVerifying}
                style={{
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'rgba(120,80,160,0.78)',
                  background: 'none',
                  border: 'none',
                  padding: '6px 10px',
                  cursor: isExiting ? 'default' : 'pointer',
                  textDecoration: 'underline',
                  textUnderlineOffset: '3px',
                  opacity: isExiting ? 0.7 : 1,
                }}
              >
                {isExiting
                  ? (t('common.loading') || '加载中...')
                  : (t('security.gate.exit_logout') || '退出登录（保留本地数据）')}
              </button>
              <p
                className="mt-1.5 mx-auto max-w-xs leading-relaxed"
                style={{
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                  fontSize: 10,
                  color: 'rgba(150,100,185,0.55)',
                }}
              >
                {t('security.gate.recovery_hint') || '忘记密码？退出登录不会删除本地记录。清除浏览器数据将删除本地记录，请先导出备份。'}
              </p>
            </div>
          </>
        )}

        {/* Success spinner */}
        {isSuccess && (
          <div className="flex flex-col items-center py-6">
            <div
              className="rounded-full animate-spin mb-3"
              style={{
                width: 36, height: 36,
                border: '2.5px solid rgba(34,197,94,0.2)',
                borderTopColor: '#16a34a',
              }}
            />
            <p
              className="text-xs sm:text-sm text-center"
              style={{
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                color: '#15803d',
              }}
            >
              {t('security.gate.success') || '正在加载您的数据...'}
            </p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes sg-fade-in {
          from { opacity: 0; transform: scale(0.96) translateY(20px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        @keyframes sg-shake {
          0%, 100% { transform: translateX(0); }
          15%, 55%  { transform: translateX(-7px); }
          35%, 75%  { transform: translateX(7px); }
        }
        @keyframes sg-scale-in {
          0%   { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        .sg-fade-in  { animation: sg-fade-in  0.45s cubic-bezier(0.16, 1, 0.3, 1); }
        .sg-shake    { animation: sg-shake    0.55s cubic-bezier(0.36, 0.07, 0.19, 0.97); }
        .sg-scale-in { animation: sg-scale-in 0.5s  cubic-bezier(0.34, 1.56, 0.64, 1); }
      `}</style>
    </div>
  );
};

export default SecurityPasswordGate;
