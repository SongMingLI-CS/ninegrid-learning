export interface ExtractedGoalPreferences { days?: number; dailyMinutes?: number; language?: 'en' | 'zh' | 'mixed' }

const chineseNumbers: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function parseNumber(value: string): number | undefined {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  if (value === '十') return 10;
  if (value.startsWith('十')) return 10 + (chineseNumbers[value[1]] ?? 0);
  if (value.endsWith('十')) return (chineseNumbers[value[0]] ?? 1) * 10;
  if (value.includes('十')) return (chineseNumbers[value[0]] ?? 1) * 10 + (chineseNumbers[value[2]] ?? 0);
  return chineseNumbers[value];
}

export function extractGoalPreferences(text: string): ExtractedGoalPreferences {
  const result: ExtractedGoalPreferences = {};
  const weeks = text.match(/(\d+|[零一二两三四五六七八九十]+)\s*(?:周|星期|weeks?)/i);
  const days = text.match(/(\d+)\s*(?:天|days?)/i);
  if (weeks) { const value = parseNumber(weeks[1]); if (value && value <= 52) result.days = value * 7; }
  else if (days) { const value = Number(days[1]); if (value > 0 && value <= 365) result.days = value; }

  const chineseHours = text.match(/(?:每天|每日|一天)\s*([零一二两三四五六七八九十\d.]+)\s*(?:个?小时|小时)/);
  const englishHours = text.match(/(?:daily|a day|per day|each day)\s*(?:for\s*)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)(?!\w)/i) ?? text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:a day|per day|daily)/i);
  const chineseMinutes = text.match(/(?:每天|每日|一天)\s*(\d+)\s*(?:分钟|分)/);
  const englishMinutes = text.match(/(?:daily|a day|per day|each day)\s*(?:for\s*)?(\d+)\s*(?:minutes?|mins?)(?!\w)/i) ?? text.match(/(\d+)\s*(?:minutes?|mins?)\s*(?:a day|per day|daily)/i);
  if (chineseHours) { const value = parseNumber(chineseHours[1]); if (value && value <= 24) result.dailyMinutes = Math.round(value * 60); }
  else if (englishHours) { const value = Number(englishHours[1]); if (value > 0 && value <= 24) result.dailyMinutes = Math.round(value * 60); }
  else if (chineseMinutes || englishMinutes) { const value = Number((chineseMinutes ?? englishMinutes)![1]); if (value > 0 && value <= 1440) result.dailyMinutes = value; }

  if (/英文为主|英语为主|english(?:-first| first)|in English/i.test(text) && /中文辅助|中文解释|Chinese support|with Chinese/i.test(text)) result.language = 'mixed';
  else if (/英文为主|英语为主|english(?:-first| first)|in English/i.test(text)) result.language = 'en';
  else if (/中文为主|Chinese(?:-first| first)|in Chinese/i.test(text)) result.language = 'zh';
  return result;
}
