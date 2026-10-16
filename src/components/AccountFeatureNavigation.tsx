import { Activity, Backpack, BookOpen, CalendarDays, CircleHelp, Target, UserRound, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import './AccountFeatureNavigation.css';

const sections = [
  { path: '/today', label: '今日学习', icon: CalendarDays },
  { path: '/season', label: '赛季总览', icon: BookOpen },
  { path: '/history', label: '学习记录', icon: Activity },
  { path: '/review', label: '复习', icon: CircleHelp },
  { path: '/inventory', label: '仓库', icon: Backpack },
  { path: '/shop', label: '商城', icon: WalletCards },
  { path: '/challenges', label: '挑战', icon: Target },
  { path: '/profile', label: '个人主页', icon: UserRound },
] as const;

export function AccountFeatureNavigation({ currentPath, onNavigate }: { currentPath: string; onNavigate: (path: string) => void }) {
  return <nav className="account-feature-navigation ng-account-nav" aria-label="账号功能导航">
    {sections.map(({ path, label, icon: Icon }) => <Button
      key={path}
      type="button"
      variant="ghost"
      size="default"
      aria-current={currentPath === path ? 'page' : undefined}
      className={currentPath === path ? 'active' : undefined}
      onClick={() => onNavigate(path)}
    ><Icon size={17}/><span>{label}</span></Button>)}
  </nav>;
}
