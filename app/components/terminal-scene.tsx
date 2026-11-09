'use client';
import { useEffect, useRef, useState } from 'react';
import type { SimulationResult } from '../lib/engine/types';
import { orderStateAt } from '../lib/engine/projection';

export interface Poi {id:string;name:string;description:string;stage:string;caseQuestion?:string}
export const POIS:Poi[]=[
  {id:'gate',name:'Регистрация транспорта',description:'Прибытие заявки и занятие ресурса регистрации. Очередь здесь видна отдельно от ожидания налива.',stage:'gate',caseQuestion:'Поможет ли дополнительный регистратор, если основное ожидание возникает перед наливом? Измените только регистрацию и сравните выпуск и очереди.'},
  {id:'lab',name:'Лаборатория качества',description:'Выпуск относится к партии продукта. Один допуск открывает запас для нескольких машин.',stage:'lab',caseQuestion:'Влияет ли второй лабораторный ресурс на ожидание продукта? Сравните допуск партий, очередь продукта и SLA при неизменной мощности налива.'},
  {id:'loading-1',name:'Универсальный пост № 1',description:'Пост принимает оба продукта. При смене продукта учитывается дополнительная подготовка.',stage:'loading',caseQuestion:'Добавьте один пост и проверьте, куда переместилась очередь. Затем задайте двухчасовой сбой: сохраняется ли целевой SLA?'},
  {id:'dispatch',name:'Контроль и оформление',description:'После налива машина проходит завершающую операцию. Только затем её масса входит в выпуск смены.',stage:'dispatch',caseQuestion:'Переместилось ли ограничение на оформление после открытия постов? Проверьте второй ресурс оформления и объясните изменение очередей.'},
];
export function poisFor(result:SimulationResult):Poi[]{
  const tanks=Array.from(new Set(result.batches.map(b=>b.tankId))).map(id=>({id,name:`Резервуар ${id}`,description:`${result.batches.find(b=>b.tankId===id)?.product==='diesel'?'Дизельное топливо':'Бензин'}. Запас доступен после выпуска партии. Остаток и распределённая масса входят в проверку баланса.`,stage:'supply',caseQuestion:'Сравните доступный запас с массой спроса и моментом допуска. Отделите физическую нехватку продукта от ожидания лаборатории.'}));
  const bays=Array.from({length:result.scenario.bayCount},(_,i)=>({...POIS[2],id:`loading-${i+1}`,name:`Пост налива № ${i+1}`,description:(!result.scenario.dedicatedBays||i%3===0?'Универсальный пост.':i%3===1?'Пост для дизельного топлива.':'Пост для бензина.')+' Совместимость, занятость и интервалы сбоя учитываются расчётным ядром.'}));
  return [...POIS.slice(0,2),...tanks,...bays,POIS[3]];
}

