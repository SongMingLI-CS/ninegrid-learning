// Isolated native PostgreSQL fixture for browser verification. Never reads DATABASE_URL.
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import argon2 from 'argon2';
import { createApp } from '../server/app';
import { runMigrations } from '../server/db';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';
import { DEMO_CAMPAIGN } from '../src/lib/demo';
import { createProgressForCampaign } from '../src/lib/engine';
import { COLLECTION_CATALOG } from '../shared/catalog';

const root=await mkdtemp(join(tmpdir(),'ninegrid-browser-'));
const platform=process.platform==='win32'?'windows':process.platform;
const require=createRequire(import.meta.url);
const native=resolve(dirname(require.resolve(`@embedded-postgres/${platform}-${process.arch}`)),'..','native');
await cp(native,join(root,'runtime'),{recursive:true,dereference:true});
const bin=join(root,'runtime','bin'),ext=process.platform==='win32'?'.exe':'';
const execute=promisify(execFile),dbPassword=randomBytes(24).toString('hex');
async function freePort(){const probe=createServer();await new Promise<void>(done=>probe.listen(0,'127.0.0.1',done));const port=(probe.address() as {port:number}).port;await new Promise<void>(done=>probe.close(()=>done()));return port;}
const pgPort=await freePort(),webPort=Number(process.env.NINEGRID_BROWSER_PORT)||await freePort();
const testBalance=Number(process.env.NINEGRID_BROWSER_SEED_BALANCE??0);
const aiBudget=Number(process.env.NINEGRID_BROWSER_AI_BUDGET??10);
if(!Number.isSafeInteger(testBalance)||testBalance<0||testBalance>10_000_000)throw new Error('NINEGRID_BROWSER_SEED_BALANCE must be an isolated test balance from 0 to 10000000');
if(!Number.isSafeInteger(aiBudget)||aiBudget<1||aiBudget>14)throw new Error('NINEGRID_BROWSER_AI_BUDGET must be between 1 and 14');
const secretFile=join(root,'test-password');await writeFile(secretFile,dbPassword,{mode:0o600});
try{await execute(join(bin,`initdb${ext}`),['-D',join(root,'cluster'),'-U','postgres','--auth=scram-sha-256','--pwfile',secretFile,'--encoding=UTF8','--locale=C'],{cwd:root});}finally{await unlink(secretFile);}
const processPg=spawn(join(bin,`postgres${ext}`),['-D',join(root,'cluster'),'-p',String(pgPort),'-c','listen_addresses=127.0.0.1','-c','shared_buffers=32MB'],{cwd:root,windowsHide:true,stdio:'ignore'});
const pool=new Pool({connectionString:`postgresql://postgres:${dbPassword}@127.0.0.1:${pgPort}/postgres`,max:6});
pool.on('error',error=>console.error('Fixture database error:',error.message));
for(let i=0;i<100;i++){try{await pool.query('SELECT 1');break;}catch{if(i===99)throw Error('Fixture PostgreSQL failed to start');await new Promise(done=>setTimeout(done,100));}}
await runMigrations(pool);
const testPassword='browser-test-only-2026';
const hash=await argon2.hash(testPassword);
for(const [index,email] of ['browser-a@example.test','browser-b@example.test'].entries()){
  const userId=randomUUID();await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[userId,email,hash]);
  if(index===1)continue;
  if(testBalance>0)await pool.query("INSERT INTO wallets(user_id,currency,balance) VALUES($1,'learning-coin',$2)",[userId,testBalance]);
  let firstId='';
  for(const [number,template] of [NUMPY_DEMO_CAMPAIGN,DEMO_CAMPAIGN].entries()){
    const campaign=structuredClone(template);campaign.id=`browser-domain-${number}`;
    const state={version:2,campaign,progress:createProgressForCampaign(campaign),reviews:[],notes:{},wallet:{currency:'learning-coin',balance:0},inventory:{},rewardLedger:[],gridOutcomes:{}};
    const id=randomUUID();await pool.query('INSERT INTO seasons(id,owner_user_id,campaign_id,title,state) VALUES($1,$2,$3,$4,$5)',[id,userId,campaign.id,campaign.title,JSON.stringify(state)]);if(number===0)firstId=id;
  }
  await pool.query('INSERT INTO user_current_seasons(user_id,season_id) VALUES($1,$2)',[userId,firstId]);
  for(const item of COLLECTION_CATALOG.slice(0,5))await pool.query('INSERT INTO inventory_items(user_id,item_id,definition,quantity) VALUES($1,$2,$3,1)',[userId,item.id,JSON.stringify(item)]);
}
process.env.NODE_ENV='production';process.env.UPLOAD_DIR=join(root,'uploads');
const apiOrigin=`http://127.0.0.1:${webPort}`,appOrigin=process.env.NINEGRID_BROWSER_APP_ORIGIN??apiOrigin;
const apiKey=process.env.DEEPSEEK_API_KEY?.trim()??'';
let aiCalls=0;
const budgetedFetch:typeof fetch=async(input,init)=>{
  const url=input instanceof Request?input.url:String(input);
  if(new URL(url).hostname==='api.deepseek.com'){
    if(aiCalls>=aiBudget)throw new Error('Isolated browser fixture AI call budget exhausted');
    aiCalls++;console.log(`DeepSeek request ${aiCalls}/${aiBudget}`);
    const response=await fetch(input,init);
    if(process.env.NINEGRID_CAPTURE_AI_OUTPUT==='1'){
      const envelope=await response.clone().json().catch(()=>undefined) as {error?:{type?:string;code?:string;message?:string};choices?:Array<{finish_reason?:string;message?:{content?:unknown}}>}|undefined;
      const choice=envelope?.choices?.[0],content=choice?.message?.content;
      const capture=typeof content==='string'?content:JSON.stringify(content??null);
      await writeFile(join(root,`deepseek-output-${String(aiCalls).padStart(2,'0')}.txt`),capture,{mode:0o600});
      const errorMessage=(envelope?.error?.message??'').replaceAll(apiKey,'[redacted]').slice(0,400);
      console.log(`DeepSeek response ${aiCalls}: HTTP ${response.status}, finish=${choice?.finish_reason??'unknown'}, chars=${capture.length}${envelope?.error?`, type=${envelope.error.type??'unknown'}, code=${envelope.error.code??'unknown'}, message=${errorMessage}`:''}`);
    }
    return response;
  }
  return fetch(input,init);
};
const app=createApp({apiKey,...(apiKey?{fetchImpl:budgetedFetch}:{}),auth:{pool,sessionSecret:randomBytes(32).toString('hex'),secureCookie:false,appOrigin}});
const server=app.listen(webPort,'127.0.0.1',()=>console.log(JSON.stringify({apiOrigin,appOrigin,account:'browser-a@example.test',secondAccount:'browser-b@example.test',testPassword,directory:root,externalAI:Boolean(apiKey),testOnlySeedBalance:testBalance,aiCallBudget:aiBudget})));
let closing=false;
async function close(){if(closing)return;closing=true;await new Promise<void>(done=>server.close(()=>done()));await pool.end();await execute(join(bin,`pg_ctl${ext}`),['-D',join(root,'cluster'),'-m','fast','-w','stop'],{cwd:root}).catch(()=>processPg.kill());process.exit(0);}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
