import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import {
  ChevronRight,
  Download,
  Info,
  Keyboard,
  Languages,
  Library,
  Palette,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { Link } from 'react-router';
import pkg from '../../package.json';
import { importBackup } from '../backup/backup';
import { useExportBackup } from '../backup/useExportBackup';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SettingsGroup } from '../components/SettingsGroup';
import { Toggle } from '../components/Toggle';
import { ImportCourseButton } from '../courses/ImportCourseButton';
import { formatDate } from '../lib/formatDate';
import { useToast } from '../components/toastStore';
import { resetAllData } from '../db/reset';
import { useT, type TranslationKey } from '../i18n';
import {
  INPUT_PRESETS,
  SESSION_LENGTH_OPTIONS,
  SESSION_MIX_PRESETS,
  normalizeInputShares,
  normalizeMixShares,
  type InputPreset,
  type InputShares,
  type SessionLength,
  type SessionMixPreset,
  type SessionMixShares,
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

const MIX_PRESET_ORDER: SessionMixPreset[] = ['balanced', 'more-new', 'more-review', 'custom'];
const MIX_LABEL_KEY: Record<SessionMixPreset, TranslationKey> = {
  balanced: 'settings.mixPreset.balanced',
  'more-new': 'settings.mixPreset.moreNew',
  'more-review': 'settings.mixPreset.moreReview',
  custom: 'settings.mixPreset.custom',
};
const MIX_DESC_KEY: Record<SessionMixPreset, TranslationKey> = {
  balanced: 'settings.mixPreset.balancedDesc',
  'more-new': 'settings.mixPreset.moreNewDesc',
  'more-review': 'settings.mixPreset.moreReviewDesc',
  custom: 'settings.mixPreset.customDesc',
};
const MIX_FIELDS: { key: keyof SessionMixShares; labelKey: TranslationKey }[] = [
  { key: 'new', labelKey: 'settings.mixShares.new' },
  { key: 'review', labelKey: 'settings.mixShares.review' },
  { key: 'phrases', labelKey: 'settings.mixShares.phrases' },
];

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

  function handleMixPresetChange(preset: SessionMixPreset) {
    // Custom starts from whatever split is showing, so the sliders don't jump.
    const shares = preset === 'custom' ? settings.sessionMix.shares : SESSION_MIX_PRESETS[preset];
    void updateSettings({ sessionMix: { preset, shares } });
  }

  function handleMixShareChange(field: keyof SessionMixShares, value: number) {
    const shares = normalizeMixShares({ ...settings.sessionMix.shares, [field]: value });
    void updateSettings({ sessionMix: { preset: 'custom', shares } });
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
      <h1 className="text-2xl font-semibold text-text">{t('nav.settings')}</h1>

      <SettingsGroup
        title={t('settings.language')}
        icon={<Languages size={14} strokeWidth={2} aria-hidden />}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <label htmlFor={uiLanguageSelectId} className="text-sm font-medium text-text">
            {t('settings.uiLanguage')}
          </label>
          <select
            id={uiLanguageSelectId}
            value={settings.uiLanguage}
            onChange={(e) => void updateSettings({ uiLanguage: e.target.value as UiLanguage })}
            className="min-h-11 rounded-lg border border-line bg-sheet px-3 text-sm text-text"
          >
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.appearance')}
        icon={<Palette size={14} strokeWidth={2} aria-hidden />}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium text-text">{t('settings.theme')}</span>
          <div className="flex overflow-hidden rounded-lg border border-line">
            {(['system', 'light', 'dark'] as Theme[]).map((theme) => (
              <button
                key={theme}
                type="button"
                aria-pressed={settings.theme === theme}
                onClick={() => void updateSettings({ theme })}
                className={`min-h-11 px-3 text-sm font-medium ${
                  settings.theme === theme ? 'bg-accent text-accent-ink' : 'bg-sheet text-muted'
                }`}
              >
                {t(`settings.theme.${theme}` as TranslationKey)}
              </button>
            ))}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.session')}
        icon={<Timer size={14} strokeWidth={2} aria-hidden />}
      >
        <div className="flex flex-col gap-2 px-4 py-3">
          <span className="text-sm font-medium text-text">{t('settings.sessionLength')}</span>
          <div className="flex flex-wrap gap-2">
            {SESSION_LENGTH_OPTIONS.map((length: SessionLength) => (
              <button
                key={String(length)}
                type="button"
                aria-pressed={settings.sessionLength === length}
                onClick={() => void updateSettings({ sessionLength: length })}
                className={`min-h-11 min-w-11 rounded-full px-4 text-sm font-semibold ${
                  settings.sessionLength === length
                    ? 'bg-accent text-accent-ink'
                    : 'border border-line bg-sheet text-muted'
                }`}
              >
                {length === 'open' ? '∞' : length}
              </button>
            ))}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.sessionMix')}
        icon={<SlidersHorizontal size={14} strokeWidth={2} aria-hidden />}
      >
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex flex-col gap-2">
            {MIX_PRESET_ORDER.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleMixPresetChange(preset)}
                aria-pressed={settings.sessionMix.preset === preset}
                className={`min-h-11 rounded-xl border px-3 py-2 text-left ${
                  settings.sessionMix.preset === preset
                    ? 'border-accent bg-accent-soft'
                    : 'border-line'
                }`}
              >
                <span className="block break-words text-sm font-semibold text-text">
                  {t(MIX_LABEL_KEY[preset])}
                </span>
                <span className="block break-words text-xs text-muted">
                  {t(MIX_DESC_KEY[preset])}
                </span>
              </button>
            ))}
          </div>

          {settings.sessionMix.preset === 'custom' && (
            <div className="mt-2 flex flex-col gap-4">
              {MIX_FIELDS.map(({ key, labelKey }) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="flex justify-between gap-3 text-xs font-medium text-muted">
                    <span className="break-words">{t(labelKey)}</span>
                    <span className="shrink-0 tabular-nums">
                      {settings.sessionMix.shares[key]}%
                    </span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings.sessionMix.shares[key]}
                    onChange={(e) => handleMixShareChange(key, Number(e.target.value))}
                    className="h-11 accent-accent"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.input')}
        icon={<Keyboard size={14} strokeWidth={2} aria-hidden />}
      >
        <div className="flex flex-col gap-2 px-4 py-3">
          <span className="text-sm font-medium text-text">{t('settings.inputPreset')}</span>
          <div className="flex flex-col gap-2">
            {INPUT_PRESET_ORDER.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handlePresetChange(preset)}
                aria-pressed={settings.inputPreset === preset}
                className={`min-h-11 rounded-xl border px-3 py-2 text-left ${
                  settings.inputPreset === preset ? 'border-accent bg-accent-soft' : 'border-line'
                }`}
              >
                <span className="block text-sm font-semibold text-text">
                  {t(PRESET_LABEL_KEY[preset])}
                </span>
                <span className="block text-xs text-muted">{t(PRESET_DESC_KEY[preset])}</span>
              </button>
            ))}
          </div>

          {settings.inputPreset === 'custom' && (
            <div className="mt-2 flex flex-col gap-4">
              {SHARE_FIELDS.map(({ key, labelKey }) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="flex justify-between text-xs font-medium text-muted">
                    <span>{t(labelKey)}</span>
                    <span>{settings.inputShares[key]}%</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings.inputShares[key]}
                    onChange={(e) => handleShareChange(key, Number(e.target.value))}
                    className="h-11 accent-accent"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium text-text">{t('settings.typingHint')}</span>
          <Toggle
            checked={settings.typingHint}
            onChange={(checked) => void updateSettings({ typingHint: checked })}
            label={t('settings.typingHint')}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.ai')}
        icon={<Sparkles size={14} strokeWidth={2} aria-hidden />}
      >
        <div className="flex flex-col gap-2 px-4 py-3">
          <label htmlFor={apiKeyInputId} className="text-sm font-medium text-text">
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
              className="min-h-11 flex-1 rounded-lg border border-line bg-sheet px-3 text-sm text-text"
            />
            <button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              className="min-h-11 rounded-lg border border-line px-3 text-sm font-medium text-muted"
            >
              {showApiKey ? t('settings.geminiApiKeyHide') : t('settings.geminiApiKeyShow')}
            </button>
          </div>
          <p className="text-xs text-muted">{t('settings.geminiApiKeyHelp')}</p>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium text-text">{t('settings.wifiOnly')}</span>
          <Toggle
            checked={settings.generateOnlyOnWifi}
            onChange={(checked) => void updateSettings({ generateOnlyOnWifi: checked })}
            label={t('settings.wifiOnly')}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.backup')}
        icon={<Download size={14} strokeWidth={2} aria-hidden />}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium text-text">{t('settings.backupExport')}</span>
          <button
            type="button"
            onClick={() => void runExport()}
            className="flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink"
          >
            <Download size={18} strokeWidth={2} aria-hidden />
            {t('settings.backupExport')}
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium text-text">{t('settings.backupImport')}</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-text"
          >
            <Upload size={18} strokeWidth={2} aria-hidden />
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
          <p className="text-sm text-muted">
            {settings.lastBackupAt === null
              ? t('settings.backupLastNever')
              : t('settings.backupLast', {
                  date: formatDate(settings.lastBackupAt, settings.uiLanguage),
                })}
          </p>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.danger')}
        icon={<TriangleAlert size={14} strokeWidth={2} aria-hidden />}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium text-bad">{t('settings.resetAll')}</span>
          <button
            type="button"
            onClick={() => setResetConfirmOpen(true)}
            className="flex min-h-11 items-center gap-2 rounded-lg bg-bad px-4 text-sm font-semibold text-paper"
          >
            <Trash2 size={18} strokeWidth={2} aria-hidden />
            {t('settings.resetAll')}
          </button>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.library')}
        icon={<Library size={14} strokeWidth={2} aria-hidden />}
      >
        <Link
          to="/library"
          className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-text"
        >
          <span>{t('library.title')}</span>
          <ChevronRight size={20} strokeWidth={2} aria-hidden className="text-muted" />
        </Link>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium text-text">{t('courses.import')}</span>
          <ImportCourseButton className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-text">
            <Upload size={18} strokeWidth={2} aria-hidden />
            {t('courses.import')}
          </ImportCourseButton>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('settings.about')}
        icon={<Info size={14} strokeWidth={2} aria-hidden />}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-muted">{t('settings.version')}</span>
          <span className="text-sm font-medium text-text">{pkg.version}</span>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-muted">{t('settings.buildDate')}</span>
          <span className="text-sm font-medium text-text">{__BUILD_DATE__}</span>
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
