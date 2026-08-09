import { useState } from 'react';
import { AppShell, Container, Typography } from 'cleanplate';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { JobFormPage } from './pages/job-form-page';
import { JobsPage } from './pages/jobs-page';
import { RunDetailPage } from './pages/run-detail-page';
import { RunsPage } from './pages/runs-page';
import { SettingsPage } from './pages/settings-page';
import { StatusPage } from './pages/status-page';
import styles from './app.module.scss';

const MENU: Array<{ label: string; value: string; icon: any }> = [
  { label: 'Jobs', value: '/jobs', icon: 'work' },
  { label: 'Runs', value: '/runs', icon: 'history' },
  { label: 'Status', value: '/status', icon: 'monitor_heart' },
  { label: 'Settings', value: '/settings', icon: 'settings' },
];

export function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}

export function AppLayout() {
  const [tokenEpoch, setTokenEpoch] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const activeMenu = MENU.find((item) => location.pathname.startsWith(item.value))?.value ?? '/jobs';

  const onMenuClick = (item: { value: string }) => {
    navigate(item.value);
  };

  const onTokenChange = () => setTokenEpoch((value) => value + 1);

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
        menuItems: MENU,
        activeMenuItem: activeMenu,
        onMenuItemClick: onMenuClick,
        showCenterMenu: false,
        headerLeft: (
          <Typography variant="h3" margin="0">
            Billing Agent
          </Typography>
        ),
      }}
    >
      <Container className={styles['app-root']} padding="4">
        <Routes key={tokenEpoch}>
          <Route path="/" element={<Navigate to="/jobs" replace />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/new" element={<JobFormPage />} />
          <Route path="/jobs/:jobId" element={<JobFormPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:runId" element={<RunDetailPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/settings" element={<SettingsPage onTokenChange={onTokenChange} />} />
        </Routes>
      </Container>
    </AppShell>
  );
}
