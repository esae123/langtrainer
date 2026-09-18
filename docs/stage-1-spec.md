# LangTrainer — Stage 1 spec: app skeleton (PWA, storage, settings, backup)

Product context: an installable offline-first PWA for Android (Chrome) for daily language-learning sessions.
Stage 1 delivers a professional-looking, installable skeleton with working storage, settings, and backup.
No exercises yet — but the domain types and DB schema must be defined now so later stages fit.

Project root: this directory (`langtrainer/`). All commands must work with Node 24 / npm 11. No global installs.

## 1. Stack (fixed decisions)

- Vite 6 + React 19 + TypeScript (strict). Package manager: npm.
- Tailwind CSS v4 (via `@tailwindcss/vite`). Dark/light theme follows system (`prefers-color-scheme`), plus manual override in settings (`system | light | dark`).
- Routing: `react-router` v7 with **HashRouter** (GitHub Pages has no SPA fallback).
- Storage: IndexedDB via **Dexie** v4. DB name `langtrainer`.
- PWA: `vite-plugin-pwa` with `registerType: 'prompt'`; show an in-app toast "New version available — Update" that calls `updateSW()`. Precache all built assets. Manifest: name `LangTrainer`, short_name `LangTrainer`, display `standalone`, theme/background colors matching the UI, icons 192/512 PNG + maskable 512 + SVG source. Generate simple but tasteful icons (rounded square, gradient, letter "L" or a speech-bubble glyph); commit the PNGs.
- Base path from env: `VITE_BASE` (default `/`). `vite.config.ts` sets `base: process.env.VITE_BASE ?? '/'`. For GitHub Pages the workflow sets `VITE_BASE=/<repo-name>/`.
- i18n: minimal homegrown solution — `src/i18n/en.json`, `src/i18n/ru.json`, a `useT()` hook, typed keys. UI language default `en`.
- Lint/format: ESLint (typescript-eslint, react-hooks) + Prettier. Tests: Vitest + `fake-indexeddb` for Dexie tests.
- CI: `.github/workflows/deploy.yml` — on push to `main`: install, lint, test, build with `VITE_BASE=/${{ github.event.repository.name }}/`, deploy to GitHub Pages via `actions/deploy-pages`.
- `.gitignore`, `README.md` (English: what it is, how to run, how to deploy to GitHub Pages step by step, env vars).

## 2. Domain types (define in `src/content/types.ts`, export all)

```ts
export type LanguageCode = string; // BCP-47, e.g. 'pt-PT', 'en', 'ru'

export interface Program {
  id: string;            // 'pt-PT-A1'
  title: string;         // 'Português europeu A1'
  targetLanguage: LanguageCode;   // 'pt-PT'
  supportLanguage: LanguageCode;  // language of explanations, 'en'
  level: string;         // 'A1'
  modules: Module[];
  phraseSets: PhraseSet[];        // everyday phrases (not tied to modules)
}

export interface Module { id: string; title: string; description: string; topics: Topic[] }

export interface Topic {
  id: string;            // 'm1-ser-estar'
  moduleId: string;
  title: string;
  kind: 'grammar' | 'vocabulary' | 'situation';
  context: string;       // short situation/rule text shown before the block (markdown allowed)
  keyItems: { target: string; support: string; note?: string }[]; // key words/phrases
  exercises: Exercise[];
}

export interface PhraseSet { id: string; title: string; phrases: { target: string; support: string; register?: 'formal'|'informal'|'neutral'; situation?: string }[]; exercises: Exercise[] }

export type InputMode = 'tiles' | 'letters' | 'typing';

export type ExerciseType =
  | 'build_phrase' | 'fill_gaps' | 'question_for_answer' | 'about_me'
  | 'find_error' | 'number_sequence' | 'match_pairs' | 'order_dialogue' | 'translate_word';

export interface ExerciseBase {
  id: string;
  type: ExerciseType;
  topicId: string;                 // topic or phraseSet id
  difficulty: 1 | 2 | 3;
  allowedModes: InputMode[];       // which input modes can render this exercise
  prompt: string;                  // instruction/situation in support language
  explanation: string;             // 1–2 lines shown after answering
  tags?: string[];                 // e.g. ['ser', 'present', 'articles']
}

export interface BuildPhraseExercise extends ExerciseBase { type: 'build_phrase'; answer: string[]; distractors: string[]; acceptedAnswers?: string[] }
export interface FillGapsExercise extends ExerciseBase { type: 'fill_gaps'; template: string /* 'Eu ___ em Lisboa.' with ___ per gap */; gaps: { answer: string; accepted?: string[] }[]; wordBank: string[] /* answers + distractors */ }
export interface QuestionForAnswerExercise extends ExerciseBase { type: 'question_for_answer'; givenAnswer: string; answer: string[]; distractors: string[]; acceptedAnswers?: string[] }
export interface AboutMeExercise extends ExerciseBase { type: 'about_me'; question: string; sampleAnswer: string; hints: string[] }
export interface FindErrorExercise extends ExerciseBase { type: 'find_error'; sentence: string[]; wrongIndex: number; correction: string; options: string[] }
export interface NumberSequenceExercise extends ExerciseBase { type: 'number_sequence'; sequence: (number|null)[]; answerWords: string[]; options: string[] }
export interface MatchPairsExercise extends ExerciseBase { type: 'match_pairs'; pairs: { target: string; support: string }[] }
export interface OrderDialogueExercise extends ExerciseBase { type: 'order_dialogue'; lines: { speaker: 'A'|'B'; text: string }[] /* correct order */ }
export interface TranslateWordExercise extends ExerciseBase { type: 'translate_word'; direction: 'toTarget'|'toSupport'; sentence: string; word: string; answer: string; options: string[] }

export type Exercise = BuildPhraseExercise | FillGapsExercise | QuestionForAnswerExercise | AboutMeExercise | FindErrorExercise | NumberSequenceExercise | MatchPairsExercise | OrderDialogueExercise | TranslateWordExercise;
```

