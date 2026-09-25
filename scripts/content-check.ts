// Validates content/<program>/**/*.json without writing anything.
// Usage: node scripts/content-check.ts [--program <id>] [--allow-missing]
//   --program <id>   course folder under content/ (default pt-PT-A1)
//   --allow-missing  downgrade missing topic/phrase-set files (for modules in program.json's
//                     moduleOrder) to warnings — useful while content is still being authored.
//                     Modules not (yet) in moduleOrder are always checked this leniently: their
//                     missing topic files are warnings regardless of this flag (see content-lib.ts).
import { checkContent, type ContentProblem, type ContentStats } from '../src/content/contentRules.ts';
import { validateProgram } from '../src/content/validateProgram.ts';
import { loadProgram, programIdFromArgs } from './content-lib.ts';
import { printReport, type UnlistedReport } from './content-report.ts';

interface RawModule {
  id?: unknown;
  topics?: unknown[];
}

const allowMissing = process.argv.includes('--allow-missing');
const {
  program: rawProgram,
  problems: loadProblems,
  unlistedModules,
  unlistedProblems,
} = loadProgram(allowMissing, programIdFromArgs(process.argv.slice(2)));

const stats: Record<string, ContentStats> = {};
const ruleProblems: ContentProblem[] = [];
let structuralError: string | undefined;
let unlisted: UnlistedReport | undefined;

const unlistedModuleIds = (unlistedModules as RawModule[]).map((m) => String(m.id));
const unlistedTopicIds = new Set<string>();
for (const m of unlistedModules as RawModule[]) {
  for (const t of m.topics ?? []) {
    const id = (t as { id?: unknown }).id;
    if (typeof id === 'string') unlistedTopicIds.add(id);
  }
}

try {
  // Validate the moduleOrder program together with the modules not yet listed in moduleOrder,
  // so id collisions across the two are still caught, then split the combined result back apart
  // for reporting: content-check must still validate unlisted modules (docs/stage-4b-spec.md
  // follow-up — "so authors can check module 2 before it ships"), even though content-build
  // never includes them in the built program.
  const combinedRaw = {
    ...rawProgram,
    modules: [...(rawProgram.modules as unknown[]), ...unlistedModules],
  };
  const combinedProgram = validateProgram(combinedRaw);
  const combinedResult = checkContent(combinedProgram);

  for (const [id, s] of Object.entries(combinedResult.stats)) {
    if (!unlistedTopicIds.has(id)) stats[id] = s;
  }

  const unlistedRuleProblems: ContentProblem[] = [];
  for (const p of combinedResult.problems) {
    if (unlistedModuleIds.some((id) => p.path.startsWith(`modules.${id}.`))) {
      unlistedRuleProblems.push(p);
    } else {
      ruleProblems.push(p);
    }
  }

  unlisted = {
    moduleIds: unlistedModuleIds,
    stats: Object.fromEntries(Object.entries(combinedResult.stats).filter(([id]) => unlistedTopicIds.has(id))),
    loadProblems: unlistedProblems,
    ruleProblems: unlistedRuleProblems,
  };
} catch (err) {
  structuralError = err instanceof Error ? err.message : String(err);
}

const totalProblems = printReport({
  programId: typeof rawProgram.id === 'string' ? rawProgram.id : '(unknown)',
  stats,
  loadProblems,
  structuralError,
  ruleProblems,
  unlisted,
});

process.exit(totalProblems > 0 ? 1 : 0);
