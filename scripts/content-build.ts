// Assembles content/<program>/**/*.json into one Program JSON. Bundled courses (imported by
// src/content/programs/index.ts) are written to src/content/programs/<id>.json (generated,
// committed); any other course to dist-courses/<id>.json (gitignored), a file to import on
// the phone. Fails (exit 1) on any check problem.
// Usage: node scripts/content-build.ts [--program <id>] [--allow-missing]
//   --program <id>   course folder under content/ (default pt-PT-A1)
//   --allow-missing  downgrade missing topic/phrase-set files to warnings — useful for local
//                     builds while content is still being authored (see package.json "build").
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkContent, type ContentProblem, type ContentStats } from '../src/content/contentRules.ts';
import { validateProgram } from '../src/content/validateProgram.ts';
import type { Program } from '../src/content/types.ts';
import { buildOutputPath, bundledProgramIds, loadProgram, programIdFromArgs, REPO_ROOT } from './content-lib.ts';
import { printReport } from './content-report.ts';

const allowMissing = process.argv.includes('--allow-missing');
const programId = programIdFromArgs(process.argv.slice(2));
const { program: rawProgram, problems: loadProblems } = loadProgram(allowMissing, programId);

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

const bundled = bundledProgramIds().includes(program.id);
const outPath = buildOutputPath(program.id);
mkdirSync(path.dirname(outPath), { recursive: true });

// The leading "$generated" key marks the file as machine-written; validateProgram() ignores
// unknown keys, so this doesn't need special-casing anywhere the file is loaded.
const generated = { $generated: 'by scripts/content-build.ts — do not edit', ...program };
writeFileSync(outPath, `${JSON.stringify(generated, null, 2)}\n`, 'utf8');

console.log(`\nWrote ${path.relative(REPO_ROOT, outPath)}`);
if (!bundled) {
  console.log(
    `"${program.id}" is not a bundled course (src/content/programs/index.ts), so this is an importable ` +
      'course file: send it to the phone and use Learn → Courses → "Import a course from file…" (docs/courses.md).'
  );
}
