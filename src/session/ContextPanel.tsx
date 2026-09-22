import { useState } from 'react';
import { ChevronDown, ChevronUp, Play } from 'lucide-react';
import { Card } from '../components/Card';
import { useT } from '../i18n';
import { MiniMarkdown } from '../lib/markdownLite';
import type { TopicInfo } from './topicLookup';

interface ContextPanelProps {
  info: TopicInfo;
  onStart: () => void;
}

/** Full screen shown before the first exercise of a new topic. */
export function ContextPanel({ info, onStart }: ContextPanelProps) {
  const t = useT();
  const [keyItemsOpen, setKeyItemsOpen] = useState(false);
  const keyItems = info.topic?.keyItems ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-[calc(var(--spacing)*6+env(safe-area-inset-top))]">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">
          {info.moduleTitle ?? t('session.block.phrases')}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-text">{info.title}</h1>

        {info.topic?.context && (
          <Card className="mt-4">
            <MiniMarkdown text={info.topic.context} />
          </Card>
        )}

        {keyItems.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              aria-expanded={keyItemsOpen}
              onClick={() => setKeyItemsOpen(!keyItemsOpen)}
              className="flex min-h-11 w-full items-center justify-between rounded-2xl border border-line bg-sheet px-4 text-sm font-semibold text-text shadow-sm"
            >
              {t('session.contextKeyItems')}
              {keyItemsOpen ? (
                <ChevronUp size={20} strokeWidth={2} aria-hidden className="text-muted" />
              ) : (
                <ChevronDown size={20} strokeWidth={2} aria-hidden className="text-muted" />
              )}
            </button>
            {keyItemsOpen && (
              <Card className="mt-2 !p-0">
                <ul className="divide-y divide-line">
                  {keyItems.map((item, i) => (
                    <li key={i} className="px-4 py-2.5">
                      <p className="text-[15px] font-medium text-text">{item.target}</p>
                      <p className="text-sm text-muted">{item.support}</p>
                      {item.note && <p className="mt-0.5 text-xs text-muted">{item.note}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 border-t border-line bg-sheet/95 px-4 pt-3 pb-[calc(var(--spacing)*3+env(safe-area-inset-bottom))] backdrop-blur">
        <button
          type="button"
          onClick={onStart}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent text-base font-semibold text-accent-ink shadow-sm active:opacity-90"
        >
          <Play size={20} strokeWidth={2} aria-hidden />
          {t('session.startExercises')}
        </button>
      </div>
    </div>
  );
}
