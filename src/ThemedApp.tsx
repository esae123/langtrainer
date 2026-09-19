import { HashRouter, Outlet, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { UpdateToast } from './pwa/UpdateToast';
import { LearnScreen } from './routes/LearnScreen';
import { LibraryDetailScreen } from './routes/LibraryDetailScreen';
import { LibraryScreen } from './routes/LibraryScreen';
import { ProgressScreen } from './routes/ProgressScreen';
import { SettingsScreen } from './routes/SettingsScreen';
import { SessionScreen } from './session/SessionScreen';
import { useThemeEffect } from './theme/useThemeEffect';

/** The tabbed shell; /session renders full-screen outside it. */
function TabLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

/** Separate from App so useThemeEffect (which reads settings) runs inside SettingsProvider. */
export function ThemedApp() {
  useThemeEffect();

  return (
    <HashRouter>
      <Routes>
        <Route element={<TabLayout />}>
          <Route path="/" element={<LearnScreen />} />
          <Route path="/progress" element={<ProgressScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/library" element={<LibraryScreen />} />
          <Route path="/library/:itemId" element={<LibraryDetailScreen />} />
        </Route>
        <Route path="/session" element={<SessionScreen />} />
      </Routes>
      <UpdateToast />
    </HashRouter>
  );
}
