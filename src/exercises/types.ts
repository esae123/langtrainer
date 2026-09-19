import type { Exercise, InputMode } from '../content/types';
import type { ExerciseResponse } from '../engine/check';

export interface ExerciseViewProps<E extends Exercise = Exercise> {
  exercise: E;
  mode: InputMode;
  /** Stable per exercise: seeds tile and letter shuffles so they survive re-renders. */
  seed: number;
  /** `null` while the answer is incomplete, which keeps the Check button disabled. */
  onChange: (response: ExerciseResponse | null) => void;
  /** Enter in a single-line typing field submits the current answer. */
  onSubmit?: () => void;
}
