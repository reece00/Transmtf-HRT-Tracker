import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { LanguageProvider } from './contexts/LanguageContext';
import { DialogProvider } from './contexts/DialogContext';
import { AppDataProvider } from './contexts/AppDataContext';
import { useAuth } from './contexts/AuthContext';
import { useCloudSync } from './contexts/CloudSyncContext';
import MainLayout from './components/MainLayout';
import SecurityPasswordGate from './components/SecurityPasswordGate';
import OIDCBindingGate from './components/OIDCBindingGate';
import AnnouncementModal from './components/AnnouncementModal';
import SyncConflictModal from './components/SyncConflictModal';
import OverviewPage from './pages/OverviewPage';
import HistoryPage from './pages/HistoryPage';
import LabPage from './pages/LabPage';
import SettingsPage from './pages/SettingsPage';
import Login from './pages/Login';
import Register from './pages/Register';
import Account from './pages/Account';
import AccountDevices from './pages/AccountDevices';
import AccountOIDC from './pages/AccountOIDC';
import SecurityPassword from './pages/SecurityPassword';
import OIDCCallback from './pages/OIDCCallback';

// Protected route component
interface ProtectedRouteProps {
  children: React.ReactElement;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

// Sync conflict modal — rendered inside LanguageProvider so useTranslation works
const SyncConflictOverlay: React.FC = () => {
  try {
    const { pendingConflict, resolveConflict } = useCloudSync();
    return (
      <SyncConflictModal
        isOpen={!!pendingConflict}
        conflict={pendingConflict}
        onResolve={resolveConflict}
      />
    );
  } catch {
    // CloudSyncProvider may not be an ancestor if user is not logged in
    return null;
  }
};

const App = () => (
    <LanguageProvider>
        <DialogProvider>
            <AppDataProvider>
                <SecurityPasswordGate />
                <OIDCBindingGate />
                <AnnouncementModal />
                <SyncConflictOverlay />
                <Routes>
                    {/* All routes use MainLayout for unified layout */}
                    <Route element={<MainLayout />}>
                        {/* Main app pages */}
                        <Route index element={<OverviewPage />} />
                        <Route path="history" element={<HistoryPage />} />
                        <Route path="lab" element={<LabPage />} />
                        <Route path="settings" element={<SettingsPage />} />
                        <Route path="profile" element={<Account />} />

                        {/* Auth pages */}
                        <Route path="login" element={<Login />} />
                        <Route path="register" element={<Register />} />

                        {/* Legacy alias */}
                        <Route path="account" element={<Navigate to="/profile" replace />} />

                        {/* Account pages - protected */}
                        <Route path="account/devices" element={<ProtectedRoute><AccountDevices /></ProtectedRoute>} />
                        <Route path="account/security" element={<ProtectedRoute><SecurityPassword /></ProtectedRoute>} />
                        <Route path="account/oidc" element={<ProtectedRoute><AccountOIDC /></ProtectedRoute>} />

                        {/* OIDC callback - no auth required (handles both login and bind) */}
                        <Route path="auth/oidc/callback" element={<OIDCCallback />} />
                    </Route>
                </Routes>
            </AppDataProvider>
        </DialogProvider>
    </LanguageProvider>
);

export default App;
