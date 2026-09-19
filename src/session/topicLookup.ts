import type { Program, Topic } from '../content/types';

export interface TopicInfo {
  topicId: string;
  title: string;
  /** Module name for topics; undefined for phrase sets. */
  moduleTitle?: string;
  topic?: Topic;
}

/** Resolves a plan item's topicId to its title, module and (for topics) content. */
export function topicInfo(program: Program | undefined, topicId: string): TopicInfo {
  if (program) {
    for (const module of program.modules) {
      const topic = module.topics.find((candidate) => candidate.id === topicId);
      if (topic) return { topicId, title: topic.title, moduleTitle: module.title, topic };
    }
    const phraseSet = program.phraseSets.find((set) => set.id === topicId);
    if (phraseSet) return { topicId, title: phraseSet.title };
  }
  return { topicId, title: topicId };
}
