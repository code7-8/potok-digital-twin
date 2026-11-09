import type { Dataset, Scenario } from '../engine/types.ts';
import { BASE_SCENARIO, createDataset } from '../engine/fixtures.ts';
import { simulate, ENGINE_VERSION } from '../engine/simulation.ts';
import { ModelValidationError, validateModel } from '../engine/validation.ts';
import { currentUser, seedDemoUsers, passwordHash, constantTimeEqual, newToken, hashToken, sessionCookie, cookieToken, SESSION_SECONDS } from './auth.ts';

class HttpError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status;}}
const json=(data:unknown,status=200,extra:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const safeParse=(text:string)=>JSON.parse(text);
async function body(request:Request):Promise<Record<string,unknown>>{
  if(!request.headers.get('content-type')?.includes('application/json'))throw new HttpError(415,'Ожидается application/json');
  const max=1_000_000;
  if(Number(request.headers.get('content-length'))>max)throw new HttpError(413,'Файл больше 1 МБ');
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Пустой запрос');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new HttpError(413,'Файл больше 1 МБ');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{const b=JSON.parse(new TextDecoder().decode(bytes));if(!b||typeof b!=='object'||Array.isArray(b))throw new Error();return b;}catch{throw new HttpError(400,'Некорректный JSON');}
}
function verifyOrigin(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new HttpError(403,'Запись с другого сайта запрещена');}
const textField=(value:unknown,name:string,max=100)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new HttpError(400,`${name}: от 1 до ${max} символов`);return value.trim();};
function auditStatement(db:D1Database,userId:string,action:string,entityId:string){return db.prepare('INSERT INTO audit_events (id,user_id,action,entity_id,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),userId,action,entityId,Date.now());}
async function seedDataset(db:D1Database){
  const data=createDataset(),payload=JSON.stringify(data);
  await db.prepare('INSERT OR IGNORE INTO datasets (id,name,version,provenance,payload_json,content_hash,created_at) VALUES (?,?,?,?,?,?,?)').bind(data.id,'Учебный терминал · 84 заявки',data.version,data.provenance,payload,await hashToken(payload),Date.now()).run();
}
export async function handleApi(request:Request,db:D1Database):Promise<Response>{
  try{
    const path=new URL(request.url).pathname.replace(/^\/api\//,'');
    if(!['GET','POST'].includes(request.method))throw new HttpError(405,'Метод не поддерживается');
    if(request.method==='POST')verifyOrigin(request);
    if(path==='health')return json({status:'ok',engineVersion:ENGINE_VERSION});
    if(path==='session'&&request.method==='GET'){
      const user=await currentUser(db,request);
      // A valid session may predate a new version of the bundled demonstration dataset.
      if(user)await seedDataset(db);
      return json({user});
    }
    if(path==='login'&&request.method==='POST'){
      const b=await body(request);const login=textField(b.login,'Логин',64),password=textField(b.password,'Пароль',128);
      await seedDemoUsers(db);
      const record=await db.prepare('SELECT * FROM users WHERE login=?').bind(login).first<{id:string;login:string;name:string;role:string;password_hash:string;salt:string}>();
      const hash=await passwordHash(password,record?.salt??'unknown-user-dummy-salt');
      if(!record||!constantTimeEqual(hash,record.password_hash))throw new HttpError(401,'Неверный логин или пароль');
      const token=newToken();await db.batch([
        db.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Date.now()),
        db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await hashToken(token),record.id,Date.now()+SESSION_SECONDS*1000),
        auditStatement(db,record.id,'login',record.id),
      ]);await seedDataset(db);
      return json({user:{id:record.id,login:record.login,name:record.name,role:record.role}},200,{'Set-Cookie':sessionCookie(request,token)});
    }
    const user=await currentUser(db,request);if(!user)throw new HttpError(401,'Войдите в систему');
    if(path==='logout'&&request.method==='POST'){
      const token=cookieToken(request);if(token)await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hashToken(token)).run();
      return json({ok:true},200,{'Set-Cookie':sessionCookie(request,'',true)});
    }
    if(request.method==='GET'){
      if(path==='datasets'){const r=await db.prepare('SELECT id,name,version,provenance,content_hash,created_at FROM datasets ORDER BY created_at DESC').all();return json(r.results);}
      if(path.startsWith('datasets/')){const r=await db.prepare('SELECT * FROM datasets WHERE id=?').bind(path.slice(9)).first<{payload_json:string;name:string;content_hash:string}>();if(!r)throw new HttpError(404,'Набор данных не найден');return json({data:safeParse(r.payload_json),name:r.name,contentHash:r.content_hash});}
      if(path==='scenarios'){const r=await db.prepare('SELECT * FROM scenarios ORDER BY created_at DESC LIMIT 200').all<{config_json:string}>();return json(r.results.map(x=>({...x,config:safeParse(x.config_json),config_json:undefined})));}
      if(path==='runs'){const r=await db.prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT 100').all<{summary_json:string}>();return json(r.results.map(x=>({...x,summary:safeParse(x.summary_json),summary_json:undefined})));}
      if(path.startsWith('runs/')){
        const row=await db.prepare('SELECT r.*,s.config_json,d.payload_json,d.content_hash FROM runs r JOIN scenarios s ON s.id=r.scenario_id JOIN datasets d ON d.id=s.dataset_id WHERE r.id=?').bind(path.slice(5)).first<{id:string;scenario_id:string;engine_version:string;seed:number;summary_json:string;config_json:string;payload_json:string;content_hash:string;created_at:number}>();
        if(!row)throw new HttpError(404,'Расчёт не найден');
        const summary=safeParse(row.summary_json);
        if(summary.dataHash!==row.content_hash||await hashToken(row.payload_json)!==row.content_hash)throw new HttpError(409,'Исходные данные расчёта изменились. Воспроизведение остановлено.');
        return json({data:safeParse(row.payload_json),scenario:safeParse(row.config_json),run:{id:row.id,scenario_id:row.scenario_id,engine_version:row.engine_version,seed:row.seed,summary,created_at:row.created_at}});
      }
      if(path==='audit'){const r=await db.prepare('SELECT a.id,a.action,a.entity_id,a.created_at,u.name FROM audit_events a JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 100').all();return json(r.results);}
    }
    if(request.method==='POST'){
      if(user.role!=='analyst')throw new HttpError(403,'Наблюдатель может просматривать результаты. Для сохранения нужна роль аналитика.');
      const b=await body(request);
      if(path==='datasets'){
        const data=b.data as Dataset;validateModel(data,BASE_SCENARIO,42);const name=textField(b.name,'Название',120);const id=crypto.randomUUID();const stored={...data,id},payload=JSON.stringify(stored);
        await db.batch([db.prepare('INSERT INTO datasets (id,name,version,provenance,payload_json,content_hash,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,name,stored.version,'synthetic',payload,await hashToken(payload),Date.now()),auditStatement(db,user.id,'dataset-import',id)]);return json({id},201);
      }
      if(path==='calculations'){
        const datasetId=textField(b.datasetId,'Набор данных',64),name=textField(b.name,'Название',120);
        const row=await db.prepare('SELECT payload_json,content_hash FROM datasets WHERE id=?').bind(datasetId).first<{payload_json:string;content_hash:string}>();
        if(!row)throw new HttpError(404,'Набор данных не найден');
        // Calculate before any writes. D1 batch commits the scenario, run and both audit records together.
        const scenarioId=crypto.randomUUID(),id=crypto.randomUUID(),now=Date.now();
        const config={...b.config as Scenario,id:scenarioId,name};
        const run=simulate(safeParse(row.payload_json),config,b.seed as number);
        await db.batch([
          db.prepare('INSERT INTO scenarios (id,dataset_id,owner_id,name,config_json,created_at) VALUES (?,?,?,?,?,?)').bind(scenarioId,datasetId,user.id,name,JSON.stringify(config),now),
          db.prepare('INSERT INTO runs (id,scenario_id,engine_version,seed,summary_json,created_at) VALUES (?,?,?,?,?,?)').bind(id,scenarioId,ENGINE_VERSION,run.seed,JSON.stringify({metrics:run.metrics,dataHash:row.content_hash}),now),
          auditStatement(db,user.id,'scenario-create',scenarioId),auditStatement(db,user.id,'run-save',id),
        ]);
        return json({id,scenarioId,metrics:run.metrics},201);
      }
      if(path==='scenarios'){
        const datasetId=textField(b.datasetId,'Набор данных',64),name=textField(b.name,'Название',120);const row=await db.prepare('SELECT payload_json FROM datasets WHERE id=?').bind(datasetId).first<{payload_json:string}>();if(!row)throw new HttpError(404,'Набор данных не найден');
        const config=b.config as Scenario;validateModel(safeParse(row.payload_json),config,42);const id=crypto.randomUUID();
        await db.batch([db.prepare('INSERT INTO scenarios (id,dataset_id,owner_id,name,config_json,created_at) VALUES (?,?,?,?,?,?)').bind(id,datasetId,user.id,name,JSON.stringify({...config,id,name}),Date.now()),auditStatement(db,user.id,'scenario-create',id)]);return json({id},201);
      }
      if(path==='runs'){
        const scenarioId=textField(b.scenarioId,'Сценарий',64);const row=await db.prepare('SELECT s.config_json,d.payload_json,d.content_hash FROM scenarios s JOIN datasets d ON d.id=s.dataset_id WHERE s.id=?').bind(scenarioId).first<{config_json:string;payload_json:string;content_hash:string}>();if(!row)throw new HttpError(404,'Сценарий не найден');
        const run=simulate(safeParse(row.payload_json),safeParse(row.config_json),b.seed as number);const id=crypto.randomUUID();
        await db.batch([db.prepare('INSERT INTO runs (id,scenario_id,engine_version,seed,summary_json,created_at) VALUES (?,?,?,?,?,?)').bind(id,scenarioId,ENGINE_VERSION,run.seed,JSON.stringify({metrics:run.metrics,dataHash:row.content_hash}),Date.now()),auditStatement(db,user.id,'run-save',id)]);return json({id,metrics:run.metrics},201);
      }
    }
    throw new HttpError(404,'Маршрут не найден');
  }catch(error){
    if(error instanceof HttpError)return json({error:error.message},error.status);
    if(error instanceof ModelValidationError)return json({error:'Проверьте параметры модели',issues:error.issues},400);
    console.error('API failure',error instanceof Error?error.message:'unknown');
    return json({error:'Не удалось выполнить запрос. Проверьте доступность базы данных.'},500);
  }
}
