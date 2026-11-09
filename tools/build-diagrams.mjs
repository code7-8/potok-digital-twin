import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const runtime='C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1105-1297-0_26.1105.1297.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules';
const require=createRequire(runtime+'/package.json');
const sharp=require('sharp');
const {createCanvas,GlobalFonts}=require('@napi-rs/canvas');
GlobalFonts.registerFromPath('C:/Windows/Fonts/arial.ttf','Arial');
const measure=createCanvas(1,1).getContext('2d');
const out=path.resolve('docs/diagrams');await fs.mkdir(out,{recursive:true});
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const C={ink:'#17324F',blue:'#2376C8',pale:'#EDF4FB',line:'#90AAC5',light:'#F7F9FC',green:'#278C75'};
const diagrams=[];
function d(id,title,w=1040,h=680){const o={id,title,w,h,nodes:[],edges:[]};diagrams.push(o);return o;}
function n(g,id,x,y,w,h,text,shape='rect',opts={}){g.nodes.push({id,x,y,w,h,text,shape,...opts});return id;}
function e(g,a,b,label='',opts={}){g.edges.push({a,b,label,...opts});}

let g=d('01-process','Мнемосхема автомобильной отгрузки',1040,540);
n(g,'order',35,170,170,100,'Заявка\nпродукт · масса\nприбытие · срок');
n(g,'gate',255,170,170,100,'Регистрация\nограниченный\nресурс');
n(g,'load',510,170,190,100,'Посты налива\nсовместимость\nрезервирование');
n(g,'docs',770,170,210,100,'Контроль массы\nи оформление\nвыезд');
n(g,'stock',500,355,210,105,'Допущенный запас\nпартии в ёмкостях\nконечная масса');
n(g,'lab',235,355,190,105,'Лаборатория\nодин выпуск\nна партию');
e(g,'order','gate');e(g,'gate','load','очередь');e(g,'load','docs');e(g,'lab','stock','допуск');e(g,'stock','load','продукт',{from:'top',to:'bottom'});
n(g,'note',40,65,940,55,'Каждая очередь и операция оставляет временную отметку в едином журнале','text',{fill:'none',font:21});

g=d('02-bpmn','BPMN 2.0 два взаимодействующих процесса',1040,800);
n(g,'pool',30,65,980,470,'Автомобильная отгрузка','pool');
n(g,'reglane',65,100,945,125,'Регистрация','lane');n(g,'loadlane',65,225,945,185,'Налив','lane');n(g,'doclane',65,410,945,125,'Оформление','lane');
n(g,'start',130,145,36,36,'','start');n(g,'register',210,125,175,80,'Зарегистрировать\nмашину','task');
n(g,'check',440,265,70,70,'','diamond',{marker:true});n(g,'checkLabel',295,240,115,95,'Допуск,\nзапас\nи пост?','text',{font:17});
n(g,'wait',650,340,40,40,'','conditional');n(g,'waitLabel',565,382,220,25,'Дождаться изменения','text',{font:17});
n(g,'loading',775,255,185,90,'Зарезервировать\nпродукт и налить','task');
n(g,'documents',775,435,185,75,'Проверить массу\nоформить выезд','task');n(g,'end',660,455,38,38,'','end');
e(g,'start','register');e(g,'register','check','',{points:[[385,165],[475,165],[475,265]]});
e(g,'check','loading','да',{points:[[510,300],[775,300]]});
e(g,'check','wait','нет',{points:[[475,335],[475,360],[650,360]]});
e(g,'wait','check','',{points:[[670,340],[670,240],[475,240],[475,265]]});
e(g,'loading','documents','',{from:'bottom',to:'top'});e(g,'documents','end','',{points:[[775,474],[698,474]]});
n(g,'labpool',30,580,980,150,'Выпуск партии по качеству','pool');
n(g,'labstart',135,635,36,36,'','start');n(g,'labtask',245,610,195,85,'Проанализировать\nпробу партии','task');n(g,'release',530,610,220,85,'Разрешить отгрузку\nпартии','task');n(g,'labend',860,634,38,38,'','end');
e(g,'labstart','labtask');e(g,'labtask','release');e(g,'release','labend');
n(g,'bpmnote',45,744,950,37,'Условное событие в верхнем процессе реагирует на выпуск партии и освобождение поста','text',{font:17});

