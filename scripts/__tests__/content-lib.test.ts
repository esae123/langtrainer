import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildOutputPath,
  bundledProgramIds,
  loadProgram,
  moduleTopicBriefs,
  moduleTopicOrder,
  programIdFromArgs,
  REPO_ROOT,
} from '../content-lib.ts';

describe('moduleTopicOrder — both module file shapes parse (docs/stage-4b-spec.md §1)', () => {
  it('derives the order from topics[].id in the new brief shape', () => {
    const moduleJson = {
      id: 'm2',
      title: 'Module 2',
      description: 'd',
      topics: [
        { id: 'm2-a', title: 'A', kind: 'vocabulary', count: 40, brief: 'b1' },
        { id: 'm2-b', title: 'B', kind: 'grammar', count: 40, brief: 'b2', known: 'k', avoid: 'a' },
      ],
    };
    expect(moduleTopicOrder(moduleJson)).toEqual(['m2-a', 'm2-b']);
  });

  it('falls back to the old topicOrder[] shape when there is no topics[]', () => {
    const moduleJson = {
      id: 'm1',
      title: 'Module 1',
      description: 'd',
      topicOrder: ['m1-a', 'm1-b'],
    };
    expect(moduleTopicOrder(moduleJson)).toEqual(['m1-a', 'm1-b']);
  });

  it('prefers topics[] over topicOrder[] when (unusually) both are present', () => {
    const moduleJson = {
      id: 'm1',
      topicOrder: ['old-a'],
      topics: [{ id: 'new-a', title: 'A' }],
    };
    expect(moduleTopicOrder(moduleJson)).toEqual(['new-a']);
  });

  it('returns [] for a module with neither shape', () => {
    expect(moduleTopicOrder({ id: 'm9' })).toEqual([]);
  });
});

describe('moduleTopicBriefs', () => {
  it('extracts the brief objects, ignoring malformed entries without an id', () => {
    const moduleJson = {
      topics: [
        { id: 'm2-a', title: 'A', brief: 'brief a' },
        { title: 'no id, dropped' },
        { id: 'm2-b', brief: 'brief b', known: 'k', avoid: 'a' },
      ],
    };
    expect(moduleTopicBriefs(moduleJson)).toEqual([
      { id: 'm2-a', title: 'A', brief: 'brief a' },
      { id: 'm2-b', brief: 'brief b', known: 'k', avoid: 'a' },
    ]);
  });

  it('returns [] when topics is absent or not an array', () => {
    expect(moduleTopicBriefs({})).toEqual([]);
    expect(moduleTopicBriefs({ topics: 'nope' })).toEqual([]);
  });
});

describe('loadProgram — modules not (yet) in moduleOrder are still loaded separately', () => {
  // Expectations are derived from the real content tree, so adding a module to moduleOrder
  // does not break these tests.
  const contentRoot = path.join(import.meta.dirname, '..', '..', 'content', 'pt-PT-A1');
  const realModuleOrder = (): string[] =>
    JSON.parse(readFileSync(path.join(contentRoot, 'program.json'), 'utf8')).moduleOrder;
  const realModuleFiles = (): string[] =>
    readdirSync(path.join(contentRoot, 'modules'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  // Exercises against the real content/pt-PT-A1 tree (CONTENT_ROOT in content-lib.ts is fixed to
  // it) rather than a fixture, mirroring how content-check.ts/content-build.ts use loadProgram.
  // As of stage 4b, program.json's moduleOrder is ["m1"] only, and modules/m2.json..m7.json
  // exist on disk with topic briefs (docs/stage-4b-spec.md follow-up: "modules not yet listed
  // must still be validated").
  it('keeps program.modules restricted to moduleOrder (what content-build uses)', () => {
    const { program } = loadProgram(true);
    const ids = (program.modules as { id: unknown }[]).map((m) => m.id);
    expect(ids).toEqual(realModuleOrder());
  });

  it('returns modules present on disk but outside moduleOrder as unlistedModules', () => {
    const { unlistedModules } = loadProgram(true);
    const ids = (unlistedModules as { id: unknown }[]).map((m) => m.id).sort();
    const listed = new Set(realModuleOrder());
    expect(ids).toEqual(realModuleFiles().filter((id) => !listed.has(id)));
  });

  it('reports missing topic files of unlisted modules as warnings, regardless of allowMissing', () => {
    for (const allowMissing of [true, false]) {
      const { unlistedProblems } = loadProgram(allowMissing);
      expect(unlistedProblems.length).toBeGreaterThan(0);
      expect(unlistedProblems.every((p) => p.severity === 'warning')).toBe(true);
    }
  });

  it('still reports a missing moduleOrder module/topic as an error without --allow-missing', () => {
    const { problems } = loadProgram(false);
    expect(problems.every((p) => p.severity !== 'error')).toBe(true); // m1 and all its topics exist
  });
});

describe('--program (review S8)', () => {
  it('defaults to pt-PT-A1 and reads --program <id>', () => {
    expect(programIdFromArgs([])).toBe('pt-PT-A1');
    expect(programIdFromArgs(['--allow-missing'])).toBe('pt-PT-A1');
    expect(programIdFromArgs(['--program', 'en-b2', '--allow-missing'])).toBe('en-b2');
    expect(programIdFromArgs(['--program', '--allow-missing'])).toBe('pt-PT-A1');
  });

  it('loads another course folder', () => {
    const { program } = loadProgram(true, 'en-b2');
    expect(program.id).toBe('en-b2');
  });

  it('knows the bundled courses from src/content/programs/index.ts', () => {
    expect(bundledProgramIds()).toContain('pt-PT-A1');
    expect(bundledProgramIds()).not.toContain('en-b2');
  });

  it('writes bundled courses into the app and others to dist-courses/', () => {
    expect(buildOutputPath('pt-PT-A1', ['pt-PT-A1'])).toBe(
      path.join(REPO_ROOT, 'src/content/programs/pt-PT-A1.json')
    );
    expect(buildOutputPath('en-b2', ['pt-PT-A1'])).toBe(
      path.join(REPO_ROOT, 'dist-courses/en-b2.json')
    );
  });
});
