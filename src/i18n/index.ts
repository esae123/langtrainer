import en from './en.json';
import ru from './ru.json';
import { useSettings } from '../settings/settingsStore';

export type TranslationKey = keyof typeof en;

const dictionaries: Record<'en' | 'ru', Record<TranslationKey, string>> = { en, ru };

function translate(
  dict: Record<TranslationKey, string>,
  key: TranslationKey,
  vars?: Record<string, string | number>
): string {
  const template = dict[key] ?? en[key] ?? key;
  if (!vars) return template;
  return Object.entries(vars).reduce(
    (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
    template
  );
}

/** Minimal i18n hook: `t('learn.topicsCount', { count: 3 })` -> "3 topics". */
export function useT() {
  const { uiLanguage } = useSettings();
  const dict = dictionaries[uiLanguage];
  return (key: TranslationKey, vars?: Record<string, string | number>) => translate(dict, key, vars);
}
