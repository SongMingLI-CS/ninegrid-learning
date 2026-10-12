import { describe, expect, it } from 'vitest';
import { extractGoalPreferences } from '../src/lib/goalParser';

describe('natural-language goal preference extraction', () => {
  it('extracts duration, daily budget, and language without inventing unstated values', () => {
    expect(extractGoalPreferences('我希望四周后完成。每天一小时，英文为主、中文辅助。')).toEqual({ days: 28, dailyMinutes: 60, language: 'mixed' });
    expect(extractGoalPreferences('Learn in 6 weeks, 30 minutes a day, English first.')).toEqual({ days: 42, dailyMinutes: 30, language: 'en' });
  });
  it('leaves omitted preferences undefined so editable defaults remain visible', () => {
    expect(extractGoalPreferences('I want to learn NumPy indexing and filtering.')).toEqual({});
  });
});
