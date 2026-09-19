// Validates content/pt-PT-A1/**/*.json without writing anything.
// Usage: node scripts/content-check.ts [--allow-missing]
//   --allow-missing  downgrade missing topic/phrase-set files to warnings (exit 0 if nothing
//                     else is wrong) — useful while content is still being authored.
import { checkContent, type ContentProblem, type ContentStats } from '../src/content/contentRules.ts';
import { validateProgram } from '../src/content/validateProgram.ts';
import { loadProgram } from './content-lib.ts';
import { printReport } from './content-report.ts';

const allowMissing = process.argv.includes('--allow-missing');
const { program: rawProgram, problems: loadProblems } = loadProgram(allowMissing);

let ruleProblems: ContentProblem[] = [];
let stats: Record<string, ContentStats> = {};
let structuralError: string | undefined;

try {
  const program = validateProgram(rawProgram);
  const result = checkContent(program);
  ruleProblems = result.problems;
  stats = result.stats;
} catch (err) {
  structuralError = err instanceof Error ? err.message : String(err);
}

const totalProblems = printReport({
  programId: typeof rawProgram.id === 'string' ? rawProgram.id : '(unknown)',
  stats,
  loadProblems,
  structuralError,
  ruleProblems,
});

process.exit(totalProblems > 0 ? 1 : 0);
