import { validateProgram } from '../validateProgram';
import type { Program } from '../types';
import ptPtA1Json from './pt-PT-A1.json';

export const programs: Program[] = [ptPtA1Json].map((json) => validateProgram(json));

export function getProgram(id: string): Program | undefined {
  return programs.find((p) => p.id === id);
}
