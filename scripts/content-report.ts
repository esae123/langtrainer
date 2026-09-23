// Shared "readable report" printer for scripts/content-check.ts and scripts/content-build.ts.
import type { ContentProblem, ContentStats } from '../src/content/contentRules.ts';
import type { LoadProblem } from './content-lib.ts';

function formatStatsLine(id: string, stats: ContentStats): string {
  const typeMix =
    Object.entries(stats.byType)
      .map(([type, count]) => `${type}:${count}`)
      .join(', ') || 'none';
  const diff = stats.byDifficulty;
  return `  ${id.padEnd(28)} ${String(stats.exerciseCount).padStart(3)} exercises  [${typeMix}]  (difficulty 1:${diff['1']} 2:${diff['2']} 3:${diff['3']})`;
}

/**
 * Formats one content-rule problem. Leads with the exercise id and a 1-based "exercise N of
 * total" (not the 0-based array index in `path`, which reads off by one) when the problem is
 * tied to a specific exercise; falls back to the raw path otherwise. The path is kept alongside
 * for anyone who wants to jump straight to the JSON.
 */
function formatRuleProblem(p: ContentProblem): string {
  if (p.exerciseId !== undefined && p.exerciseNumber !== undefined && p.exerciseCount !== undefined) {
    return `  ${p.exerciseId} (exercise ${p.exerciseNumber} of ${p.exerciseCount}): ${p.message}  [path: ${p.path}]`;
  }
  return `  - ${p.path}: ${p.message}`;
}

function formatLoadProblem(p: LoadProblem): string {
  return `  - ${p.path}: ${p.message}`;
}

/**
 * Problems tied to modules not (yet) listed in program.json's moduleOrder (see content-lib.ts).
 * Everything here — missing topic files *and* content-rule violations alike — is informational
 * only: these modules are "checked, not built", so nothing under this heading affects the
 * process exit code. That also means a real bug can be surfaced here without blocking CI even
 * when it lives in a topic file the author must not edit by hand (e.g. hand-generated content
 * pending review) — the point is visibility before the module ships, not gating.
 */
export interface UnlistedReport {
  /** Ids of modules found on disk but absent from moduleOrder, in disk order. */
  moduleIds: string[];
  /** Stats for whichever of those modules' topics have a file (docs/stage-4b-spec.md follow-up). */
  stats: Record<string, ContentStats>;
  /** Missing-topic-file problems for those modules. */
  loadProblems: LoadProblem[];
  /** Content-rule problems for those modules' existing topic files. */
  ruleProblems: ContentProblem[];
}

export interface ReportOptions {
  programId: string;
  stats: Record<string, ContentStats>;
  loadProblems: LoadProblem[];
  structuralError: string | undefined;
  ruleProblems: ContentProblem[];
  /** Present only for content-check (content-build never looks at unlisted modules). */
  unlisted?: UnlistedReport;
}

/** Prints the report and returns the total number of blocking problems (0 means pass). */
export function printReport(options: ReportOptions): number {
  const { programId, stats, loadProblems, structuralError, ruleProblems, unlisted } = options;

  console.log(`Content check — ${programId}`);
  console.log('');

  const statsIds = Object.keys(stats);
  if (statsIds.length > 0) {
    console.log('Topics / phrase sets loaded (in moduleOrder — built):');
    for (const id of statsIds) console.log(formatStatsLine(id, stats[id]));
    console.log('');
  }

  if (unlisted && unlisted.moduleIds.length > 0) {
    console.log(`Not yet in moduleOrder (checked, not built): ${unlisted.moduleIds.join(', ')}`);
    const unlistedStatsIds = Object.keys(unlisted.stats);
    for (const id of unlistedStatsIds) console.log(formatStatsLine(id, unlisted.stats[id]));
    if (unlistedStatsIds.length === 0) console.log('  (no topic files yet — briefs only)');
    // Informational only (never affects RESULT/exit code — see UnlistedReport doc comment):
    // missing topic files are expected here, and any real rule violations in the topic files
    // that do exist are still worth surfacing before the module is added to moduleOrder.
    for (const w of unlisted.loadProblems) console.log(formatLoadProblem(w));
    for (const p of unlisted.ruleProblems) console.log(formatRuleProblem(p));
    console.log('');
  }

  const ruleWarnings = ruleProblems.filter((p) => p.severity === 'warning');
  const ruleErrors = ruleProblems.filter((p) => p.severity !== 'warning');

  const missingWarnings = loadProblems.filter((p) => p.severity === 'warning');
  if (missingWarnings.length > 0 || ruleWarnings.length > 0) {
    console.log('Warnings (non-blocking):');
    for (const w of missingWarnings) console.log(formatLoadProblem(w));
    for (const w of ruleWarnings) console.log(formatRuleProblem(w));
    console.log('');
  }

  const blockingLoadProblems = loadProblems.filter((p) => p.severity === 'error');
  const totalProblems = blockingLoadProblems.length + ruleErrors.length + (structuralError ? 1 : 0);

  if (totalProblems > 0) {
    console.log('Problems:');
    for (const p of blockingLoadProblems) console.log(formatLoadProblem(p));
    if (structuralError) console.log(`  - ${structuralError}`);
    for (const p of ruleErrors) console.log(formatRuleProblem(p));
    console.log('');
  }

  console.log(
    totalProblems > 0 ? `RESULT: FAIL (${totalProblems} problem${totalProblems === 1 ? '' : 's'})` : 'RESULT: PASS'
  );

  return totalProblems;
}
