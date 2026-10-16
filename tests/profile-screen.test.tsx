// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ProfileScreen} from '../src/components/ProfileScreen';
import {COLLECTION_CATALOG} from '../shared/catalog';

const api=vi.hoisted(()=>vi.fn());vi.mock('../src/lib/api',()=>({apiFetch:api}));
const date='2026-10-13T00:00:00Z';
const originalScrollIntoView=HTMLElement.prototype.scrollIntoView;
const season=(id:string)=>({id,revision:5,title:`课程 ${id}`,goal:'独立完成可检验作品',desiredArtifact:'作品',status:'active',completed:0,total:24,mainlineCompleted:0,mainlineTotal:15,selfCompleted:0,aiCompleted:0,currentStageIndex:0,nextTaskId:`${id}-saved-task`,nextTaskTitle:'上次学习任务',createdAt:date,updatedAt:date,lastStudyAt:null,stages:[{title:'第一阶段',completed:false}],grid:[],finalProjectEvidence:null});
let data:any;let stock:any[];
function reply(body:any,status=200){return new Response(JSON.stringify(body),{status});}
beforeEach(()=>{
 if(!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView=vi.fn();
 data={profile:{nickname:'行动者',bio:'',avatar_url:'',joinedAt:date},balance:0,xp:0,currentSeasonId:'a',selectionRevision:3,seasons:[season('a'),season('b')],collection:{kinds:2,total:155,completion:2/155,byRarity:{}},seasonalCollectibles:[],showcased:COLLECTION_CATALOG.slice(0,2).map((item,i)=>({...item,itemId:item.id,quantity:1,showcaseOrder:i})),activity:[],challenges:[]};
 stock=COLLECTION_CATALOG.slice(0,2).map(item=>({item_id:item.id,definition:item,quantity:1,is_locked:false,is_showcased:true,sources:[]}));
 api.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(url==='/api/profile')return reply(data);
  if(url==='/api/inventory')return reply({items:stock});
  if(url.endsWith('/lifecycle')){const body=JSON.parse(String(init?.body));data.seasons[0]={...data.seasons[0],status:body.status,revision:9};return reply({season:{id:'a',revision:9,lifecycleStatus:body.status,state:{}},currentSeasonId:'a',selectionRevision:3});}
  if(url==='/api/seasons/a')return reply({season:{id:'a',revision:8,lifecycleStatus:'active',state:{campaign:{goal:'Build a timer',desiredArtifact:'Timer tool',ultimateReward:'Timer tool'}}}});
  if(url.endsWith('/goal-preview'))return reply({preview:{previewId:'1234abcd',baseRevision:8,campaignId:'campaign-a',goal:'IELTS goal',desiredArtifact:'IELTS archive',stageChanges:[{stageId:'stage-a',titleBefore:'雅思认知与最小工具骨架',titleAfter:'雅思认知与四科训练',descriptionBefore:'工具骨架',descriptionAfter:'听说读写训练',reason:'阶段名称仍包含工具开发内容'}],tasks:[{taskId:'tool',title:'Build timer',stageId:'stage-a',stageTitle:'第一阶段',action:'replace',originalTaskDisposition:'move-to-optional-branch',reason:'编程偏题',minutes:20,preservesEvidence:true,replacement:{id:'new-task',title:'雅思阅读：主旨与证据定位',brief:'阅读',acceptance:'主旨和证据',deliverable:'阅读证据',minutes:20},dependencyChanges:['阅读证据']}],budget:{mainlineMinutesBefore:60,mainlineMinutesAfter:60,movedToOptionalMinutes:20,dailyMinutesBefore:145,dailyMinutes:80,daysBefore:28,days:60},notice:'旧答案和奖励流水保留。'}});
  if(url.endsWith('/goal-adjustment')){const body=JSON.parse(String(init?.body));data.seasons[0]={...data.seasons[0],goal:body.goal,desiredArtifact:body.desiredArtifact,revision:9};return reply({season:{id:'a',revision:9,lifecycleStatus:'active',state:{campaign:{goal:body.goal,desiredArtifact:body.desiredArtifact}}}});}
  if(url==='/api/inventory/preferences')return reply({saved:2});
  throw Error(url);
 });
});
afterEach(()=>{cleanup();api.mockReset();if(!originalScrollIntoView)delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView});
describe('server profile actions',()=>{
 it('keeps verified capability outcomes before the showcase and historical activity',async()=>{
  const {container}=render(<ProfileScreen account="a@example.test" onExit={()=>{}} onLogout={()=>{}} onNavigate={()=>{}}/>);
  await screen.findByRole('heading',{name:'个人学习档案'});
  await waitFor(()=>expect(container.querySelector('[data-profile-section="identity"]')).toBeTruthy());
  const sections=[...container.querySelectorAll<HTMLElement>('[data-profile-section]')].map(section=>section.dataset.profileSection);
  expect(sections).toEqual(['identity','current-season','capabilities','showcase','season-honors','season-archive','activity','collection','action-record','profile-settings']);
 });

 it('provides the complete account navigation from the profile',async()=>{
  const navigate=vi.fn();render(<ProfileScreen account="a@example.test" onExit={()=>{}} onLogout={()=>{}} onNavigate={navigate}/>);
  await screen.findByRole('heading',{name:'个人学习档案'});
  const nav=screen.getByRole('navigation',{name:'账号功能导航'});
  expect(within(nav).getByRole('button',{name:'个人主页'}).getAttribute('aria-current')).toBe('page');
  expect(within(nav).getAllByRole('button')).toHaveLength(8);
  fireEvent.click(within(nav).getByRole('button',{name:'仓库'}));expect(navigate).toHaveBeenCalledWith('/inventory');
 });
 it('flushes the current answer before sending both lifecycle revisions and updates the application',async()=>{
  const flush=vi.fn(async()=>8),changed=vi.fn(async()=>{});
  render(<ProfileScreen account="a@example.test" onExit={()=>{}} onLogout={()=>{}} onNavigate={()=>{}} onFlushSeason={flush} onLifecycleChanged={changed}/>);
  fireEvent.click((await screen.findAllByRole('button',{name:'暂停'}))[0]);
  await waitFor(()=>expect(changed).toHaveBeenCalled());
  const request=api.mock.calls.find(call=>String(call[0]).endsWith('/lifecycle'))!;
  expect(JSON.parse(String(request[1].body))).toEqual({status:'paused',revision:8,selectionRevision:3});expect(flush).toHaveBeenCalledWith('a');expect(await screen.findByText('赛季已暂停，进度与奖励均保留。')).toBeTruthy();
 });
 it('switches using the callback, refreshes the server pointer, and continues the saved task even with a stale prop',async()=>{
  const select=vi.fn(async(id:string)=>{data={...data,currentSeasonId:id,selectionRevision:4};return true}),resume=vi.fn(async()=>{});
  render(<ProfileScreen account="a@example.test" currentSeasonId="a" onExit={()=>{}} onLogout={()=>{}} onNavigate={()=>{}} onSelectSeason={select} onContinueSeason={resume}/>);
  fireEvent.click(await screen.findByRole('button',{name:'切换赛季'}));
  await waitFor(()=>expect(select).toHaveBeenCalledWith('b'));
  const hero=document.querySelector('.profile-current') as HTMLElement;
  await waitFor(()=>expect(hero.textContent).toContain('课程 b'));
  fireEvent.click(within(hero).getByRole('button',{name:'继续学习'}));expect(resume).toHaveBeenCalledWith('b','b-saved-task');
 });
 it('swaps showcase positions without dropping an existing collection',async()=>{
  render(<ProfileScreen account="a@example.test" onExit={()=>{}} onLogout={()=>{}} onNavigate={()=>{}}/>);
  fireEvent.change(await screen.findByLabelText('设置精选收藏展位 1'),{target:{value:stock[1].item_id}});
  await waitFor(()=>expect(api.mock.calls.some(call=>call[0]==='/api/inventory/preferences')).toBe(true));
  const request=api.mock.calls.find(call=>call[0]==='/api/inventory/preferences')!;
  expect(JSON.parse(String(request[1].body)).items.map((item:any)=>[item.itemId,item.showcased,item.showcaseOrder])).toEqual([[stock[0].item_id,true,1],[stock[1].item_id,true,0]]);
 });
 it('uses an accessible shared select for the avatar preference without saving on selection',async()=>{
  render(<ProfileScreen account="a@example.test" onExit={()=>{}} onLogout={()=>{}} onNavigate={()=>{}}/>);
  const avatar=await screen.findByRole('combobox',{name:'头像样式'});
  fireEvent.click(avatar);
  fireEvent.click(await screen.findByRole('option',{name:'野外行动'}));
  expect(avatar.textContent).toContain('野外行动');
  expect(api.mock.calls.some(call=>String(call[0]).includes('/preferences'))).toBe(false);
 });
 it('requires a visible preview and a separate apply action before changing a season goal',async()=>{
  const flush=vi.fn(async()=>8),adjusted=vi.fn(async()=>{});
  render(<ProfileScreen account="a@example.test" onExit={()=>{}} onLogout={()=>{}} onNavigate={()=>{}} onFlushSeason={flush} onSeasonAdjusted={adjusted}/>);
  fireEvent.click((await screen.findAllByRole('button',{name:'调整目标'}))[0]);
  const dialog=await screen.findByRole('dialog',{name:'调整赛季目标'});
  expect(dialog.querySelectorAll('[data-slot="textarea"]')).toHaveLength(2);
  expect(dialog.querySelectorAll('[data-slot="button"]')).toHaveLength(3);
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.change(screen.getByLabelText('学习目标'),{target:{value:'IELTS goal'}});
  fireEvent.change(screen.getByLabelText('最终成果'),{target:{value:'IELTS archive'}});
  fireEvent.click(screen.getByRole('button',{name:'生成调整预览'}));
  expect(await screen.findByText(/移入可选支线并替换/)).toBeTruthy();
  expect(await screen.findByText('雅思认知与最小工具骨架 → 雅思认知与四科训练')).toBeTruthy();
  expect(await screen.findByText('赛季周期 28 → 60 天')).toBeTruthy();
  expect(await screen.findByText('每日预算 145 → 80 分钟')).toBeTruthy();
  expect(adjusted).not.toHaveBeenCalled();
  const previewRequest=api.mock.calls.find(call=>String(call[0]).endsWith('/goal-preview'))!;
  expect(JSON.parse(String(previewRequest[1].body))).toMatchObject({revision:8,goal:'IELTS goal',desiredArtifact:'IELTS archive'});
  fireEvent.click(screen.getByRole('button',{name:'确认并应用此预览'}));
  await waitFor(()=>expect(adjusted).toHaveBeenCalled());
  expect(api.mock.calls.some(call=>String(call[0]).endsWith('/goal-adjustment'))).toBe(true);
 });
 it('closes the goal editor on Escape and restores focus to its opener',async()=>{
  render(<ProfileScreen account="a@example.test" onExit={()=>{}} onLogout={()=>{}} onNavigate={()=>{}}/>);
  const opener=(await screen.findAllByRole('button',{name:'调整目标'}))[0];
  fireEvent.click(opener);
  const dialog=await screen.findByRole('dialog',{name:'调整赛季目标'});
  fireEvent.keyDown(dialog,{key:'Escape',code:'Escape'});
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'调整赛季目标'})).toBeNull());
  await waitFor(()=>expect(document.activeElement).toBe(opener));
 });
 it('moves a season to the recoverable bin without a permanent delete action',async()=>{
  render(<ProfileScreen account="a@example.test" onExit={()=>{}} onLogout={()=>{}} onNavigate={()=>{}}/>);
  fireEvent.click((await screen.findAllByRole('button',{name:/移入回收站/}))[0]);
  const confirmation=await screen.findByRole('alertdialog',{name:'确认移入回收站'});
  expect(confirmation.textContent).toContain('答案、证据、奖励和藏品都会保留');
  fireEvent.click(within(confirmation).getByRole('button',{name:'确认移入回收站'}));
  await waitFor(()=>expect(api.mock.calls.some(call=>String(call[0]).endsWith('/lifecycle')&&JSON.parse(String(call[1].body)).status==='deleted')).toBe(true));
  expect(await screen.findByText('赛季已移入回收站；答案、证据和奖励记录仍保留。')).toBeTruthy();
  expect(screen.queryByRole('button',{name:/永久删除/})).toBeNull();
 });
 it('allows a completed season to be moved to the recoverable bin',async()=>{
  data.seasons[0]={...data.seasons[0],status:'completed'};
  render(<ProfileScreen account="a@example.test" onExit={()=>{}} onLogout={()=>{}} onNavigate={()=>{}}/>);
  await screen.findByRole('heading',{name:'个人学习档案'});
  const completedCard=document.querySelector('.profile-season-card') as HTMLElement;
  expect(within(completedCard).getByRole('button',{name:'移入回收站'})).toBeTruthy();
 });
});
