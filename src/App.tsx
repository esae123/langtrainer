import { ToastProvider } from './components/ToastContext';
import { SettingsProvider } from './settings/SettingsContext';
import { ThemedApp } from './ThemedApp';

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <ThemedApp />
      </ToastProvider>
    </SettingsProvider>
  );
}
