import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import pkg from '../../package.json';
import { importBackup } from '../backup/backup';
import { useExportBackup } from '../backup/useExportBackup';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SettingsGroup } from '../components/SettingsGroup';
import { Toggle } from '../components/Toggle';
import { useToast } from '../components/toastStore';
import { resetAllData } from '../db/reset';
import { useT, type TranslationKey } from '../i18n';
import {
  INPUT_PRESETS,
  SESSION_LENGTH_OPTIONS,
  normalizeInputShares,
  type InputPreset,
  type InputShares,
  type SessionLength,
  type Theme,
  type UiLanguage,
} from '../settings/settings';
import { updateSettings, useSettings } from '../settings/settingsStore';

const INPUT_PRESET_ORDER: InputPreset[] = ['easy', 'normal', 'serious', 'custom'];
const PRESET_LABEL_KEY: Record<InputPreset, TranslationKey> = {
  easy: 'settings.inputPreset.easy',
  normal: 'settings.inputPreset.normal',
  serious: 'settings.inputPreset.serious',
  custom: 'settings.inputPreset.custom',
};
const PRESET_DESC_KEY: Record<InputPreset, TranslationKey> = {
  easy: 'settings.inputPreset.easyDesc',
  normal: 'settings.inputPreset.normalDesc',
  serious: 'settings.inputPreset.seriousDesc',
  custom: 'settings.inputPreset.customDesc',
};
const SHARE_FIELDS: { key: keyof InputShares; labelKey: TranslationKey }[] = [
  { key: 'tiles', labelKey: 'settings.inputShares.tiles' },
  { key: 'letters', labelKey: 'settings.inputShares.letters' },
  { key: 'typing', labelKey: 'settings.inputShares.typing' },
];

