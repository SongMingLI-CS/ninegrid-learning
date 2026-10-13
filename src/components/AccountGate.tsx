import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronRight, Eye, EyeOff, Fingerprint, Layers3, LoaderCircle, LockKeyhole, Mail, ShieldCheck, Target } from 'lucide-react';
import { apiFetch } from '../lib/api';
import './AccountGate.css';

export interface AccountUser { id: string; email: string; createdAt: string }

export function AccountGate({ onAuthenticated }: { onAuthenticated(user: AccountUser): void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const changeMode = (next: 'login' | 'register') => {
    if (busy) return;
    setMode(next); setError(''); setPassword(''); setConfirmation(''); setShowPassword(false); setCapsLock(false);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (request.current || busy) return;
    if (mode === 'register' && password !== confirmation) { setError('两次输入的密码不一致，请核对后再试。'); return; }
    setBusy(true); setError('');
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await apiFetch(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error === 'ACCOUNT_EXISTS' ? '该邮箱已注册，请切换到登录。' : payload.error === 'INVALID_CREDENTIALS' ? '邮箱或密码不正确，请重新输入。' : response.status === 429 ? '尝试次数过多，请稍后重试。' : response.status >= 500 ? '账号服务暂时不可用，请稍后重试。' : '登录未完成，请检查邮箱与密码后重试。');
      if (controller.signal.aborted) return;
      onAuthenticated(payload.user as AccountUser);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof TypeError ? '暂时无法连接账号服务，请检查网络后重试。' : reason instanceof Error ? reason.message : '暂时无法连接账号服务。'); }
    finally { if (!controller.signal.aborted) setBusy(false); if (request.current === controller) request.current = null; }
  };
  return <main className="account-gate account-entry">
    <header className="account-header"><a className="account-logo" href="/" aria-label="九格行动首页"><span className="account-logo-grid" aria-hidden="true">{Array.from({length:9},(_,i)=><i key={i}/>)}</span><span><strong>NINEGRID</strong><small>九格行动</small></span></a><span className="account-header-label">LEARNING, IN ACTION.</span></header>
    <div className="account-layout">
      <section className="account-story" aria-labelledby="account-story-title">
        <div className="account-field-map" aria-hidden="true"><span>FIELD / 07</span><span>35°41′N&nbsp; 139°41′E</span><svg viewBox="0 0 520 220" preserveAspectRatio="none"><path d="M-10 180 93 143 168 165 254 102 322 126 400 57 535 78"/><path d="M-10 203 95 165 172 187 255 124 325 148 402 79 535 100"/><circle cx="254" cy="102" r="24"/><circle cx="254" cy="102" r="43"/><circle cx="400" cy="57" r="7"/></svg></div>
        <span className="account-eyebrow"><span/>YOUR NEXT OPERATION</span>
        <h1 id="account-story-title">把想学的，<br/>变成<span>真正会的。</span></h1>
        <p className="account-story-copy">从一个明确目标出发。沿着主线深入，在支线中探索，<br className="account-desktop-break"/>用独立完成的作品，留下属于你的能力成果。</p>
        <div className="account-route-preview" aria-label="学习路线功能预览">
          <div className="account-preview-head"><span><Layers3 size={14}/>学习路线预览</span><span>SEASON / 01</span></div>
          {[{icon:Target,title:'确定目标',text:'把学习需求编排成可执行的阶段'},{icon:BookOpen,title:'完成任务',text:'讲解、练习与独立挑战循序推进'},{icon:ShieldCheck,title:'验证成果',text:'保存真实作品，积累九格能力'}].map(({icon:Icon,title,text},i)=><div className="account-preview-row" key={title}><span className="account-preview-node"><Icon size={18}/></span><div><strong>{title}</strong><small>{text}</small></div><span className="account-preview-index">0{i+1}</span></div>)}
          <div className="account-preview-footer"><span><Check size={13}/>进度随账号保存</span><ChevronRight size={14}/></div>
        </div>
        <div className="account-story-foot"><span>清晰任务</span><i/><span>主动练习</span><i/><span>长期成果</span></div>
      </section>
      <section className="account-card" aria-labelledby="account-form-title">
        <div className="account-card-status"><span><i/>个人档案入口</span><small>SECURE ACCESS</small></div><div className="account-switch" aria-label="账号入口"><button type="button" aria-pressed={mode==='login'} className={mode==='login'?'selected':''} disabled={busy} onClick={()=>changeMode('login')}>登录</button><button type="button" aria-pressed={mode==='register'} className={mode==='register'?'selected':''} disabled={busy} onClick={()=>changeMode('register')}>创建账号</button></div>
        <div className="account-card-heading"><span className="account-fingerprint"><Fingerprint size={24}/></span><h2 id="account-form-title">{mode==='login'?'欢迎回来':'开启你的学习行动'}</h2><p>{mode==='login'?'登录后，继续上次任务与学习赛季。':'创建个人档案，让每一次进步都有记录。'}</p></div>
        <form className="account-form" onSubmit={event=>void submit(event)} aria-busy={busy}>
          <label htmlFor="account-email">邮箱地址</label><div className="account-input-wrap"><Mail size={17}/><input id="account-email" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" required maxLength={254} disabled={busy} value={email} onChange={event=>setEmail(event.target.value)} aria-describedby={error?'account-form-error':undefined}/></div>
          <label htmlFor="account-password">密码{mode==='register'&&<small>至少 12 个字符</small>}</label><div className="account-input-wrap"><LockKeyhole size={17}/><input id="account-password" type={showPassword?'text':'password'} autoComplete={mode==='login'?'current-password':'new-password'} placeholder={mode==='login'?'输入你的密码':'设置一个安全的密码'} required minLength={mode==='register'?12:1} maxLength={128} disabled={busy} value={password} onChange={event=>setPassword(event.target.value)} onKeyUp={event=>setCapsLock(event.getModifierState('CapsLock'))} onBlur={()=>setCapsLock(false)} aria-describedby={error?'account-form-error':undefined}/><button type="button" className="account-password-toggle" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?'隐藏密码':'显示密码'} aria-pressed={showPassword} disabled={busy}>{showPassword?<EyeOff size={17}/>:<Eye size={17}/>}</button></div>
          {capsLock&&<small className="account-caps">大写锁定已开启，请注意密码大小写。</small>}
          {mode==='register'&&<><label htmlFor="account-confirmation">确认密码</label><div className="account-input-wrap"><LockKeyhole size={17}/><input id="account-confirmation" type={showPassword?'text':'password'} autoComplete="new-password" placeholder="再次输入密码" required minLength={12} maxLength={128} disabled={busy} value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></div><div className="account-password-guide"><ShieldCheck size={13}/><span>建议组合字母、数字和符号，避免重复使用其他账号的密码。</span></div></>}
          {error&&<div id="account-form-error" className="account-error" role="alert">{error}</div>}
          <button className="account-submit" type="submit" disabled={busy}>{busy?<><LoaderCircle size={17} className="account-spinner"/>正在验证…</>:<>{mode==='login'?'登录并继续学习':'创建账号并开始学习'}<ArrowRight size={17}/></>}</button>
        </form>
        <p className="account-register-link">{mode==='login'?'还没有账号？':'已经有账号？'}<button type="button" disabled={busy} onClick={()=>changeMode(mode==='login'?'register':'login')}>{mode==='login'?'立即创建':'返回登录'}<ArrowRight size={13}/></button></p>
        <div className="account-card-divider"/><p className="account-private-note"><ShieldCheck size={15}/><span>赛季、答案与收藏仅本人可见。<br/>登录后可在不同设备继续学习。</span></p>
      </section>
    </div>
    <footer className="account-footer"><span>© {new Date().getFullYear()} NINEGRID · 九格行动</span><span><LockKeyhole size={12}/>你的学习档案，属于你。</span></footer>
  </main>;
}
