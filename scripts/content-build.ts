// Assembles content/pt-PT-A1/**/*.json into src/content/programs/<id>.json (generated, committed).
// Fails (exit 1) on any check problem. Usage: node scripts/content-build.ts [--allow-missing]
//   --allow-missing  downgrade missing topic/phrase-set files to warnings — useful for local
//                     builds while content is still being authored (see package.json "build").
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkContent, type ContentProblem, type ContentStats } from '../src/content/contentRules.ts';
import { validateProgram } from '../src/content/validateProgram.ts';
import type { Program } from '../src/content/types.ts';
import { loadProgram } from './content-lib.ts';
import { printReport } from './content-report.ts';

const allowMissing = process.argv.includes('--allow-missing');
const { program: rawProgram, problems: loadProblems } = loadProgram(allowMissing);

let ruleProblems: ContentProblem[] = [];
let stats: Record<string, ContentStats> = {};
let structuralError: string | undefined;
let program: Program | undefined;

try {
  program = validateProgram(rawProgram);
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

if (totalProblems > 0 || !program) {
  console.error('\ncontent:build aborted — fix the problems above first.');
  process.exit(1);
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(SCRIPT_DIR, '..', 'src', 'content', 'programs', `${program.id}.json`);

// The leading "$generated" key marks the file as machine-written; validateProgram() ignores
// unknown keys, so this doesn't need special-casing anywhere the file is loaded.
const generated = { $generated: 'by scripts/content-build.ts — do not edit', ...program };
writeFileSync(outPath, `${JSON.stringify(generated, null, 2)}\n`, 'utf8');

console.log(`\nWrote ${path.relative(path.join(SCRIPT_DIR, '..'), outPath)}`);
