import { AppShell, Container } from 'cleanplate';
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { ProtectedRoute } from './components/protected-route';
import { UserAccountMenu } from './components/user-account-menu';
import { clearAccessToken } from './lib/auth-token';
import { JobFormPage } from './pages/job-form-page';
import { ChatPage } from './pages/chat-page';
import { JobsPage } from './pages/jobs-page';
import { LoginPage } from './pages/login-page';
import { RunDetailPage } from './pages/run-detail-page';
import { RunsPage } from './pages/runs-page';
import { StatusPage } from './pages/status-page';
import { WatchDetailPage } from './pages/watch-detail-page';
import { WatchFormPage } from './pages/watch-form-page';
import { WatchesPage } from './pages/watches-page';
import styles from './app.module.scss';

const MENU: Array<{ label: string; value: string; icon: any }> = [
  { label: 'Jobs', value: '/jobs', icon: 'work' },
  { label: 'Chat', value: '/chat', icon: 'forum' },
  { label: 'Price watches', value: '/watches', icon: 'sell' },
  { label: 'Runs', value: '/runs', icon: 'history' },
  { label: 'Status', value: '/status', icon: 'monitor_heart' },
];

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShellLayout />}>
            <Route path="/" element={<Navigate to="/jobs" replace />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/new" element={<JobFormPage />} />
            <Route path="/jobs/:jobId" element={<JobFormPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:conversationId" element={<ChatPage />} />
            <Route path="/watches" element={<WatchesPage />} />
            <Route path="/watches/new" element={<WatchFormPage />} />
            <Route path="/watches/:watchId/edit" element={<WatchFormPage />} />
            <Route path="/watches/:watchId" element={<WatchDetailPage />} />
            <Route path="/runs" element={<RunsPage />} />
            <Route path="/runs/:runId" element={<RunDetailPage />} />
            <Route path="/status" element={<StatusPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/jobs" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export function AppShellLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeMenu =
    MENU.find((item) => location.pathname.startsWith(item.value))?.value ?? '/jobs';

  const onMenuClick = (item: { value: string }) => {
    navigate(item.value);
  };

  const onLogout = () => {
    clearAccessToken();
    navigate('/login', { replace: true });
  };

  return (
    <AppShell
      className={styles['app-shell']}
      contentClassName={styles['app-content']}
      sidebar={{
        items: MENU,
        activeItem: activeMenu,
        onMenuClick,
      }}
      header={{
        logoUrl: '/billing-agent-logo.svg',
        menuItems: MENU,
        activeMenuItem: activeMenu,
        onMenuItemClick: onMenuClick,
        showCenterMenu: false,
        headerRight: <UserAccountMenu onLogout={onLogout} />,
      }}
    >
      <Container className={styles['app-root']} padding="4">
        <Outlet />
      </Container>
    </AppShell>
  );
}
