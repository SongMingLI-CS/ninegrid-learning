// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AccountGate} from '../src/components/AccountGate';
const api=vi.hoisted(()=>vi.fn());vi.mock('../src/lib/api',()=>({apiFetch:api}));
afterEach(()=>{cleanup();api.mockReset()});
describe('account entry',()=>{
 it('shows actionable failed-login feedback while preserving email and allowing password visibility',async()=>{
  api.mockResolvedValue(new Response(JSON.stringify({error:'INVALID_CREDENTIALS'}),{status:401}));
  const authenticated=vi.fn();render(<AccountGate onAuthenticated={authenticated}/>);
  fireEvent.change(screen.getByLabelText('邮箱地址'),{target:{value:'learner@example.test'}});fireEvent.change(screen.getByLabelText('密码'),{target:{value:'wrong-password'}});
  fireEvent.click(screen.getByRole('button',{name:'显示密码'}));expect((screen.getByLabelText('密码') as HTMLInputElement).type).toBe('text');
  fireEvent.click(screen.getByRole('button',{name:'登录并继续学习'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent','邮箱或密码不正确，请重新输入。');expect((screen.getByLabelText('邮箱地址') as HTMLInputElement).value).toBe('learner@example.test');expect(authenticated).not.toHaveBeenCalled();
 });
 it('checks confirmation before registration and clears passwords on mode changes',async()=>{
  render(<AccountGate onAuthenticated={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'创建账号'}));
  fireEvent.change(screen.getByLabelText('邮箱地址'),{target:{value:'new@example.test'}});fireEvent.change(screen.getByLabelText(/密码至少/),{target:{value:'strong-password-2026'}});fireEvent.change(screen.getByLabelText('确认密码'),{target:{value:'other-password-2026'}});
  fireEvent.click(screen.getByRole('button',{name:'创建账号并开始学习'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent','两次输入的密码不一致，请核对后再试。');expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'返回登录'}));expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe('');
 });
 it('prevents duplicate requests while a login is pending',async()=>{
  let resolve!: (response:Response)=>void;api.mockImplementation(()=>new Promise<Response>(done=>{resolve=done}));const authenticated=vi.fn();render(<AccountGate onAuthenticated={authenticated}/>);
  fireEvent.change(screen.getByLabelText('邮箱地址'),{target:{value:'learner@example.test'}});fireEvent.change(screen.getByLabelText('密码'),{target:{value:'valid-password-2026'}});
  const form=document.querySelector('form')!;fireEvent.submit(form);fireEvent.submit(form);expect(api).toHaveBeenCalledTimes(1);
  resolve(new Response(JSON.stringify({user:{id:'a',email:'learner@example.test'}}),{status:200}));await waitFor(()=>expect(authenticated).toHaveBeenCalledTimes(1));
 });
});