Also add a Zod schema (or hand-written validator) `validateProgram(json): Program` used by future content loading and by import. Programs live in `src/content/programs/<id>.json` (empty placeholder program `pt-PT-A1` with metadata, zero modules for now, so the app has something to show).

## 3. Dexie schema (`src/db/db.ts`)

Tables (version 1):
- `settings`: `{ key: string; value: unknown }` — primary key `key`.
- `profile`: `{ id: 'me'; aboutMe: string; updatedAt: number }`.
- `topicProgress`: `{ topicId: string; programId: string; status: 'new'|'learning'|'review'|'mastered'|'maintenance'; firstCompletedAt?: number; lastReviewedAt?: number; nextReviewAt?: number; reviewStage: 0|1|2|3; history: { at: number; correct: number; total: number }[]; seenExerciseIds: string[] }` — pk `topicId`, index `programId, nextReviewAt`.
- `sessions`: `{ id: string; programId: string; startedAt: number; endedAt?: number; plannedLength: number; completed: number; correct: number; interrupted: boolean }` — pk `id`, index `startedAt`.
- `attempts`: `{ id: string; sessionId: string; exerciseId: string; topicId: string; mode: InputMode; correct: boolean; diacriticsOk?: boolean; answer: string; at: number }` — pk `id`, indexes `sessionId`, `topicId`, `exerciseId`.
- `customTopics`: `{ id: string; programId: string; topic: Topic; createdAt: number }` — pk `id`.
- `generatedExercises`: `{ id: string; topicId: string; exercise: Exercise; createdAt: number }` — pk `id`, index `topicId`.

Settings object (typed, `src/settings/settings.ts`) with defaults:
```ts
{
  uiLanguage: 'en' | 'ru';               // default 'en'
  theme: 'system'|'light'|'dark';        // 'system'
  activeProgramId: string;               // 'pt-PT-A1'
  sessionLength: 5|10|15|20|30|'open';   // 10
  inputPreset: 'easy'|'normal'|'serious'|'custom'; // 'normal'
  inputShares: { tiles: number; letters: number; typing: number }; // must sum to 100; easy 80/20/0, normal 60/30/10, serious 40/30/30
  geminiApiKey: string;                  // '' — stored locally only, masked in UI, "show" toggle
  generateOnlyOnWifi: boolean;           // true; note: detection is best-effort via navigator.connection
  lastBackupAt: number | null;
}
```
Provide a `useSettings()` hook (React context + Dexie liveQuery) and `updateSettings(partial)`.

## 4. Screens (mobile-first, max-width ~480px centered on desktop, bottom tab bar)

Tabs: **Learn** (home), **Progress**, **Settings**.

- **Learn**: greeting, active program card (title, level, "0 topics"), session length picker (chips 5/10/15/20/30/∞) persisted to settings, big primary button "Start session" — for Stage 1 it opens a friendly "Coming in Stage 3" sheet. Backup reminder banner at top when `lastBackupAt` is null or older than 7 days: "Back up your progress" with "Back up now" (runs export) and dismiss for today (session-only).
- **Progress**: empty-state illustration + text; will be filled in Stage 4.
- **Settings**: grouped list — Language (UI language), Appearance (theme), Session (default length), Input (preset selector with description of each; when `custom`, three sliders that keep sum = 100, show as percentages), AI (Gemini API key input, masked, with help text "Stored only on this device", and Wi-Fi-only toggle), Backup (Export button, Import button, "Last backup: …"), Danger zone (Reset all data with confirm), About (version from package.json, build date).

Visual quality bar: this must not look like a hackathon project. Consistent spacing, rounded cards, one accent color, readable typography (system font stack), touch targets ≥44px, safe-area insets for standalone mode, no layout shift. Show update toast when a new SW is waiting.

## 5. Backup: export / import (`src/backup/`)

- Export: gather all Dexie tables into `{ app: 'langtrainer', schemaVersion: 1, exportedAt: ISO, data: { settings, profile, topicProgress, sessions, attempts, customTopics, generatedExercises } }`. **Never include** `geminiApiKey` in the export (strip it). File name `langtrainer-backup-YYYY-MM-DD.json`. Use Web Share API with a File when `navigator.canShare({files})` is true (Android share sheet), else fall back to a download link. On success set `lastBackupAt = Date.now()`.
- Import: `<input type=file accept=.json,application/json>`; validate shape + schemaVersion; confirm dialog "This replaces all current data"; then in one Dexie transaction clear tables and bulkPut; keep the current `geminiApiKey`. Show success/failure toast.
- Unit tests (Vitest + fake-indexeddb): export→import round-trip restores every table; API key is stripped from export; import rejects malformed input; input shares presets sum to 100 and custom slider normalization works.

## 6. Deliverables checklist

- `npm run dev`, `npm run build`, `npm run preview`, `npm run lint`, `npm run test` all pass.
- Lighthouse-style PWA readiness: manifest, icons, SW, offline load after first visit (verify `npm run preview` serves offline in Chrome devtools with "Offline" — document how to check in README).
- `git init` + `.gitignore` + one commit "Stage 1: app skeleton (PWA, storage, settings, backup)". Commit author uses the existing global git config. Do not create a remote.
- `README.md` with: overview, requirements, scripts, how to deploy on GitHub Pages (create repo, push, enable Pages → GitHub Actions, VITE_BASE handling), how to install on Android, how backups work.
- Keep code idiomatic and small; no unused abstractions; comments only where non-obvious.
