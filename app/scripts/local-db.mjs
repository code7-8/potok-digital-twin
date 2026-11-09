import './sites-env.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const {values}=parseArgs({options:{'persist-to':{type:'string',default:'.wrangler/state'},'check-only':{type:'boolean',default:false}}});
const state=resolve(values['persist-to']);
const cli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const common=['--local','--config','wrangler.local.json','--persist-to',state];
function wrangler(args,json=false){
  const r=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs',cli,...args,...common,...(json?['--json']:[])],{encoding:'utf8',input:'y\n',timeout:60000,windowsHide:true,maxBuffer:5_000_000});
  if(r.error)throw r.error;
  if(r.status!==0)throw new Error(r.stderr||r.stdout||`Wrangler failed: ${r.status}`);
  if(json)return JSON.parse(r.stdout);
  process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);
}
const query=sql=>wrangler(['d1','execute','DB','--command',sql],true).flatMap(r=>r.results??[]);
const schemaSql="SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name";
const catalog=query(schemaSql);
const files=readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort();
if(!files.length)throw new Error('No SQL migrations found in drizzle/.');
const hasLedger=catalog.some(r=>r.name==='d1_migrations');
const initial=files[0];
const expected=new DatabaseSync(':memory:');
expected.exec(readFileSync(`drizzle/${initial}`,'utf8'));
const initialSchema=expected.prepare(schemaSql).all();expected.close();
const initialNames=new Set(initialSchema.map(r=>r.name));
const existing=catalog.filter(r=>initialNames.has(r.name));
if(!hasLedger&&existing.length){
  // Only adopt the precisely matching historical schema. Never run CREATE blindly or reset data.
  const normalize=s=>s.replace(/\s+/g,' ').trim();
  if(existing.length!==initialSchema.length||initialSchema.some(e=>!existing.some(a=>a.name===e.name&&a.type===e.type&&normalize(a.sql)===normalize(e.sql)))){
    throw new Error('Existing local database differs from the initial schema. Nothing was changed. Back up the database and inspect the schema before migration.');
  }
  if(values['check-only'])console.log('Existing initial schema matches. Migration tracking can be adopted safely.');
  else{
    const name=initial.replaceAll("'","''");
    query(`CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL); INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${name}');`);
    console.log(`Adopted existing schema: ${initial}. Existing records were preserved.`);
  }
}
if(values['check-only']){
  console.log(`Local database checked: ${state}`);
}else{
  wrangler(['d1','migrations','apply','DB']);
  const fk=query('PRAGMA foreign_key_check;');
  if(fk.length)throw new Error('Local database contains broken foreign keys. Inspect before starting.');
  console.log(`Local database ready: ${state}`);
}
