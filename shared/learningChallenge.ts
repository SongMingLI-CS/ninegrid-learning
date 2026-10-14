import type { LessonContent, Task } from './types';

export function taskChallengeContract(task: Pick<Task, 'title' | 'brief' | 'deliverable' | 'objectives'>): { prompt: string; rubric: string[] } {
  const deliverable = task.deliverable?.trim() || task.title;
  return {
    prompt: `本任务：${task.title}\n${task.brief}\n\n独立交付：${deliverable}`.slice(0, 4000),
    rubric: task.objectives.map(objective => objective.text).slice(0, 20),
  };
}

export function preservesExplicitMatrixShapes(task: Pick<Task, 'title' | 'brief' | 'deliverable' | 'objectives'>, prompt: string): boolean {
  const contract = [task.title, task.brief, task.deliverable, ...task.objectives.map(objective => objective.text)].join('\n');
  const shapes = [...contract.matchAll(/(\d+)\s*[×xX]\s*(\d+)/g)].map(match => [match[1], match[2]] as const);
  return shapes.every(([rows, columns]) => new RegExp(`(^|\\D)${rows}\\s*[×xX]\\s*${columns}(?!\\d)`).test(prompt));
}

export function usesCodeExample(task: Pick<Task, 'title' | 'brief' | 'knowledgePoints'>): boolean {
  return /\b(numpy|python|array|ndarray|code|program|script|terminal|sql|function|variable|axis|dtype)\b/i.test(`${task.title} ${task.brief} ${(task.knowledgePoints ?? []).join(' ')}`);
}

export function feynmanFollowUp(task: Pick<Task, 'title' | 'brief'>): string {
  return `如果把「${task.title}」用到不同输入或条件上，结果会怎样变化？请结合题目中的目标说明原因。`;
}

function answerTokens(value: string): Set<string> {
  const result = new Set<string>();
  for (const match of value.toLocaleLowerCase().matchAll(/[a-z0-9]+|[\u3400-\u9fff]{2,}/gu)) {
    const token = match[0];
    if (/^[\u3400-\u9fff]+$/u.test(token)) {
      for (let index = 0; index < token.length - 1; index++) result.add(token.slice(index, index + 2));
    } else result.add(token);
  }
  return result;
}

/** True when a learner-visible teaching section substantially contains the current challenge answer. */
export function lessonExposesReferenceAnswer(lesson: Pick<LessonContent, 'purpose' | 'explanation' | 'terms' | 'example' | 'guidedPractice' | 'challenge'>): boolean {
  const visible = [lesson.purpose, lesson.explanation, ...lesson.terms.flatMap(term => [term.en, term.zh, term.context]), lesson.example.prompt, lesson.example.content, lesson.example.walkthrough, lesson.guidedPractice.prompt, lesson.guidedPractice.expected, lesson.guidedPractice.hint].join('\n').toLocaleLowerCase();
  const answer = lesson.challenge.referenceAnswer.trim().toLocaleLowerCase();
  if (answer.length >= 12 && visible.includes(answer)) return true;
  const tokens = answerTokens(answer);
  if (tokens.size < 12) return false;
  const visibleTokens = answerTokens(visible);
  let shared = 0;
  for (const token of tokens) if (visibleTokens.has(token)) shared++;
  return shared / tokens.size >= 0.9;
}
