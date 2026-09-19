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

export interface ReportOptions {
  programId: string;
  stats: Record<string, ContentStats>;
  loadProblems: LoadProblem[];
  structuralError: string | undefined;
  ruleProblems: ContentProblem[];
}

/** Prints the report and returns the total number of blocking problems (0 means pass). */
export function printReport(options: ReportOptions): number {
  const { programId, stats, loadProblems, structuralError, ruleProblems } = options;

  console.log(`Content check — ${programId}`);
  console.log('');

  const statsIds = Object.keys(stats);
  if (statsIds.length > 0) {
    console.log('Topics / phrase sets loaded:');
    for (const id of statsIds) console.log(formatStatsLine(id, stats[id]));
    console.log('');
  }

  const warnings = loadProblems.filter((p) => p.severity === 'warning');
  if (warnings.length > 0) {
    console.log('Warnings (missing content — allowed with --allow-missing):');
    for (const w of warnings) console.log(`  - ${w.path}: ${w.message}`);
    console.log('');
  }

  const blockingLoadProblems = loadProblems.filter((p) => p.severity === 'error');
  const totalProblems = blockingLoadProblems.length + ruleProblems.length + (structuralError ? 1 : 0);

  if (totalProblems > 0) {
    console.log('Problems:');
    for (const p of blockingLoadProblems) console.log(`  - ${p.path}: ${p.message}`);
    if (structuralError) console.log(`  - ${structuralError}`);
    for (const p of ruleProblems) console.log(`  - ${p.path}: ${p.message}`);
    console.log('');
  }

  console.log(
    totalProblems > 0 ? `RESULT: FAIL (${totalProblems} problem${totalProblems === 1 ? '' : 's'})` : 'RESULT: PASS'
  );

  return totalProblems;
}
