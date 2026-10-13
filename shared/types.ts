export type TaskKind = 'investigate' | 'recall' | 'practice' | 'boss';
export type LearningTrack = 'main' | 'branch';
export interface Objective { id: string; text: string }
export interface Resource { title: string; url: string }
export interface ItemReward { itemId: string; name: string; description: string; rarity: 'common' | 'rare' | 'legendary'; icon: string; quantity: number }
export interface RewardBundle { xp: number; coins: number; items: ItemReward[] }
export interface GridOutcome { id: string; title: string; ability: string; value: string; unlockTaskIds: string[]; artifact?: string }
export interface LessonContent {
  purpose: string; explanation: string; terms: { en: string; zh: string; context: string }[];
  example: { prompt: string; code: string; walkthrough: string };
  guidedPractice: { prompt: string; expected: string; hint: string };
  challenge: { prompt: string; acceptance: string; hints: string[] };
  sourceBasis?: 'none' | 'material' | 'mixed'; sourceNotes?: string[];
  language: 'en' | 'zh' | 'mixed'; generatedAt: string; revision: number;
}
export interface ScheduleItem { taskId: string; kind: 'review' | 'lesson' | 'practice' | 'reflection' | 'video'; minutes: number; required: boolean; deliverable: string; resourceId?: string; resourceTitle?: string; resourceUrl?: string; watched?: boolean }
export interface DailySchedule { date: string; theme: string; items: ScheduleItem[]; totalMinutes: number; outcome: string; nextUnlock: string; revision: number }
export interface RewardEntry { id: string; campaignId: string; taskId: string; at: string; reward: RewardBundle; kind: 'mission' | 'verification' | 'chain' | 'stage' | 'season' | 'review'; idempotencyKey: string }
export interface TaskAttempt { at: string; answer: string; hintLevelsUsed: number; verification: 'self' | 'ai' | 'none'; passed: boolean; score?: number; errorType?: 'concept' | 'operation' | 'hint-dependence' | 'prerequisite' | 'none'; feedback: string }
export interface CampaignSnapshot { campaign: Campaign; progress: Record<string, TaskProgress>; reviews: ReviewCard[]; notes: Record<string, string>; content?: Record<string, LessonContent>; schedules?: Record<string, DailySchedule>; attempts?: Record<string, TaskAttempt[]>; contentHistory?: Record<string, LessonContent[]>; gridOutcomes?: Record<string, { artifact: string; verifiedAt: string; taskIds: string[] }>; dailyAdjustments?: Record<string, 'half' | 'more' | 'skip-known' | 'too-hard'>; knownTasks?: Record<string, boolean>; lastTaskId?: string }
export interface Task {
  id: string; title: string; brief: string; kind: TaskKind; minutes: number; xp: number;
  prerequisites: string[]; objectives: Objective[]; curiosity: string; steps: string[];
  acceptance: string; recallQuestion: string; hint: string; resources: Resource[];
  track?: LearningTrack; chainId?: string; unlockAfter?: string[]; reward?: RewardBundle;
  knowledgePoints?: string[]; knownBasis?: string; deliverable?: string; hints?: string[];
  teaching?: LessonContent;
}
export interface TaskChain { id: string; title: string; track: LearningTrack; taskIds: string[]; completionReward?: RewardBundle }
export interface Stage { id: string; title: string; description: string; tasks: Task[]; chains?: TaskChain[]; mainlineTaskIds?: string[]; reward?: RewardBundle; gateTaskIds?: string[] }
export interface Campaign {
  id: string; title: string; subtitle: string; goal: string; level: string; days: number;
  dailyMinutes: number; ultimateReward: string; createdAt: string;
  source: 'demo' | 'deepseek'; stages: Stage[]; prerequisites?: string[]; nineGrid?: GridOutcome[];
  desiredArtifact?: string; language?: 'en' | 'zh' | 'mixed'; sourceMaterial?: string;
  curriculumRulesVersion?: number; densityRationale?: string;
}
export interface Evaluation {
  passed: boolean; score: number; feedback: string; gaps: string[]; nextStep: string;
}
export interface TaskProgress {
  completedObjectives: string[]; evidence: string; status: 'idle' | 'active' | 'completed';
  supplementalEvidence?: string;
  evaluation?: Evaluation; verification?: 'self' | 'ai'; completedAt?: string;
  selfChecked?: boolean;
  evaluationSource?: 'self' | 'ai';
  evaluationEvidence?: string;
}
export interface ReviewCard {
  taskId: string; dueAt: string; interval: number; ease: number; repetitions: number;
  history: { at: string; rating: number; answer?: string; hintUsed?: boolean }[];
}
export interface LearningState {
  version: 1 | 2; campaign: Campaign; progress: Record<string, TaskProgress>;
  reviews: ReviewCard[]; notes: Record<string, string>;
  content?: Record<string, LessonContent>; schedules?: Record<string, DailySchedule>;
  history?: CampaignSnapshot[]; wallet?: { currency: string; balance: number };
  inventory?: Record<string, { item: ItemReward; quantity: number; acquiredAt: string; sources: string[] }>;
  rewardLedger?: RewardEntry[]; gridOutcomes?: Record<string, { artifact: string; verifiedAt: string; taskIds: string[] }>;
  dailyAdjustments?: Record<string, 'half' | 'more' | 'skip-known' | 'too-hard'>;
  knownTasks?: Record<string, boolean>;
  attempts?: Record<string, TaskAttempt[]>; contentHistory?: Record<string, LessonContent[]>;
  lastTaskId?: string;
}
export interface GoalInput {
  goal: string; level: string; days: number; dailyMinutes: number; ultimateReward: string;
  desiredArtifact?: string; language?: 'en' | 'zh' | 'mixed'; sourceMaterial?: string;
}
