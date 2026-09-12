import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCloudSync } from '../contexts/CloudSyncContext';
import { useTranslation } from '../contexts/LanguageContext';
import { useDialog } from '../contexts/DialogContext';
import {
  User,
  Smartphone,
  LogOut,
  Cloud,
  ExternalLink,
  Key,
  Lock,
  LogIn,
  UserPlus,
  Link2,
} from 'lucide-react';
import apiClient from '../api/client';

const Account: React.FC = () => {
  const { user, logout, isAuthenticated } = useAuth();
  const { isSyncing, lastSyncTime, syncError } = useCloudSync();
  const { t } = useTranslation();
  const { showDialog } = useDialog();
  const navigate = useNavigate();

  const [avatarAvailable, setAvatarAvailable] = useState(true);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const managementItemClass = 'flex items-center gap-3 px-4 py-4 transition';
  const managementLinkClass = `${managementItemClass} hover:bg-[var(--bg-card-hover)]`;

  const handleLogout = async () => {
    const choice = await showDialog(
      'confirm',
      t('account.logoutConfirm') || 'Do you want to keep your local data?',
      {
        confirmText: t('account.keepData') || 'Keep Local Data',
        cancelText: t('account.clearData') || 'Clear All Data',
        thirdOption: t('common.cancel') || 'Cancel',
        // Esc / dismissal must never trigger the destructive clear-data branch.
        dismissValue: 'third',
        initialFocus: 'last',
      },
    );

    if (choice === 'third') {
      return;
    }

    const clearData = choice === 'cancel';
    await logout(clearData);
  };

  const handleAvatarClick = () => {
    if (!isAuthenticated) return;
    showDialog('alert', t('account.avatarSetHint') || 'To set or change your avatar, visit transmtf.com/profile and sign in again.');
  };

  const handleChangePassword = async () => {
    setPasswordError('');

    if (!oldPassword || !newPassword || !confirmPassword) {
      setPasswordError(t('account.passwordRequired') || 'All fields are required');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(t('account.passwordTooShort') || 'New password must be at least 8 characters');
      return;
    }

    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPasswordError(t('account.passwordComplexity') || 'Password must contain at least one letter and one number');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(t('account.passwordMismatch') || 'Passwords do not match');
      return;
    }

    if (oldPassword === newPassword) {
      setPasswordError(t('account.passwordSame') || 'New password cannot be the same as old password');
      return;
    }

    setChangingPassword(true);
    const response = await apiClient.changePassword({
      old_password: oldPassword,
      new_password: newPassword,
    });
    setChangingPassword(false);

    if (response.success && response.data) {
      showDialog(
        'alert',
        `${t('account.passwordChanged') || 'Password changed successfully'}\n${t('account.otherSessionsLoggedOut') || 'Other sessions logged out'}: ${response.data.other_sessions_logged_out}`,
      );
      setShowPasswordModal(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      setPasswordError(response.error || 'Failed to change password');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-full px-4 py-6">
        <div className="mx-auto w-full max-w-2xl">
          <div className="rounded-2xl glass-card p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-pink-50 border border-pink-100">
              <User className="text-pink-600" size={30} />
            </div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{t('account.title') || 'Profile'}</h1>
            <p className="mx-auto mt-3 max-w-lg text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t('auth.loginPrompt') || 'Login to use cloud sync features'}
            </p>
            <p className="mx-auto mt-1 max-w-lg text-sm" style={{ color: 'var(--text-secondary)' }}>
              Transmtf HRT Tracker helps you sync treatment history, share records, and secure your personal data.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => navigate('/login')}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition"
                style={{ background: 'var(--text-primary)' }}
              >
                <LogIn size={18} />
                {t('auth.login') || 'Login'}
              </button>
              <button
                onClick={() => navigate('/register')}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition"
                style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}
              >
                <UserPlus size={18} />
                {t('auth.register') || 'Register'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full px-4 py-6">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="rounded-2xl glass-card p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleAvatarClick}
              className="relative"
              aria-label={t('account.avatarManage') || 'Avatar'}
            >
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-pink-100">
                {user?.avatarUrl ? (
                  // OIDC provider avatar URL
                  <img
                    src={user.avatarUrl}
                    alt="Avatar"
                    className="h-full w-full object-cover"
                    onError={() => {/* silently fallback */}}
                  />
                ) : user?.username ? (
                  <>
                    <img
                      src={`${apiClient.getAvatarUrl(user.username)}`}
                      alt="Avatar"
                      className={`h-full w-full object-cover ${avatarAvailable ? '' : 'hidden'}`}
                      onLoad={() => setAvatarAvailable(true)}
                      onError={() => setAvatarAvailable(false)}
                    />
                    <User size={32} className={`text-pink-600 ${avatarAvailable ? 'hidden' : ''}`} />
                  </>
                ) : (
                  <User size={32} className="text-pink-600" />
                )}
              </div>
            </button>
            <div className="flex-1">
              <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{user?.displayName || user?.username}</h2>
              {user?.displayName && user?.username !== user?.displayName && (
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>@{user.username}</p>
              )}
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('account.member') || 'Transmtf HRT Tracker Member'}</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {t('account.avatarOAuthOnly') || 'Avatar is synced automatically via third-party login and cannot be uploaded here.'}{' '}
                <a
                  href="https://www.transmtf.com/profile"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-pink-500 underline hover:text-pink-600"
                  onClick={(e) => e.stopPropagation()}
                >
                  transmtf.com/profile
                  <ExternalLink size={10} className="inline" />
                </a>
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl glass-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <Cloud size={20} className="text-blue-500" />
            <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>{t('account.cloudSync') || 'Cloud Sync'}</h3>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>{t('account.status') || 'Status'}:</span>
              <span className={`font-medium ${isSyncing ? 'text-blue-600' : 'text-green-600'}`}>
                {isSyncing ? (t('account.syncing') || 'Syncing...') : (t('account.synced') || 'Synced')}
              </span>
            </div>
            {lastSyncTime && (
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>{t('account.lastSync') || 'Last Sync'}:</span>
                <span style={{ color: 'var(--text-primary)' }}>{new Date(lastSyncTime).toLocaleString()}</span>
              </div>
            )}
            {syncError && (
              <div className="mt-2 text-xs text-red-600">{syncError}</div>
            )}
            <div className="mt-2 border-t pt-2 text-xs" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-tertiary)' }}>
              {t('account.autoSyncNote') || 'Local changes upload in real time; cloud data is pulled every 3 seconds'}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="px-2 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            {t('account.management') || 'Management'}
          </h3>
          <div className="divide-y overflow-hidden rounded-2xl glass-card" style={{ borderColor: 'var(--border-secondary)' }}>
            <Link to="/account/devices" className={managementLinkClass}>
              <Smartphone size={20} style={{ color: 'var(--text-secondary)' }} />
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('account.devices') || 'Devices'}</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('account.devicesDesc') || 'Manage logged in devices'}</p>
              </div>
            </Link>

            <Link to="/account/security" className={managementLinkClass}>
              <Lock size={20} style={{ color: 'var(--text-secondary)' }} />
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('account.securityPassword') || 'Security Password'}</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('account.securityPasswordDesc') || 'Manage 6-digit PIN for data encryption'}</p>
              </div>
            </Link>

            <Link to="/account/oidc" className={managementLinkClass}>
              <Link2 size={20} style={{ color: 'var(--text-secondary)' }} />
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('account.oidc') || 'Transmtf Login'}</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('account.oidcDesc') || 'Manage Transmtf identity and password'}</p>
              </div>
            </Link>

            <button
              onClick={() => setShowPasswordModal(true)}
              className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-[var(--bg-card-hover)]"
            >
              <Key size={20} style={{ color: 'var(--text-secondary)' }} />
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('account.changePassword') || 'Change Password'}</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('account.changePasswordDesc') || 'Update your login password'}</p>
              </div>
            </button>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-3 font-medium text-red-600 transition hover:bg-red-50"
          style={{ background: 'var(--bg-card)' }}
        >
          <LogOut size={18} />
          {t('account.logout') || 'Logout'}
        </button>
      </div>

      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl p-6 shadow-xl" style={{ background: 'var(--bg-card)' }}>
            <h3 className="mb-4 flex items-center gap-2 text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              <Key size={24} className="text-pink-500" />
              {t('account.changePassword') || 'Change Password'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {t('account.oldPassword') || 'Old Password'}
                </label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(event) => setOldPassword(event.target.value)}
                  className="w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pink-500"
                  style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-card-hover)', color: 'var(--text-primary)' }}
                  placeholder={t('account.oldPasswordPlaceholder') || 'Enter old password'}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {t('account.newPassword') || 'New Password'}
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pink-500"
                  style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-card-hover)', color: 'var(--text-primary)' }}
                  placeholder={t('account.newPasswordPlaceholder') || 'Enter new password (8+ chars)'}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {t('account.confirmPassword') || 'Confirm Password'}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pink-500"
                  style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-card-hover)', color: 'var(--text-primary)' }}
                  placeholder={t('account.confirmPasswordPlaceholder') || 'Confirm new password'}
                />
              </div>

              {passwordError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {passwordError}
                </div>
              )}

              <div className="space-y-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                <p>- {t('account.passwordRequirement1') || 'At least 8 characters'}</p>
                <p>- {t('account.passwordRequirement2') || 'Contains at least one letter and one number'}</p>
                <p>- {t('account.passwordWarning') || 'All other devices will be logged out'}</p>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setOldPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setPasswordError('');
                }}
                disabled={changingPassword}
                className="flex-1 rounded-xl border px-4 py-3 font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)', background: 'var(--bg-card-hover)' }}
              >
                {t('btn.cancel') || 'Cancel'}
              </button>
              <button
                onClick={handleChangePassword}
                disabled={changingPassword}
                className="flex-1 rounded-xl bg-pink-600 px-4 py-3 font-medium text-white transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {changingPassword ? (t('account.changing') || 'Changing...') : (t('btn.confirm') || 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Account;