import { BookOpen, CircleAlert, Database, LockKeyhole, RotateCw, Sparkles, Target } from 'lucide-react';
import './RuntimeGate.css';

type ExistingArchive = { title: string; source: 'demo' | 'deepseek'; tasks: number; completed: number };

export function RuntimeGate({
  problem, version, existingArchive, onRetry, onUseLocal, onContinue, onCreateGoal, onPython, onNumpy,
}: {
  problem?: string;
  version: string;
  existingArchive?: ExistingArchive;
  onRetry: () => void;
  onUseLocal: () => void;
  onContinue: () => void;
  onCreateGoal: () => void;
  onPython: () => void;
  onNumpy: () => void;
}) {
  if (problem) return <main className="runtime-gate"><section className="runtime-card runtime-error" role="alert">
    <CircleAlert size={24}/><span className="runtime-kicker">NINEGRID · CONNECTION STATUS</span><h1>服务状态暂不可用</h1>
    <p>无法确认当前服务和账号模式。已有本机档案未被修改；连接恢复前，AI、登录和服务器同步状态都不能确认。</p>
    <div className="runtime-error-detail">{problem}</div>
    <div className="runtime-actions"><button className="runtime-primary" onClick={onRetry}><RotateCw size={16}/>重试连接</button><button className="runtime-secondary" onClick={onUseLocal}>明确使用本机档案</button></div>
    <small>版本 {version} · 只有点击“明确使用本机档案”后才会进入离线模式。</small>
  </section></main>;

  return <main className="runtime-gate"><section className="runtime-card">
    <span className="runtime-kicker">NINEGRID · LOCAL LEARNING</span>
    {existingArchive ? <>
      <span className="runtime-icon"><Database size={21}/></span><h1>发现本机旧课程</h1>
      <p className="runtime-lede">此档案只保存在当前浏览器。选择继续后，原数据会保留在本机，不会转成服务器账号或真实交易记录。</p>
      <div className="runtime-archive"><span>{existingArchive.source === 'demo' ? '预置示例课程 · Python' : '本机课程存档'}</span><strong>{existingArchive.title}</strong><small>{existingArchive.completed} / {existingArchive.tasks} 项已完成</small></div>
      <div className="runtime-actions"><button className="runtime-primary" onClick={onContinue}>继续这份本机档案</button><button className="runtime-secondary" onClick={onCreateGoal}>改为创建我的学习目标</button></div>
    </> : <>
      <span className="runtime-icon"><Target size={21}/></span><h1>先设定你自己的学习目标</h1>
      <p className="runtime-lede">新赛季从你要学会的事开始。预置课程只是可选示例，不会自动写进学习档案。</p>
      <button className="runtime-primary runtime-create" onClick={onCreateGoal}><Target size={17}/>开始创建我的目标</button>
      <div className="runtime-samples"><span>或先看看示例课程</span><div><button onClick={onPython}><BookOpen size={16}/><span><strong>Python 入门</strong><small>情报归档行动 · 示例</small></span></button><button onClick={onNumpy}><Sparkles size={16}/><span><strong>NumPy 数据准备</strong><small>数组与数据分析 · 示例</small></span></button></div></div>
    </>}
    <div className="runtime-account-note"><LockKeyhole size={15}/><span><strong>账号功能需要独立服务器配置</strong><small>仓库、商城、挑战与跨设备个人主页仍会显示入口；本机模式不会模拟余额或账号。</small></span></div>
    <footer>本机模式 · 版本 {version}</footer>
  </section></main>;
}
