import { useState } from 'react';
import { Fingerprint, LogIn, UserPlus } from 'lucide-react';
import { apiFetch } from '../lib/api';

export interface AccountUser { id: string; email: string; createdAt: string }

export function AccountGate({ onAuthenticated }: { onAuthenticated(user: AccountUser): void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await apiFetch(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error === 'ACCOUNT_EXISTS' ? '该邮箱已注册，请切换到登录。' : payload.error === 'INVALID_CREDENTIALS' ? '邮箱或密码不正确。' : payload.error === 'RATE_LIMITED' ? '尝试次数过多，请稍后重试。' : '账号请求失败，请检查信息后重试。');
      onAuthenticated(payload.user as AccountUser);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '暂时无法连接账号服务。'); }
    finally { setBusy(false); }
  };
  return <main className="account-gate"><form className="account-panel" onSubmit={event => void submit(event)}><span className="account-mark"><Fingerprint size={24}/></span><span className="micro-label">NINEGRID · PRIVATE LEARNING PROFILE</span><h1>{mode === 'login' ? '恢复你的学习赛季' : '建立学习档案'}</h1><p>登录后进入此浏览器中的账号隔离档案。密码经过服务端安全散列，浏览器不保存登录密码。</p><label>邮箱<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)}/></label><label>密码<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)}/><small>至少 12 个字符</small></label>{error&&<p className="account-error" role="alert">{error}</p>}<button className="modal-submit" type="submit" disabled={busy}>{mode === 'login' ? <LogIn size={15}/> : <UserPlus size={15} />}{busy ? '正在验证…' : mode === 'login' ? '登录' : '创建账号'}</button><button className="text-button account-toggle" type="button" onClick={() => { setMode(value => value === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? '第一次使用？创建账号' : '已有账号？返回登录'}</button><small className="account-storage-note">登录后会从服务器恢复名下赛季与个人奖励；首次登录可导入本机旧档，原档案在核对迁移成功前保留。</small></form></main>;
}
