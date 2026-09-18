import { useToast } from '../components/toastStore';
import { useT } from '../i18n';
import { exportBackup, type ExportOutcome } from './backup';

/** Runs exportBackup() and surfaces a success/error toast; shared by Learn and Settings. */
export function useExportBackup() {
  const t = useT();
  const showToast = useToast();

  return async function runExport(): Promise<ExportOutcome | 'error'> {
    try {
      const outcome = await exportBackup();
      if (outcome !== 'cancelled') showToast(t('backup.exportSuccess'));
      return outcome;
    } catch {
      showToast(t('backup.exportError'));
      return 'error';
    }
  };
}
