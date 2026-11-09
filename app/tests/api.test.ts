import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi } from '../lib/server/api.ts';
import { BASE_SCENARIO } from '../lib/engine/fixtures.ts';
import { replaySavedRun,type RunReplay } from '../lib/engine/replay.ts';

function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(`../drizzle/${file}`,import.meta.url),'utf8'));
  const wrap=(sql:string,args:unknown[]=[])=>({bind:(...values:unknown[])=>wrap(sql,values),
    first:async()=>sqlite.prepare(sql).get(...args as never[])??null,
    all:async()=>({results:sqlite.prepare(sql).all(...args as never[])}),
    run:async()=>({success:true,meta:sqlite.prepare(sql).run(...args as never[])})});
  const db={prepare:(sql:string)=>wrap(sql),batch:async(statements:Array<{run:()=>Promise<unknown>}>)=>{sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}} as unknown as D1Database;
  return {db,sqlite};
}
function req(path:string,data?:unknown,cookie?:string,origin?:string){return new Request(`http://localhost:5173/api/${path}`,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:data===undefined?undefined:JSON.stringify(data)});}
async function login(db:D1Database,user='analyst'){const r=await handleApi(req('login',{login:user,password:'Potok-2026!'}),db);assert.equal(r.status,200);return r.headers.get('set-cookie')!.split(';')[0];}

test('unauthorized data access is rejected; session endpoint reveals no credentials',async()=>{
  const {db,sqlite}=database();assert.equal((await handleApi(req('scenarios'),db)).status,401);const r=await handleApi(req('session'),db);assert.deepEqual(await r.json(),{user:null});sqlite.close();
});
test('an existing session gains the current bundled dataset after an upgrade',async()=>{
  const {db,sqlite}=database();const cookie=await login(db);
  sqlite.prepare('DELETE FROM datasets WHERE id=?').run('terminal-synthetic-v1-1');
  const session=await handleApi(req('session',undefined,cookie),db);assert.equal(session.status,200);
  const data=await handleApi(req('datasets/terminal-synthetic-v1-1',undefined,cookie),db);assert.equal(data.status,200);
  assert.equal((await data.json() as {data:{version:string}}).data.version,'1.1.0');sqlite.close();
});
test('password validation, cookie flags, persistence and server-side recomputation',async()=>{
  const {db,sqlite}=database();const bad=await handleApi(req('login',{login:'analyst',password:'wrong'}),db);assert.equal(bad.status,401);
  const auth=await handleApi(req('login',{login:'analyst',password:'Potok-2026!'}),db);const header=auth.headers.get('set-cookie')!;assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Strict/);const cookie=header.split(';')[0];
  const users=sqlite.prepare('SELECT password_hash FROM users').all();assert.ok(users.every(u=>u.password_hash!=='Potok-2026!'));
  const saved=await handleApi(req('scenarios',{datasetId:'terminal-synthetic-v1-1',name:'Test scenario',config:BASE_SCENARIO},cookie),db);assert.equal(saved.status,201);const {id}=await saved.json() as {id:string};
  const run=await handleApi(req('runs',{scenarioId:id,seed:42,metrics:{shippedTonnes:999999999}},cookie),db);assert.equal(run.status,201);const body=await run.json() as {metrics:{shippedTonnes:number}};assert.equal(body.metrics.shippedTonnes,1123);
  const otherSession=await login(db);const list=await handleApi(req('scenarios',undefined,otherSession),db);assert.equal((await list.json() as unknown[]).length,1);const history=await handleApi(req('runs',undefined,otherSession),db);assert.equal((await history.json() as unknown[]).length,1);sqlite.close();
});
test('viewer can read but cannot create scenarios or import datasets',async()=>{
  const {db,sqlite}=database();const cookie=await login(db,'viewer');assert.equal((await handleApi(req('datasets',undefined,cookie),db)).status,200);assert.equal((await handleApi(req('scenarios',{datasetId:'terminal-synthetic-v1-1',name:'bad',config:BASE_SCENARIO},cookie),db)).status,403);sqlite.close();
});
test('logout revokes token on server and expired sessions are rejected',async()=>{
  const {db,sqlite}=database();const cookie=await login(db);assert.equal((await handleApi(req('logout',{},cookie),db)).status,200);assert.equal((await handleApi(req('datasets',undefined,cookie),db)).status,401);const next=await login(db);sqlite.exec('UPDATE sessions SET expires_at=0');assert.equal((await handleApi(req('datasets',undefined,next),db)).status,401);sqlite.close();
});
test('cross-origin mutations and malformed model input are rejected',async()=>{
  const {db,sqlite}=database();const cookie=await login(db);assert.equal((await handleApi(req('scenarios',{},cookie,'https://evil.example'),db)).status,403);const invalid=await handleApi(req('datasets',{name:'invalid',data:{id:'x'}},cookie),db);assert.equal(invalid.status,400);const invalidConfig=await handleApi(req('scenarios',{datasetId:'terminal-synthetic-v1-1',name:'bad',config:{...BASE_SCENARIO,bayCount:999}},cookie),db);assert.equal(invalidConfig.status,400);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM scenarios').get()!.n,0);sqlite.close();
});
test('request size and content type limits reject before parsing',async()=>{
  const {db,sqlite}=database();const huge=new Request('http://localhost:5173/api/login',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'1000001'},body:'{}'});assert.equal((await handleApi(huge,db)).status,413);const form=new Request('http://localhost:5173/api/login',{method:'POST',body:'a=b'});assert.equal((await handleApi(form,db)).status,415);sqlite.close();
});

