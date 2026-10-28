import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import {
  ChevronRight,
  Download,
  Info,
  Keyboard,
  Languages,
  Library,
  Palette,
  PlugZap,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { Link } from 'react-router';
import pkg from '../../package.json';
import { clearAiSuspension, useAiUsage } from '../ai/aiState';
import { testConnection, type ConnectionResult } from '../ai/openaiCheck';
import { importBackup } from '../backup/backup';
import { useExportBackup } from '../backup/useExportBackup';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SettingsGroup } from '../components/SettingsGroup';
import { Toggle } from '../components/Toggle';
import { ImportCourseButton } from '../courses/ImportCourseButton';
import { ImportHelpButton } from '../courses/ImportHelp';
import { resetProgramProgress, useActiveProgram } from '../content/programRegistry';
import { formatDate } from '../lib/formatDate';
import { useToast } from '../components/toastStore';
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
  type Settings,
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

type DraftField = 'openaiApiKey' | 'openaiModel';

/**
 * Local draft + persist-on-blur so a text setting doesn't round-trip through IndexedDB
 * on every keystroke; a ref tracks "dirty" so an edit is still saved if the user
 * navigates away without blurring the field first. Changing the key or model lifts an
 * AI suspension (docs/stage-7-spec.md §4).
 */
function useDraftSetting(settings: Settings, field: DraftField) {
  const stored = settings[field];
  const [draft, setDraft] = useState(stored);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (dirtyRef.current) return;
    setDraft(stored);
    draftRef.current = stored;
  }, [stored]);

  useEffect(
    () => () => {
      if (!dirtyRef.current) return;
      clearAiSuspension();
      void updateSettings({ [field]: draftRef.current.trim() });
    },
    [field]
  );

  function change(value: string) {
    dirtyRef.current = true;
    draftRef.current = value;
    setDraft(value);
  }

  /** Saves a pending edit; resolves once it is written. */
  async function persist(): Promise<void> {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    clearAiSuspension();
    await updateSettings({ [field]: draftRef.current.trim() });
  }

  return { draft, change, persist };
}

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'noKey' }
  | { kind: 'testing' }
  | { kind: 'done'; result: ConnectionResult };

