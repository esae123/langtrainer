import { useState } from 'react';
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
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-600 dark:text-accent-300">
          {info.moduleTitle ?? t('session.block.phrases')}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">
          {info.title}
        </h1>

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
              className="flex min-h-11 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            >
              {t('session.contextKeyItems')}
              <span aria-hidden className="text-slate-400">
                {keyItemsOpen ? '▴' : '▾'}
              </span>
            </button>
            {keyItemsOpen && (
              <Card className="mt-2 !p-0">
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {keyItems.map((item, i) => (
                    <li key={i} className="px-4 py-2.5">
                      <p className="text-[15px] font-medium text-slate-900 dark:text-slate-50">
                        {item.target}
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-300">{item.support}</p>
                      {item.note && (
                        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                          {item.note}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </div>

      <div className="safe-bottom sticky bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <button
          type="button"
          onClick={onStart}
          className="min-h-12 w-full rounded-2xl bg-accent-600 text-base font-semibold text-white shadow-sm active:opacity-90"
        >
          {t('session.startExercises')}
        </button>
      </div>
    </div>
  );
}