g=d('03-use-cases','UML варианты использования',1040,800);
n(g,'system',415,45,580,690,'ПОТОК','pool');
n(g,'viewer',90,195,100,130,'Наблюдатель','actor');n(g,'analyst',90,560,100,130,'Аналитик','actor');
[['login',90,'Войти в систему'],['compute',195,'Настроить и рассчитать'],['compare',300,'Сравнить варианты'],['tour',405,'Изучить 3D и историю'],['import',540,'Импортировать набор'],['save',645,'Сохранить сценарий']].forEach(([id,y,t])=>n(g,id,525,y,350,70,t,'ellipse',{font:19}));
for(const id of ['login','compute','compare','tour'])e(g,'viewer',id,'',{arrow:false});
for(const id of ['import','save'])e(g,'analyst',id,'',{arrow:false});
g.edges.push({points:[[140,560],[140,345]],label:'наследует права',labelX:265,labelY:452,triangle:true});
n(g,'ucnote',55,750,940,35,'Наблюдатель выполняет локальные эксперименты. Сохранение и импорт доступны аналитику.','text',{font:18});

g=d('04-state','UML состояния заявки',1040,790);
n(g,'initial',45,145,26,26,'','initial');n(g,'not',115,115,200,85,'Не прибыла','round');n(g,'gq',395,115,210,85,'Очередь\nрегистрации','round');n(g,'reg',745,115,210,85,'Регистрация','round');
n(g,'wait',735,320,230,85,'Ожидание продукта\nили поста','round');n(g,'load',395,320,210,85,'Налив','round');n(g,'pause',70,320,220,85,'Пауза при сбое','round');
n(g,'dq',395,530,210,85,'Очередь\nоформления','round');n(g,'doc',735,530,230,85,'Контроль\nи оформление','round');n(g,'done',735,680,180,65,'Завершена','round');n(g,'final',970,695,30,30,'','final');
e(g,'initial','not');e(g,'not','gq','прибытие');e(g,'gq','reg','ресурс свободен');e(g,'reg','wait','регистрация завершена',{from:'bottom',to:'top'});e(g,'wait','load','допущено',{from:'left',to:'right'});e(g,'load','pause','сбой',{from:'left',to:'right'});e(g,'pause','load','восстановление',{points:[[180,320],[180,270],[500,270],[500,320]],labelY:258});e(g,'load','dq','налив завершён',{from:'bottom',to:'top'});e(g,'dq','doc','свободен');e(g,'doc','done','оформление завершено',{from:'bottom',to:'top'});e(g,'done','final');

g=d('05-activity','UML действия аналитика',1040,760);
n(g,'initial',495,65,28,28,'','initial');n(g,'input',360,125,300,70,'Выбрать набор данных','round');n(g,'valid',480,235,60,60,'','diamond');n(g,'vlabel',565,245,300,35,'Входы корректны?','text',{font:20});n(g,'fix',60,230,240,80,'Показать ошибки\nи исправить входы','round');
n(g,'base',360,335,300,65,'Рассчитать базовую смену','round');n(g,'alt',360,445,300,65,'Изменить параметры','round');n(g,'compare',360,555,300,65,'Проверить альтернативу','round');n(g,'save',740,555,240,65,'Сохранить решение','round');n(g,'final',840,680,30,30,'','final');
e(g,'initial','input','',{from:'bottom',to:'top'});e(g,'input','valid','',{from:'bottom',to:'top'});e(g,'valid','fix','нет',{from:'left',to:'right'});e(g,'fix','input','',{points:[[180,230],[180,160],[360,160]]});e(g,'valid','base','да',{from:'bottom',to:'top'});e(g,'base','alt','',{from:'bottom',to:'top'});e(g,'alt','compare','',{from:'bottom',to:'top'});e(g,'compare','save','принять');e(g,'compare','alt','уточнить',{points:[[360,587],[300,587],[300,478],[360,478]]});e(g,'save','final','',{from:'bottom',to:'top'});

g=d('06-sequence','UML последовательность сохранения расчёта',1040,700);
const participants=[['ui',25,'Интерфейс'],['api',245,'API'],['auth',465,'Сессия и роль'],['db',685,'SQLite / D1'],['engine',880,'Ядро']];
participants.forEach(([id,x,t])=>{n(g,id,x,75,145,60,t,'rect',{font:18});g.edges.push({points:[[x+72,135],[x+72,640]],dash:true,arrow:false});});
const msg=(y,a,b,label,back=false)=>{const ax=participants.find(p=>p[0]===a)[1]+72,bx=participants.find(p=>p[0]===b)[1]+72;g.edges.push({points:[[ax,y],[bx,y]],label,dash:back,labelY:y-12,font:17});};
msg(185,'ui','api','POST /scenarios');msg(240,'api','auth','Проверить доступ');msg(285,'auth','api','ID и роль',true);msg(340,'api','db','Записать параметры');msg(390,'db','api','ID сценария',true);msg(445,'ui','api','POST /runs + seed');msg(495,'api','engine','Пересчитать');msg(540,'engine','api','Проверенные KPI',true);msg(585,'api','db','Сохранить KPI и версию');msg(635,'api','ui','Подтверждение',true);

