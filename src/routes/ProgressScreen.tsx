import { ChartLine } from 'lucide-react';
import { Card } from '../components/Card';
import { useT } from '../i18n';

export function ProgressScreen() {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-4 pt-10 text-center">
      <ChartLine size={48} strokeWidth={2} aria-hidden className="text-accent" />
      <Card className="w-full">
        <h2 className="text-lg font-semibold text-text">{t('progress.emptyTitle')}</h2>
        <p className="mt-2 text-sm text-muted">{t('progress.emptyBody')}</p>
      </Card>
    </div>
  );
}
