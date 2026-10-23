import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './lib/auth';
import { LoginPage } from './pages/Login';
import { WorkspacesPage } from './pages/Workspaces';
import { AdminUsersPage } from './pages/AdminUsers';
import { WorkspaceShell } from './pages/WorkspaceShell';
import { OverviewPage } from './pages/Overview';
import { ActivityPage } from './pages/Activity';
import { AREA_PRESETS, AreaPage } from './pages/Areas';
import { PeoplePage } from './pages/People';
import { PersonPage } from './pages/Person';
import { CasesPage } from './pages/Cases';
import { CoveragePage } from './pages/Coverage';
import { ImportsPage } from './pages/Imports';
import { SettingsPage } from './pages/Settings';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RequireAuth><WorkspacesPage /></RequireAuth>} />
      <Route path="/admin/users" element={<RequireAuth><AdminUsersPage /></RequireAuth>} />
      <Route path="/w/:wsId" element={<RequireAuth><WorkspaceShell /></RequireAuth>}>
        <Route index element={<OverviewPage />} />
        <Route path="activity" element={<ActivityPage />} />
        {AREA_PRESETS.map((a) => <Route key={a.path} path={a.path} element={<AreaPage preset={a} />} />)}
        <Route path="people" element={<PeoplePage />} />
        <Route path="people/:upn" element={<PersonPage />} />
        <Route path="cases" element={<CasesPage />} />
        <Route path="coverage" element={<CoveragePage />} />
        <Route path="imports" element={<ImportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