g=d('07-er','ER модель постоянного хранения',1040,830);
n(g,'users',35,85,270,175,'USER\nPK id · UK login\nname · role\npassword_hash · salt','table');
n(g,'sessions',370,85,270,175,'SESSION\nPK token_hash\nFK user_id\nexpires_at','table');
n(g,'audit',725,85,280,175,'AUDIT_EVENT\nPK id · FK user_id\naction · entity_id\ncreated_at','table');
n(g,'data',35,455,270,210,'DATASET\nPK id · version\nname · provenance\npayload_json\ncontent_hash · created_at','table');
n(g,'scenario',370,390,300,230,'SCENARIO\nPK id · name\nFK dataset_id\nFK owner_id\nconfig_json · created_at','table');
n(g,'run',735,455,270,210,'RUN\nPK id · FK scenario_id\nengine_version · seed\nsummary_json\ncreated_at','table');
e(g,'users','sessions','1 : N');e(g,'users','audit','1 : N',{points:[[170,85],[170,48],[865,48],[865,85]],labelY:37});e(g,'users','scenario','1 : N',{points:[[170,260],[170,325],[520,325],[520,390]]});e(g,'data','scenario','1 : N');e(g,'scenario','run','1 : N');
n(g,'ernote',50,735,950,55,'JSON сохраняет полный типизированный снимок. Пользовательские записи и связи хранятся в БД','text',{font:20});

g=d('08-architecture','Компоненты и границы доверия',1040,690);
n(g,'ui',50,105,270,120,'React / Vinext\nРабочее место аналитика\nФормы и графики');n(g,'ww',405,105,270,120,'Web Worker\nСерии экспериментов\nПрогресс и отмена');n(g,'core',760,105,240,120,'Чистое ядро\nКалендарь событий\nSeed и инварианты');
n(g,'three',50,340,270,120,'Three.js\nСцена и точки интереса\nВыбранное время');n(g,'api',405,340,270,120,'Серверные маршруты\nСессия и роль\nВалидация входов');n(g,'db',760,340,240,120,'SQLite / D1\nСценарии и расчёты\nЖурнал действий');
e(g,'ui','ww','входы');e(g,'ww','core','расчёт');e(g,'core','three','события',{points:[[880,225],[880,282],[185,282],[185,340]]});e(g,'ui','api','сохранение',{points:[[185,225],[185,262],[540,262],[540,340]]});e(g,'api','db');e(g,'api','core','проверка KPI',{points:[[675,400],[715,400],[715,165],[760,165]]});
n(g,'archnote',65,555,900,70,'Нет интеграций с ERP, MES, 1С и оборудованием.\nКлиентские KPI не считаются доверенными при сохранении расчёта.','text',{font:21});

g=d('09-scene','Архитектура сцены и карта точек интереса',1040,680);
n(g,'canvas',30,70,980,440,'Условная площадка','pool');
n(g,'gate',80,390,180,80,'Регистрация\nPOI gate');n(g,'lab',80,140,180,80,'Лаборатория\nPOI lab');
['T-D1','T-D2','T-G1','T-G2'].forEach((id,i)=>n(g,id,340+i*150,135,120,90,id+'\nРезервуар','ellipse',{font:18}));
n(g,'bays',340,315,520,100,'Посты loading-1 … loading-6\nМашина занимает пост по Visit.start / Visit.end');n(g,'docs',815,430,170,65,'Оформление\nPOI dispatch');
e(g,'gate','bays','маршрут',{points:[[260,430],[300,430],[300,365],[340,365]]});e(g,'bays','docs','',{points:[[860,365],[900,365],[900,430]]});
n(g,'projection',80,555,880,75,'SimulationResult + выбранное время → проекция состояния → геометрия и карточки\nВсе показатели имеют ту же версию набора и seed, что и графики','text',{font:22});

