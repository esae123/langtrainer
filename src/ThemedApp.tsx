import { HashRouter, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { UpdateToast } from './pwa/UpdateToast';
import { LearnScreen } from './routes/LearnScreen';
import { LibraryDetailScreen } from './routes/LibraryDetailScreen';
import { LibraryScreen } from './routes/LibraryScreen';
import { ProgressScreen } from './routes/ProgressScreen';
import { SettingsScreen } from './routes/SettingsScreen';
import { useThemeEffect } from './theme/useThemeEffect';

/** Separate from App so useThemeEffect (which reads settings) runs inside SettingsProvider. */
export function ThemedApp() {
  useThemeEffect();

  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<LearnScreen />} />
          <Route path="/progress" element={<ProgressScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/library" element={<LibraryScreen />} />
          <Route path="/library/:itemId" element={<LibraryDetailScreen />} />
        </Routes>
      </Layout>
      <UpdateToast />
    </HashRouter>
  );
}
