import type { Task } from './types';

type VideoTopic = Pick<Task, 'title'> & Partial<Pick<Task, 'knowledgePoints'>>;
const INSTRUCTION_WORDS = new Set('a an the and or of to for with in on from by create identify learn understand predict verify explain complete submit practice task lesson how why what'.split(' '));

/** A resource query describes the topic, not the learner's submission contract. */
export function buildTaskVideoQuery(task: VideoTopic, language: 'en' | 'zh' | 'mixed' = 'mixed'): string {
  const sources = [task.title, ...(task.knowledgePoints ?? []).slice(0, 2)];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const source of sources) {
    const normalized = source.normalize('NFKC')
      .replace(/(?:请|尝试|学习|了解|掌握|解释|辨认|创建|运行|完成|提交|预测|验证|如何|为什么)/gu, ' ')
      .replace(/(?:以及|并且|并|与|和|的)/gu, ' ');
    for (const word of normalized.match(/[A-Za-z][A-Za-z0-9_.-]*(?:=\d+)?|[\p{Script=Han}]+|\d+(?:\.\d+)?/gu) ?? []) {
      const key = word.toLocaleLowerCase('en');
      if (seen.has(key) || INSTRUCTION_WORDS.has(key)) continue;
      seen.add(key);
      words.push(word);
    }
  }
  const suffix = language === 'zh' ? '中文教程' : 'tutorial';
  const topic: string[] = [];
  for (const word of words) {
    if (word.toLowerCase() === suffix.toLowerCase()) continue;
    if (topic.length >= 12) break;
    if ([...topic, word, suffix].join(' ').length > 100) continue;
    topic.push(word);
  }
  // A single long Chinese title still needs a subject rather than an empty search.
  if (!topic.length && words.length) topic.push(words[0].slice(0, 100 - suffix.length - 1));
  return [...topic, suffix].join(' ');
}
