import { Card } from '../components/Card';
import { useT } from '../i18n';

export function ProgressScreen() {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-4 pt-10 text-center">
      <div aria-hidden className="text-5xl">
        📈
      </div>
      <Card className="w-full">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {t('progress.emptyTitle')}
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t('progress.emptyBody')}</p>
      </Card>
    </div>
  );
}