export function SettingsScreen() {
  const t = useT();
  const settings = useSettings();
  const activeProgram = useActiveProgram();
  const showToast = useToast();
  const runExport = useExportBackup();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uiLanguageSelectId = useId();
  const apiKeyInputId = useId();
  const modelInputId = useId();
  const apiKeyHelpId = useId();
  const modelHintId = useId();
  const aiUsage = useAiUsage();

  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>({ kind: 'idle' });
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const apiKey = useDraftSetting(settings, 'openaiApiKey');
  const model = useDraftSetting(settings, 'openaiModel');

  async function handleTestConnection() {
    await Promise.all([apiKey.persist(), model.persist()]);
    if (apiKey.draft.trim() === '') {
      setTestStatus({ kind: 'noKey' });
      return;
    }
    setTestStatus({ kind: 'testing' });
    const result = await testConnection(apiKey.draft, model.draft.trim() || settings.openaiModel);
    setTestStatus({ kind: 'done', result });
  }

  function testStatusText(status: TestStatus): string {
    if (status.kind === 'idle') return '';
    if (status.kind === 'noKey') return t('settings.aiTestNoKey');
    if (status.kind === 'testing') return t('settings.aiTesting');
    const { result } = status;
    if (result.ok) return t('settings.aiTestOk');
    switch (result.reason) {
      case 'invalidKey':
        return t('settings.aiTestInvalidKey');
      case 'noCredit':
        return t('settings.aiTestNoCredit');
      case 'network':
        return t('settings.aiTestNetwork');
      case 'timeout':
        return t('settings.aiTestTimeout');
      default:
        return t('settings.aiTestError', {
          message: result.message ?? `HTTP ${result.status ?? '?'}`,
        });
    }
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
    await resetProgramProgress(settings.activeProgramId);
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
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="flex min-w-0 flex-col">
            <span className="break-words text-sm font-medium text-text">
              {t('settings.aiCheck')}
            </span>
            <span className="break-words text-xs text-muted">{t('settings.aiCheckHelp')}</span>
          </span>
          <Toggle
            checked={settings.aiCheckEnabled}
            onChange={(checked) => {
              clearAiSuspension();
              void updateSettings({ aiCheckEnabled: checked });
            }}
            label={t('settings.aiCheck')}
          />
        </div>
        <div className="flex flex-col gap-2 px-4 py-3">
          <label htmlFor={apiKeyInputId} className="text-sm font-medium text-text">
            {t('settings.openaiApiKey')}
          </label>
          <div className="flex gap-2">
            <input
              id={apiKeyInputId}
              type={showApiKey ? 'text' : 'password'}
              value={apiKey.draft}
              onChange={(e) => {
                apiKey.change(e.target.value);
                setTestStatus({ kind: 'idle' });
              }}
              onBlur={() => void apiKey.persist()}
              placeholder="sk-…"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={apiKeyHelpId}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-sheet px-3 text-sm text-text"
            />
            <button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              className="min-h-11 shrink-0 rounded-lg border border-line px-3 text-sm font-medium text-muted"
            >
              {showApiKey ? t('settings.apiKeyHide') : t('settings.apiKeyShow')}
            </button>
          </div>
          <p id={apiKeyHelpId} className="break-words text-xs text-muted">
            {t('settings.openaiApiKeyHelp')}
          </p>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3">
          <label htmlFor={modelInputId} className="text-sm font-medium text-text">
            {t('settings.openaiModel')}
          </label>
          <input
            id={modelInputId}
            type="text"
            value={model.draft}
            onChange={(e) => {
              model.change(e.target.value);
              setTestStatus({ kind: 'idle' });
            }}
            onBlur={() => void model.persist()}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-describedby={modelHintId}
            className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-sheet px-3 text-sm text-text"
          />
          <p id={modelHintId} className="text-xs text-muted">
            {t('settings.openaiModelHint')}
          </p>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={testStatus.kind === 'testing'}
              onClick={() => void handleTestConnection()}
              className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-text disabled:text-muted"
            >
              <PlugZap size={18} strokeWidth={2} aria-hidden />
              {t('settings.aiTest')}
            </button>
            <p
              role="status"
              aria-live="polite"
              className={`min-w-0 flex-1 break-words text-sm ${
                testStatus.kind === 'done' && testStatus.result.ok
                  ? 'text-ok'
                  : testStatus.kind === 'done' || testStatus.kind === 'noKey'
                    ? 'text-bad'
                    : 'text-muted'
              }`}
            >
              {testStatusText(testStatus)}
            </p>
          </div>
          <p className="text-xs text-muted">
            {t('settings.aiUsage', {
              checks: aiUsage?.checks ?? 0,
              tokens: (aiUsage?.tokens ?? 0).toLocaleString('en'),
            })}
          </p>
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
            accept=".json,application/json,text/plain"
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
          <span className="flex flex-col">
            <span className="text-sm font-medium text-text">{t('courses.title')}</span>
            <span className="text-xs text-muted">{t('settings.coursesHint')}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <ImportCourseButton className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-text">
              <Upload size={18} strokeWidth={2} aria-hidden />
              {t('courses.import')}
            </ImportCourseButton>
            <ImportHelpButton />
          </span>
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
        body={t('settings.resetConfirmBody', {
          course: activeProgram?.title ?? settings.activeProgramId,
        })}
        confirmLabel={t('settings.resetConfirmOk')}
        cancelLabel={t('settings.resetConfirmCancel')}
        danger
        onConfirm={() => void handleResetConfirm()}
        onCancel={() => setResetConfirmOpen(false)}
      />
    </div>
  );
}
