export type TaskKind = 'investigate' | 'recall' | 'practice' | 'boss';
export interface Objective { id: string; text: string }
export interface Resource { title: string; url: string }
export interface Task {
  id: string; title: string; brief: string; kind: TaskKind; minutes: number; xp: number;
  prerequisites: string[]; objectives: Objective[]; curiosity: string; steps: string[];
  acceptance: string; recallQuestion: string; hint: string; resources: Resource[];
}
export interface Stage { id: string; title: string; description: string; tasks: Task[] }
export interface Campaign {
  id: string; title: string; subtitle: string; goal: string; level: string; days: number;
  dailyMinutes: number; ultimateReward: string; createdAt: string;
  source: 'demo' | 'deepseek'; stages: Stage[];
}
export interface Evaluation {
  passed: boolean; score: number; feedback: string; gaps: string[]; nextStep: string;
}
export interface TaskProgress {
  completedObjectives: string[]; evidence: string; status: 'idle' | 'active' | 'completed';
  evaluation?: Evaluation; verification?: 'self' | 'ai'; completedAt?: string;
}
export interface ReviewCard {
  taskId: string; dueAt: string; interval: number; ease: number; repetitions: number;
  history: { at: string; rating: number }[];
}
export interface LearningState {
  version: 1; campaign: Campaign; progress: Record<string, TaskProgress>;
  reviews: ReviewCard[]; notes: Record<string, string>;
}
export interface GoalInput {
  goal: string; level: string; days: number; dailyMinutes: number; ultimateReward: string;
}
