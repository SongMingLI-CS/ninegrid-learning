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
const app=createApp({apiKey:'',auth:{pool,sessionSecret:randomBytes(32).toString('hex'),secureCookie:false,appOrigin}});
const server=app.listen(webPort,'127.0.0.1',()=>console.log(JSON.stringify({apiOrigin,appOrigin,account:'browser-a@example.test',secondAccount:'browser-b@example.test',testPassword,directory:root,externalAI:'not configured'})));
let closing=false;
async function close(){if(closing)return;closing=true;await new Promise<void>(done=>server.close(()=>done()));await pool.end();await execute(join(bin,`pg_ctl${ext}`),['-D',join(root,'cluster'),'-m','fast','-w','stop'],{cwd:root}).catch(()=>processPg.kill());process.exit(0);}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
