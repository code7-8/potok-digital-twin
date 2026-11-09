export interface User {id:string;login:string;name:string;role:'analyst'|'viewer'}
export const COOKIE_NAME='potok_session';
export const SESSION_SECONDS=8*60*60;
export const DEMO_PASSWORD='Potok-2026!';
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export async function hashToken(token:string):Promise<string>{return hex(await crypto.subtle.digest('SHA-256',encoder.encode(token)));}
export async function passwordHash(password:string,salt:string):Promise<string>{
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,salt:encoder.encode(salt)},key,256));
}
export function constantTimeEqual(a:string,b:string){let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
export function cookieToken(request:Request):string|null {
  const value=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE_NAME+'='))?.slice(COOKIE_NAME.length+1);
  return value&&/^[a-f0-9]{64}$/.test(value)?value:null;
}
export function newToken():string {return hex(crypto.getRandomValues(new Uint8Array(32)).buffer);}
export function sessionCookie(request:Request,token:string,remove=false):string {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${remove?0:SESSION_SECONDS}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
export async function currentUser(db:D1Database,request:Request):Promise<User|null>{
  const token=cookieToken(request);if(!token)return null;
  return db.prepare('SELECT users.id, users.login, users.name, users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?').bind(await hashToken(token),Date.now()).first<User>();
}
/** Only two explicitly public demo identities. No real staff data or signup. */
export async function seedDemoUsers(db:D1Database):Promise<void>{
  const exists=await db.prepare('SELECT COUNT(*) AS n FROM users').first<{n:number}>();if(exists?.n)return;
  const analystSalt=crypto.randomUUID(),viewerSalt=crypto.randomUUID();
  const [a,v]=await Promise.all([passwordHash(DEMO_PASSWORD,analystSalt),passwordHash(DEMO_PASSWORD,viewerSalt)]);
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO users (id,login,name,password_hash,salt,role) VALUES (?,?,?,?,?,?)').bind('demo-analyst','analyst','Аналитик терминала',a,analystSalt,'analyst'),
    db.prepare('INSERT OR IGNORE INTO users (id,login,name,password_hash,salt,role) VALUES (?,?,?,?,?,?)').bind('demo-viewer','viewer','Наблюдатель',v,viewerSalt,'viewer'),
  ]);
}