export default function TerminalScene({result,time,onSelect,large=false}:{result:SimulationResult;time:number;onSelect:(poi:Poi)=>void;large?:boolean}){
  const host=useRef<HTMLDivElement>(null),latest=useRef({result,time,onSelect});latest.current={result,time,onSelect};
  const [failed,setFailed]=useState(false),[ready,setReady]=useState(false);
  useEffect(()=>{
    let dispose=()=>{},cancelled=false;
    (async()=>{
      const THREE=await import('three');const {OrbitControls}=await import('three/addons/controls/OrbitControls.js');
      if(cancelled||!host.current)return;
      const container=host.current;let renderer:InstanceType<typeof THREE.WebGLRenderer>;
      try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});}catch{setFailed(true);return;}
      renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));renderer.setClearColor(0x0a192d);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
      renderer.outputColorSpace=THREE.SRGBColorSpace;container.appendChild(renderer.domElement);
      const scene=new THREE.Scene();scene.fog=new THREE.Fog(0x0a192d,55,110);
      const camera=new THREE.PerspectiveCamera(38,1,.1,160);camera.position.set(33,31,36);
      const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,0);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.46;controls.minDistance=23;controls.maxDistance=65;controls.enablePan=false;
      scene.add(new THREE.HemisphereLight(0xcde6ff,0x364156,2.2));const sun=new THREE.DirectionalLight(0xddeaff,3.7);sun.position.set(-12,30,15);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-24;sun.shadow.camera.right=24;sun.shadow.camera.top=24;sun.shadow.camera.bottom=-24;scene.add(sun);
      const meshes:InstanceType<typeof THREE.Mesh>[]=[],materials:InstanceType<typeof THREE.Material>[]=[],geometries:InstanceType<typeof THREE.BufferGeometry>[]=[];
      const mat=(color:number,metalness=.2)=>{const m=new THREE.MeshStandardMaterial({color,metalness,roughness:.64});materials.push(m);return m;};
      const groundMat=mat(0x203047),roadMat=mat(0x0d192a),metal=mat(0xc8d3df,.55),white=mat(0xe1e8ee),blue=mat(0x1879cf),cyan=mat(0x32c4c8),dark=mat(0x26384d),amber=mat(0xf1b44c),wheel=mat(0x0b1320);
      const box=(w:number,h:number,d:number,m:InstanceType<typeof THREE.Material>,x:number,y:number,z:number,parent:InstanceType<typeof THREE.Object3D>=scene)=>{const g=new THREE.BoxGeometry(w,h,d);geometries.push(g);const mesh=new THREE.Mesh(g,m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
      const cyl=(r:number,h:number,m:InstanceType<typeof THREE.Material>,x:number,y:number,z:number,parent:InstanceType<typeof THREE.Object3D>=scene)=>{const g=new THREE.CylinderGeometry(r,r,h,36);geometries.push(g);const mesh=new THREE.Mesh(g,m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
      box(40,.4,25,groundMat,0,-.4,0);box(37,.05,4,roadMat,0,-.16,7);box(4,.05,20,roadMat,-13,-.15,-1);
      const grid=new THREE.GridHelper(80,80,0x243b54,0x14263c);grid.position.y=-.63;scene.add(grid);
      for(let x=-17;x<18;x+=3)box(1.2,.02,.08,white,x,-.11,7);
      function tag(mesh:InstanceType<typeof THREE.Mesh>,id:string){mesh.userData.poi=id;meshes.push(mesh);return mesh;}
      function label(text:string,x:number,y:number,z:number){const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const c=canvas.getContext('2d')!;c.fillStyle='#dce9f8';c.font='600 26px Arial';c.textAlign='center';c.fillText(text,128,40);const texture=new THREE.CanvasTexture(canvas);const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false});materials.push(material);const sprite=new THREE.Sprite(material);sprite.position.set(x,y,z);sprite.scale.set(5.6,1.4,1);scene.add(sprite);return texture;}
      const textures:InstanceType<typeof THREE.Texture>[]=[];
      const tankPositions=[[-7,-6],[-1,-6],[5,-6],[11,-6]];
      const tankMeshes:InstanceType<typeof THREE.Mesh>[]=[];
      Array.from(new Set(latest.current.result.batches.map(b=>b.tankId))).slice(0,4).forEach((id,i)=>{const [x,z]=tankPositions[i];cyl(2.55,.22,dark,x,0,z);const t=tag(cyl(2.25,4.4,metal,x,2.3,z),id);tankMeshes.push(t);const product=latest.current.result.batches.find(b=>b.tankId===id)?.product;cyl(2.28,.35,product==='diesel'?blue:cyan,x,3.7,z);cyl(2.3,.15,white,x,4.55,z);box(.15,4.2,.22,dark,x-2.2,2.15,z+.3);textures.push(label(id.slice(0,12),x,5.5,z));box(.2,.2,5,blue,x,.7,z+4.6);});
      box(21,.18,.2,blue,2,.7,-.8);
      const gate=tag(box(3,2.5,2.7,white,-13,1.25,3),'gate');box(3.4,.3,3.1,blue,-13,2.65,3);box(1.6,.7,.05,blue,-13,1.6,4.38);textures.push(label('РЕГИСТРАЦИЯ',-14,4,3));
      tag(box(4,2.8,3.3,white,-13,1.4,-6),'lab');box(4.4,.35,3.7,cyan,-13,3,-6);box(2.5,.8,.05,blue,-13,1.8,-4.33);textures.push(label('КАЧЕСТВО',-13,4.4,-6));
      tag(box(3,2.5,3,white,15,1.25,2.5),'dispatch');box(3.4,.3,3.4,blue,15,2.65,2.5);textures.push(label('ОФОРМЛЕНИЕ',15,4,2.5));
      const bayGroups:InstanceType<typeof THREE.Group>[]=[];const roofMaterials:InstanceType<typeof THREE.MeshStandardMaterial>[]=[];
      for(let i=0;i<6;i++){const group=new THREE.Group();group.position.x=-7+i*3.4;scene.add(group);bayGroups.push(group);const roofMat=mat(0x137ac7);roofMaterials.push(roofMat);tag(box(2.8,.24,4,roofMat,0,3.1,2,group),`loading-${i+1}`);box(.13,3.1,.13,dark,-1.15,1.55,.5,group);box(.13,3.1,.13,dark,1.15,1.55,.5,group);box(.38,1.3,.55,blue,-.7,.65,1,group);box(.12,.12,1.4,cyan,-.7,1.4,1.7,group);textures.push(label(String(i+1),-7+i*3.4,4,2));}
      const trucks:InstanceType<typeof THREE.Group>[]=[];
      for(let i=0;i<120;i++){const truck=new THREE.Group();box(.7,.65,.65,blue,.85,.55,0,truck);box(.08,.28,.5,dark,1.21,.66,0,truck);const tank=cyl(.39,1.55,metal,-.25,.7,0,truck);tank.rotation.z=Math.PI/2;box(2.5,.12,.75,dark,0,.23,0,truck);for(const x of [-.85,.55,.95])for(const z of [-.43,.43]){const tyre=cyl(.18,.12,wheel,x,.18,z,truck);tyre.rotation.x=Math.PI/2;}truck.scale.setScalar(.75);truck.visible=false;scene.add(truck);trucks.push(truck);}
      const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let down:{x:number;y:number}|null=null;
      const pointerDown=(e:PointerEvent)=>{down={x:e.clientX,y:e.clientY};};
      const click=(e:PointerEvent)=>{if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-((e.clientY-rect.top)/rect.height)*2+1);ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects(meshes.filter(m=>m.parent?.visible!==false))[0];if(hit){const id=hit.object.userData.poi;latest.current.onSelect(poisFor(latest.current.result).find(p=>p.id===id)??{id,name:`Пост налива № ${id.split('-')[1]}`,description:'Загрузка и очередь этого ресурса рассчитываются дискретно-событийной моделью.',stage:'loading'});}};
      renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',click);
      const resize=()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};const observer=new ResizeObserver(resize);observer.observe(container);resize();
      let frame=0;
      const render=()=>{
        if(cancelled)return;frame=requestAnimationFrame(render);controls.update();const {result:r,time:t}=latest.current;
        const outage=r.scenario.outage;
        bayGroups.forEach((g,i)=>{g.visible=i<r.scenario.bayCount;roofMaterials[i].color.setHex(outage&&outage.bayIndex===i&&t>=outage.startMin&&t<outage.startMin+outage.durationMin?0xc96d41:0x137ac7);});
        let q=0,dq=0;
        trucks.forEach((truck,i)=>{const o=r.orders[i];if(!o){truck.visible=false;return;}const state=orderStateAt(o,t,r);truck.visible=state!=='not-arrived'&&state!=='completed';if(!truck.visible)return;truck.rotation.y=0;
          if(state==='gate-queue'){truck.position.set(-18+(q%3)*1.8,.1,7+Math.floor(q/3)*.75);q++;}
          else if(state==='gate'){truck.position.set(-13,.1,6.4);}
          else if(state==='waiting'){truck.position.set(-9+(q%8)*2.5,.1,9+Math.floor(q/8)*.65);q++;}
          else if(state==='loading'||state==='paused'){const i=Number(o.load!.resourceId.split('-')[1])-1;truck.position.set(-7+i*3.4,.1,2.5);truck.rotation.y=Math.PI/2;}
          else if(state==='dispatch-queue'){truck.position.set(8-(dq%5)*2.2,.1,6.5+Math.floor(dq/5)*.8);dq++;}
          else truck.position.set(15,.1,6.4);
        });
        renderer.render(scene,camera);
      };render();setReady(true);
      dispose=()=>{cancelAnimationFrame(frame);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',click);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer.dispose();renderer.domElement.remove();};
      void gate;void tankMeshes;
    })().catch(()=>setFailed(true));
    return()=>{cancelled=true;dispose();};
  },[result.datasetId]);
  return <div className={`terminal-scene ${large?'large':''}`}>
    <div className="scene-canvas" ref={host}/>
    {!ready&&!failed&&<div className="scene-loading">Подготовка 3D-сцены…</div>}
    {failed&&<div className="scene-fallback"><strong>Схема участка</strong><p>WebGL недоступен. Точки процесса и показатели доступны ниже.</p><div>{poisFor(result).map(p=><button key={p.id} onClick={()=>onSelect(p)}>{p.name}</button>)}</div></div>}
    <div className="scene-top"><span><i/> МОДЕЛЬ УЧАСТКА</span><span>Условная планировка</span></div>
    <div className="scene-bottom"><span>Перетащите для вращения · нажмите на объект</span><span>{result.orders.length>120||new Set(result.batches.map(b=>b.tankId)).size>4?'Видны до 120 машин и 4 резервуаров; расчёт включает все':'WebGL / 3D'}</span></div>
  </div>;
}
