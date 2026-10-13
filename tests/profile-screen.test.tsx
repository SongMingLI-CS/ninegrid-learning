// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ProfileScreen} from '../src/components/ProfileScreen';
import {COLLECTION_CATALOG} from '../shared/catalog';

const api=vi.hoisted(()=>vi.fn());vi.mock('../src/lib/api',()=>({apiFetch:api}));
const date='2026-10-13T00:00:00Z';
const season=(id:string)=>({id,revision:5,title:`课程 ${id}`,goal:'独立完成可检验作品',desiredArtifact:'作品',status:'active',completed:0,total:24,mainlineCompleted:0,mainlineTotal:15,selfCompleted:0,aiCompleted:0,currentStageIndex:0,nextTaskId:`${id}-saved-task`,nextTaskTitle:'上次学习任务',createdAt:date,updatedAt:date,lastStudyAt:null,stages:[{title:'第一阶段',completed:false}],grid:[],finalProjectEvidence:null});
let data:any;let stock:any[];
function reply(body:any,status=200){return new Response(JSON.stringify(body),{status});}
beforeEach(()=>{
 data={profile:{nickname:'行动者',bio:'',avatar_url:'',joinedAt:date},balance:0,xp:0,currentSeasonId:'a',selectionRevision:3,seasons:[season('a'),season('b')],collection:{kinds:2,total:155,completion:2/155,byRarity:{}},seasonalCollectibles:[],showcased:COLLECTION_CATALOG.slice(0,2).map((item,i)=>({...item,itemId:item.id,quantity:1,showcaseOrder:i})),activity:[],challenges:[]};
 stock=COLLECTION_CATALOG.slice(0,2).map(item=>({item_id:item.id,definition:item,quantity:1,is_locked:false,is_showcased:true,sources:[]}));
 api.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(url==='/api/profile')return reply(data);
  if(url==='/api/inventory')return reply({items:stock});
  if(url.endsWith('/lifecycle')){const body=JSON.parse(String(init?.body));data.seasons[0]={...data.seasons[0],status:body.status,revision:9};return reply({season:{id:'a',revision:9,lifecycleStatus:body.status,state:{}},currentSeasonId:'a',selectionRevision:3});}
  if(url==='/api/inventory/preferences')return reply({saved:2});
  throw Error(url);
 });
});
afterEach(()=>{cleanup();api.mockReset()});
describe('server profile actions',()=>{
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
});
