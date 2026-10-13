// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOXES, ECONOMY_VERSION, formatHafverCoins, poolExpectedRecovery, poolTotals } from '../shared/economy';
import { ShopScreen } from '../src/components/ShopScreen';

const calls: Array<{url:string;body?:any}> = [];
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status});}
function serve(){
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);const body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({url,body});
    if(url==='/api/shop')return response({version:ECONOMY_VERSION,balance:2000000,boxes:Object.values(BOXES).map(box=>({...box,expectedRecovery:poolExpectedRecovery(box.pool),poolTotal:poolTotals(box.pool)})),operations:[]});
    if(url==='/api/inventory')return response({items:[],transactions:[]});
    if(url==='/api/shop/purchase')return response({purchase:{total:body.quantity*BOXES[body.boxId as keyof typeof BOXES].price},idempotent:false},201);
    throw new Error(`Unexpected request: ${url}`);
  }));
}

describe('independent safe shop page',()=>{
  afterEach(()=>{cleanup();vi.unstubAllGlobals();calls.length=0;});
  it('shows whole-coin expected recovery for fractional probability averages',async()=>{
    serve();render(<ShopScreen account="learner@example.com" onExit={()=>{}} onLogout={()=>{}} onNavigate={()=>{}}/>);
    await screen.findByRole('heading',{name:'保险箱补给'});
    expect(screen.queryByText(/金额超出安全范围/)).toBeNull();
    expect(screen.getAllByText(/按整币取整/)).toHaveLength(2);
  });
  it('shows quantity and total in a review dialog, and cancellation does not submit a purchase',async()=>{
    serve();render(<ShopScreen account="learner@example.com" onExit={()=>{}} onLogout={()=>{}} onNavigate={()=>{}}/>);
    await screen.findByRole('heading',{name:'保险箱补给'});
    fireEvent.change(screen.getByRole('combobox',{name:'购买数量'}),{target:{value:'2'}});
    fireEvent.click(screen.getByRole('button',{name:new RegExp(`购买 ×2 · ${formatHafverCoins(400000)} 币`)}));
    const dialog=await screen.findByRole('dialog',{name:'确认购买 小保险'});
    expect(dialog.textContent).toContain('2 个');expect(dialog.textContent).toContain(`${formatHafverCoins(400000)} 哈弗币`);
    expect(calls.some(call=>call.url==='/api/shop/purchase')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button',{name:'取消'}));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.some(call=>call.url==='/api/shop/purchase')).toBe(false);
  });
  it('submits the confirmed count once and refreshes the server balance',async()=>{
    serve();render(<ShopScreen account="learner@example.com" onExit={()=>{}} onLogout={()=>{}} onNavigate={()=>{}}/>);
    await screen.findByRole('heading',{name:'保险箱补给'});
    fireEvent.click(screen.getByRole('button',{name:new RegExp(`购买 ×1 · ${formatHafverCoins(200000)} 币`)}));
    const dialog=await screen.findByRole('dialog',{name:'确认购买 小保险'});
    fireEvent.click(within(dialog).getByRole('button',{name:'确认扣币并购买'}));
    expect(await screen.findByRole('status')).toBeTruthy();
    const purchases=calls.filter(call=>call.url==='/api/shop/purchase');
    expect(purchases).toHaveLength(1);expect(purchases[0].body.quantity).toBe(1);
    expect(calls.filter(call=>call.url==='/api/shop')).toHaveLength(2);
  });
});