g=d('10-dashboard','Проектный макет дашборда',1040,590);
n(g,'frame',15,25,1010,545,'Проектный макет  /  экран обзора','pool');
n(g,'nav',30,75,165,475,'ПОТОК\n\nОбзор\nСценарии\nИсследование\n3D-тур\nДанные\nИстория','rect',{font:20});
n(g,'header',215,75,790,65,'Участок отгрузки    |    Синтетические данные    |    Рассчитать','rect',{font:21});
['Выпуск, т','SLA, %','Цикл, мин','Расходы, ₽'].forEach((t,i)=>n(g,'kpi'+i,215+i*200,160,190,75,t,'rect',{font:22}));
n(g,'scene',215,255,460,145,'Состояние участка\nОбъекты и точки интереса\nВремя просмотра','rect',{font:23});
n(g,'queues',695,255,310,145,'Причины ожидания\nРегистрация / продукт\nНалив / оформление','rect',{font:21});
n(g,'volume',215,420,460,130,'Накопленный выпуск\nГрафик по событиям','rect',{font:23});
n(g,'resources',695,420,310,130,'Загрузка ресурсов\nЗанято / доступно','rect',{font:22});

function anchor(n,side){if(side==='left')return[n.x,n.y+n.h/2];if(side==='top')return[n.x+n.w/2,n.y];if(side==='bottom')return[n.x+n.w/2,n.y+n.h];return[n.x+n.w,n.y+n.h/2];}
function edgePoints(g,e){if(e.points)return e.points;const a=g.nodes.find(n=>n.id===e.a),b=g.nodes.find(n=>n.id===e.b);let from=e.from??(a.x<b.x?'right':'left'),to=e.to??(a.x<b.x?'left':'right');return[anchor(a,from),anchor(b,to)];}
function textSvg(node){const rows=String(node.text).split('\n');let font=node.font??21;measure.font=`${font}px Arial`;const max=Math.max(...rows.map(s=>measure.measureText(s).width),1);font=Math.min(font,font*(node.w-24)/max);node.font=font;const lines=rows.length;const y=node.y+node.h/2-(lines-1)*font*.65;return rows.map((t,i)=>`<text x="${node.x+node.w/2}" y="${y+i*font*1.3}" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="${font}" fill="${node.color??C.ink}" ${i===0&&node.shape==='table'?'font-weight="700"':''}>${esc(t)}</text>`).join('');}
for(const g of diagrams){
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${g.w}" height="${g.h}" viewBox="0 0 ${g.w} ${g.h}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="${C.blue}" stroke-width="1.5"/></marker><marker id="triangle" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto"><path d="M1 1L11 6L1 11Z" fill="white" stroke="#2376C8" stroke-width="1"/></marker></defs><rect width="100%" height="100%" fill="white"/>`;
  const containers=g.nodes.filter(n=>['pool','lane'].includes(n.shape));
  for(const n of containers){svg+=`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" fill="${n.shape==='lane'?'#FFFFFF':'#F7F9FC'}" stroke="${C.line}" stroke-width="1.3"/><text x="${n.x+12}" y="${n.y+23}" font-family="Arial" font-size="${n.shape==='pool'?19:15}" fill="${C.ink}" font-weight="600">${esc(n.text)}</text>`;}
  for(const edge of g.edges){const pts=edgePoints(g,edge);svg+=`<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${C.blue}" stroke-width="1.8" ${edge.dash?'stroke-dasharray="7 5"':''} ${edge.arrow===false?'':`marker-end="url(#${edge.triangle?"triangle":"arrow"})"`}/>`;if(edge.label){const middle=pts[Math.floor((pts.length-1)/2)],next=pts[Math.min(Math.floor((pts.length-1)/2)+1,pts.length-1)];const x=edge.labelX??(middle[0]+next[0])/2,y=edge.labelY??(middle[1]+next[1])/2-10;svg+=`<text x="${x}" y="${y}" text-anchor="middle" font-family="Arial" font-size="${edge.font??17}" fill="${C.ink}" stroke="white" stroke-width="4" paint-order="stroke">${esc(edge.label)}</text>`;}}
  for(const n of g.nodes.filter(n=>!['pool','lane'].includes(n.shape))){
    const stroke=n.shape==='end'||n.shape==='final'?3:1.7,fill=n.fill??C.pale;
    if(['start','end','initial','final','conditional'].includes(n.shape)){svg+=`<circle cx="${n.x+n.w/2}" cy="${n.y+n.h/2}" r="${n.w/2}" fill="${n.shape==='initial'?C.ink:'white'}" stroke="${C.ink}" stroke-width="${stroke}"/>`;if(n.shape==='final')svg+=`<circle cx="${n.x+n.w/2}" cy="${n.y+n.h/2}" r="${n.w/2-6}" fill="${C.ink}"/>`;if(n.shape==='conditional')svg+=`<circle cx="${n.x+n.w/2}" cy="${n.y+n.h/2}" r="${n.w/2-4}" fill="none" stroke="${C.ink}" stroke-width="1.3"/>`;if(n.shape==='conditional')svg+=`<rect x="${n.x+12}" y="${n.y+9}" width="16" height="22" fill="none" stroke="${C.ink}"/><path d="M${n.x+15} ${n.y+15}h10m-10 5h10m-10 5h10" stroke="${C.ink}"/>`;}
    else if(n.shape==='diamond')svg+=`<polygon points="${n.x+n.w/2},${n.y} ${n.x+n.w},${n.y+n.h/2} ${n.x+n.w/2},${n.y+n.h} ${n.x},${n.y+n.h/2}" fill="#FFF7E6" stroke="${C.ink}" stroke-width="1.7"/><path visibility="${n.marker?'visible':'hidden'}" d="M${n.x+n.w*.37} ${n.y+n.h*.37}L${n.x+n.w*.63} ${n.y+n.h*.63}M${n.x+n.w*.63} ${n.y+n.h*.37}L${n.x+n.w*.37} ${n.y+n.h*.63}" stroke="${C.ink}" stroke-width="2"/>`;
    else if(n.shape==='actor'){const cx=n.x+n.w/2;svg+=`<circle cx="${cx}" cy="${n.y+18}" r="16" fill="white" stroke="${C.ink}" stroke-width="2"/><path d="M${cx} ${n.y+34}v45m-35-25h70m-35 25l-27 34m27-34l27 34" fill="none" stroke="${C.ink}" stroke-width="2"/><text x="${cx}" y="${n.y+135}" text-anchor="middle" font-family="Arial" font-size="19" fill="${C.ink}">${esc(n.text)}</text>`;}
    else {if(n.shape==='ellipse')svg+=`<ellipse cx="${n.x+n.w/2}" cy="${n.y+n.h/2}" rx="${n.w/2}" ry="${n.h/2}" fill="${fill}" stroke="${C.line}" stroke-width="1.7"/>`;else if(n.shape!=='text')svg+=`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${['round','task'].includes(n.shape)?14:3}" fill="${fill}" stroke="${C.line}" stroke-width="1.7"/>`;svg+=textSvg(n);}
  }
  svg+='</svg>';await fs.writeFile(path.join(out,g.id+'.svg'),svg);await sharp(Buffer.from(svg),{density:180}).png().toFile(path.join(out,g.id+'.png'));
  let cells='<mxCell id="0"/><mxCell id="1" parent="0"/>';
  g.nodes.forEach(n=>{let style=`whiteSpace=wrap;html=1;fontFamily=Arial;fontSize=${n.font??20};strokeColor=${C.line};fillColor=${n.fill??C.pale};`;
    if(n.shape==='ellipse'||['start','end','initial','final','conditional'].includes(n.shape))style+='ellipse;';else if(n.shape==='diamond')style+='rhombus;';else if(n.shape==='actor')style+='shape=umlActor;';else if(n.shape==='text')style+='text;strokeColor=none;fillColor=none;';else if(['round','task'].includes(n.shape))style+='rounded=1;';
    cells+=`<mxCell id="${n.id}" value="${esc(n.text).replaceAll('\n','&lt;br&gt;')}" style="${style}" vertex="1" parent="1"><mxGeometry x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" as="geometry"/></mxCell>`;});
  g.edges.forEach((edge,i)=>{const pts=edgePoints(g,edge);cells+=`<mxCell id="edge-${i}" value="${esc(edge.label??'')}" style="edgeStyle=orthogonalEdgeStyle;endArrow=${edge.arrow===false?'none':edge.triangle?'block':'open'};endFill=0;html=1;strokeColor=${C.blue};dashed=${edge.dash?1:0};fontSize=16;" edge="1" parent="1" ${edge.a?`source="${edge.a}" target="${edge.b}"`:''}><mxGeometry relative="1" as="geometry"><mxPoint x="${pts[0][0]}" y="${pts[0][1]}" as="sourcePoint"/><mxPoint x="${pts.at(-1)[0]}" y="${pts.at(-1)[1]}" as="targetPoint"/><Array as="points">${pts.slice(1,-1).map(p=>`<mxPoint x="${p[0]}" y="${p[1]}"/>`).join('')}</Array></mxGeometry></mxCell>`;});
  await fs.writeFile(path.join(out,g.id+'.drawio'),`<mxfile host="app.diagrams.net"><diagram name="${esc(g.title)}"><mxGraphModel pageWidth="${g.w}" pageHeight="${g.h}"><root>${cells}</root></mxGraphModel></diagram></mxfile>`);
}
await fs.writeFile(path.join(out,'diagram-specs.json'),JSON.stringify(diagrams,null,2));
console.log(`Generated ${diagrams.length} diagrams in SVG, PNG and editable draw.io formats.`);
