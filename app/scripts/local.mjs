import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import './sites-env.mjs';

const {values}=parseArgs({options:{prepare:{type:'boolean'},dev:{type:'boolean'},'skip-build':{type:'boolean'},port:{type:'string',default:'5173'}}});
if(Number(process.versions.node.split('.')[0])<24)throw new Error('ПОТОК требует Node.js 24 или новее.');
const port=Number(values.port);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Порт должен быть целым числом от 1024 до 65535.');
if(!existsSync('node_modules/vinext/dist/cli.js')||!existsSync('node_modules/wrangler/bin/wrangler.js'))throw new Error('Сначала установите зависимости в app/: pnpm install --frozen-lockfile');
function run(args){const r=spawnSync(process.execPath,args,{stdio:'inherit',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);}
if(!values.dev&&!values['skip-build'])run(['scripts/run-framework.mjs','build']);
if(!values.dev&&!existsSync('dist/server/wrangler.json'))throw new Error('Сборка отсутствует. Запустите без --skip-build.');
if(!values.dev){
  const built=JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
  const local=JSON.parse(readFileSync('wrangler.local.json','utf8'));
  if(built.d1_databases?.find(d=>d.binding==='DB')?.database_id!==local.d1_databases[0].database_id)throw new Error('Конфигурации сборки и локальной базы не совпадают.');
}
run(['scripts/local-db.mjs']);
if(!values.prepare){
  console.log(`\nПОТОК: http://127.0.0.1:${port}\nВход: analyst или viewer / Potok-2026!\nОстановка: Ctrl+C.\n`);
  if(values.dev)run(['scripts/run-framework.mjs','dev','--port',String(port),'--hostname','127.0.0.1']);
  else run(['--import','./scripts/sites-env.mjs',fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'dev','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/state','--ip','127.0.0.1','--port',String(port),'--inspector-port','0']);
}