function formatDate(ms: number, locale: string): string {
  return new Date(ms).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function SettingsScreen() {
  const t = useT();
  const settings = useSettings();
  const showToast = useToast();
  const runExport = useExportBackup();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uiLanguageSelectId = useId();
  const apiKeyInputId = useId();

  const [showApiKey, setShowApiKey] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  // Local draft + persist-on-blur so the API key doesn't round-trip through
  // IndexedDB on every keystroke; a ref tracks "dirty" so an edit is still
  // saved if the user navigates away without blurring the field first.
  const [apiKeyDraft, setApiKeyDraft] = useState(settings.geminiApiKey);
  const apiKeyDraftRef = useRef(apiKeyDraft);
  const apiKeyDirtyRef = useRef(false);

  useEffect(() => {
    if (apiKeyDirtyRef.current) return;
    setApiKeyDraft(settings.geminiApiKey);
    apiKeyDraftRef.current = settings.geminiApiKey;
  }, [settings.geminiApiKey]);

  useEffect(
    () => () => {
      if (apiKeyDirtyRef.current) void updateSettings({ geminiApiKey: apiKeyDraftRef.current });
    },
    []
  );

  function handleApiKeyChange(value: string) {
    apiKeyDirtyRef.current = true;
    apiKeyDraftRef.current = value;
    setApiKeyDraft(value);
  }

  function persistApiKeyIfDirty() {
    if (!apiKeyDirtyRef.current) return;
    apiKeyDirtyRef.current = false;
    void updateSettings({ geminiApiKey: apiKeyDraftRef.current });
  }

  function handlePresetChange(preset: InputPreset) {
    if (preset === 'custom') {
      void updateSettings({ inputPreset: preset });
    } else {
      void updateSettings({ inputPreset: preset, inputShares: INPUT_PRESETS[preset] });
    }
  }

  function handleShareChange(field: keyof InputShares, value: number) {
    const next = normalizeInputShares({ ...settings.inputShares, [field]: value });
    void updateSettings({ inputShares: next });
  }

  function handleFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) setPendingImportFile(file);
  }

  async function handleImportConfirm() {
    const file = pendingImportFile;
    setPendingImportFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    try {
      await importBackup(file);
      showToast(t('settings.backupImportSuccess'));
    } catch {
      showToast(t('settings.backupImportError'));
    }
  }

  function handleImportCancel() {
    setPendingImportFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleResetConfirm() {
    setResetConfirmOpen(false);
    await resetAllData();
    showToast(t('settings.resetDone'));
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{t('nav.settings')}</h1>

      <SettingsGroup title={t('settings.language')}>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <label
            htmlFor={uiLanguageSelectId}
            className="text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            {t('settings.uiLanguage')}
          </label>
          <select
            id={uiLanguageSelectId}
            value={settings.uiLanguage}
            onChange={(e) => void updateSettings({ uiLanguage: e.target.value as UiLanguage })}
            className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('settings.appearance')}>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('settings.theme')}</span>
          <div className="flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            {(['system', 'light', 'dark'] as Theme[]).map((theme) => (
              <button
                key={theme}
                type="button"
                aria-pressed={settings.theme === theme}
                onClick={() => void updateSettings({ theme })}
                className={`min-h-11 px-3 text-sm font-medium ${
                  settings.theme === theme
                    ? 'bg-accent-600 text-white'
                    : 'bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                {t(`settings.theme.${theme}` as TranslationKey)}
              </button>
            ))}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('settings.session')}>
        <div className="flex flex-col gap-2 px-4 py-3">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('settings.sessionLength')}
          </span>
          <div className="flex flex-wrap gap-2">
            {SESSION_LENGTH_OPTIONS.map((length: SessionLength) => (
              <button
                key={String(length)}
                type="button"
                aria-pressed={settings.sessionLength === length}
                onClick={() => void updateSettings({ sessionLength: length })}
                className={`min-h-11 min-w-11 rounded-full px-4 text-sm font-semibold ${
                  settings.sessionLength === length
                    ? 'bg-accent-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                {length === 'open' ? '∞' : length}
              </button>
            ))}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('settings.input')}>
        <div className="flex flex-col gap-2 px-4 py-3">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('settings.inputPreset')}
          </span>
          <div className="flex flex-col gap-2">
            {INPUT_PRESET_ORDER.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handlePresetChange(preset)}
                aria-pressed={settings.inputPreset === preset}
                className={`min-h-11 rounded-xl border px-3 py-2 text-left ${
                  settings.inputPreset === preset
                    ? 'border-accent-500 bg-accent-50 dark:border-accent-400 dark:bg-accent-700/20'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {t(PRESET_LABEL_KEY[preset])}
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {t(PRESET_DESC_KEY[preset])}
                </span>
              </button>
            ))}
          </div>

          {settings.inputPreset === 'custom' && (
            <div className="mt-2 flex flex-col gap-4">
              {SHARE_FIELDS.map(({ key, labelKey }) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="flex justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
                    <span>{t(labelKey)}</span>
                    <span>{settings.inputShares[key]}%</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings.inputShares[key]}
                    onChange={(e) => handleShareChange(key, Number(e.target.value))}
                    className="h-11 accent-accent-600"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('settings.ai')}>
        <div className="flex flex-col gap-2 px-4 py-3">
          <label
            htmlFor={apiKeyInputId}
            className="text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            {t('settings.geminiApiKey')}
          </label>
          <div className="flex gap-2">
            <input
              id={apiKeyInputId}
              type={showApiKey ? 'text' : 'password'}
              value={apiKeyDraft}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              onBlur={persistApiKeyIfDirty}
              placeholder="AIza…"
              autoComplete="off"
              className="min-h-11 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
            >
              {showApiKey ? t('settings.geminiApiKeyHide') : t('settings.geminiApiKeyShow')}
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.geminiApiKeyHelp')}</p>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('settings.wifiOnly')}
          </span>
          <Toggle
            checked={settings.generateOnlyOnWifi}
            onChange={(checked) => void updateSettings({ generateOnlyOnWifi: checked })}
            label={t('settings.wifiOnly')}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('settings.backup')}>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('settings.backupExport')}
          </span>
          <button
            type="button"
            onClick={() => void runExport()}
            className="min-h-11 rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white"
          >
            {t('settings.backupExport')}
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('settings.backupImport')}
          </span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-11 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
          >
            {t('settings.backupImport')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChosen}
            className="hidden"
          />
        </div>
        <div className="px-4 py-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {settings.lastBackupAt === null
              ? t('settings.backupLastNever')
              : t('settings.backupLast', {
                  date: formatDate(settings.lastBackupAt, settings.uiLanguage),
                })}
          </p>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('settings.danger')}>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium text-red-600 dark:text-red-400">
            {t('settings.resetAll')}
          </span>
          <button
            type="button"
            onClick={() => setResetConfirmOpen(true)}
            className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white"
          >
            {t('settings.resetAll')}
          </button>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('settings.about')}>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-slate-500 dark:text-slate-400">{t('settings.version')}</span>
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{pkg.version}</span>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-slate-500 dark:text-slate-400">{t('settings.buildDate')}</span>
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{__BUILD_DATE__}</span>
        </div>
      </SettingsGroup>

      <ConfirmDialog
        open={pendingImportFile !== null}
        title={t('settings.backupImportConfirmTitle')}
        body={t('settings.backupImportConfirmBody')}
        confirmLabel={t('settings.backupImportConfirmOk')}
        cancelLabel={t('settings.backupImportConfirmCancel')}
        danger
        onConfirm={() => void handleImportConfirm()}
        onCancel={handleImportCancel}
      />

      <ConfirmDialog
        open={resetConfirmOpen}
        title={t('settings.resetConfirmTitle')}
        body={t('settings.resetConfirmBody')}
        confirmLabel={t('settings.resetConfirmOk')}
        cancelLabel={t('settings.resetConfirmCancel')}
        danger
        onConfirm={() => void handleResetConfirm()}
        onCancel={() => setResetConfirmOpen(false)}
      />
    </div>
  );
}