test('atomic save reopens the exact seed and checks the archived metrics',async()=>{
  const {db,sqlite}=database();const cookie=await login(db);
  const response=await handleApi(req('calculations',{datasetId:'terminal-synthetic-v1-1',name:'Reproducible',config:{...BASE_SCENARIO,bayCount:5},seed:123456,metrics:{shippedTonnes:999999}},cookie),db);
  assert.equal(response.status,201);const saved=await response.json() as {id:string;scenarioId:string;metrics:{shippedTonnes:number}};
  const opened=await handleApi(req(`runs/${saved.id}`,undefined,cookie),db);assert.equal(opened.status,200);
  const record=await opened.json() as RunReplay;const replay=replaySavedRun(record);
  assert.equal(replay.seed,123456);assert.equal(replay.scenario.name,'Reproducible');assert.deepEqual(replay.metrics,record.run.summary.metrics);
  assert.notEqual(replay.metrics.shippedTonnes,999999);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action IN ('scenario-create','run-save')").get()!.n,2);
  assert.throws(()=>replaySavedRun({...record,run:{...record.run,engine_version:'obsolete'}}),/ядром obsolete/);
  const corrupt=structuredClone(record);corrupt.run.summary.metrics.shippedTonnes++;
  assert.throws(()=>replaySavedRun(corrupt),/не совпал/);
  sqlite.close();
});

test('failed audit rolls back the entire calculation; invalid seeds write nothing',async(t)=>{
  const {db,sqlite}=database();const cookie=await login(db);t.mock.method(console,'error',()=>{});
  sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events WHEN NEW.action='run-save' BEGIN SELECT RAISE(ABORT,'test injected audit failure'); END;");
  const input={datasetId:'terminal-synthetic-v1-1',name:'Rollback',config:BASE_SCENARIO,seed:42};
  assert.equal((await handleApi(req('calculations',input,cookie),db)).status,500);
  for(const table of ['scenarios','runs'])assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n,0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='scenario-create'").get()!.n,0);
  sqlite.exec('DROP TRIGGER fail_audit');
  assert.equal((await handleApi(req('calculations',{...input,seed:-1},cookie),db)).status,400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM scenarios').get()!.n,0);
  sqlite.close();
});

test('replay refuses altered source data and observers cannot save calculations',async()=>{
  const {db,sqlite}=database();const cookie=await login(db);
  const input={datasetId:'terminal-synthetic-v1-1',name:'Hash check',config:BASE_SCENARIO,seed:42};
  const saved=await handleApi(req('calculations',input,cookie),db);const {id}=await saved.json() as {id:string};
  const viewer=await login(db,'viewer');assert.equal((await handleApi(req('calculations',input,viewer),db)).status,403);
  assert.equal((await handleApi(req(`runs/${id}`,undefined,viewer),db)).status,200);
  sqlite.exec("UPDATE datasets SET payload_json='{}' WHERE id='terminal-synthetic-v1-1'");
  assert.equal((await handleApi(req(`runs/${id}`,undefined,cookie),db)).status,409);
  assert.equal((await handleApi(req('runs/missing',undefined,cookie),db)).status,404);
  sqlite.close();
});
