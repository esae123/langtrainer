import { validateProgram } from '../validateProgram';
import type { Program } from '../types';
import ptPtA1Json from './pt-PT-A1.json';
import enPhrasalVerbsJson from './en-phrasal_verbs.json';

/**
 * The courses built into the app. Look a course up through `src/content/programRegistry.ts`
 * instead of reaching in here, so imported courses are found too.
 */
export const programs: Program[] = [ptPtA1Json, enPhrasalVerbsJson].map((json) => validateProgram(json));
