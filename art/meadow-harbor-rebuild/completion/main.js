import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {config} from './config.js';
import {makeGroundSampler,addOcean,extendLandscape} from './terrain.js';
import {addVegetation} from './vegetation.js';
import {batchStaticModel} from './optimize.js';
import {weatherBuildingMaterial} from './materials.js';
import {projectedBounds} from './reference-measure.js';
import {addGroundDetails} from './ground-details.js';
import {addVillageActivity} from './activity.js';
import {addMaritime} from './maritime.js';
import {addVillagers} from './villagers.js';
import {addUbcVillagers} from './villagers-ubc.js';
import {loadSurfaceTextures,detailGround,groundCover} from './surface-materials.js';
import {addSky,addHinterland} from './atmosphere.js';
import {addSurroundings} from './surroundings.js';
import {contactLighting} from './contact-light.js';
import {shareTextureSources} from './texture-sharing.js';

THREE.Cache.enabled=true;

const params=new URLSearchParams(location.search);
const still=params.has('still');let renderNeeded=true;
function invalidate(){renderNeeded=true;}
if(params.has('clean'))document.body.classList.add('clean');
const scene=new THREE.Scene();scene.background=new THREE.Color('#b5d3df');scene.fog=new THREE.FogExp2('#b5d3df',config.fogDensity);
const camera=new THREE.PerspectiveCamera(config.camera.fov,innerWidth/innerHeight,.15,10000);
// Authoring rays always use the supplied image's camera, independent of viewport.
const referenceAspect=1672/941,referenceCamera=new THREE.PerspectiveCamera(config.camera.fov,referenceAspect,.15,10000);
referenceCamera.position.fromArray(config.camera.position);referenceCamera.lookAt(new THREE.Vector3().fromArray(config.camera.target));referenceCamera.updateMatrixWorld(true);
const contactOn=params.get('ao')!=='0';
const renderer=new THREE.WebGLRenderer({antialias:!contactOn,powerPreference:'high-performance',preserveDrawingBuffer:!contactOn});
renderer.setPixelRatio(Math.min(devicePixelRatio,contactOn?1:1.5));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=config.exposure;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','Explorable Meadow Harbor village');document.body.prepend(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=3;controls.maxDistance=240;controls.maxPolarAngle=Math.PI*.48;
let referenceView=true;
function reset(){referenceView=true;controls.target.fromArray(config.camera.target);camera.position.fromArray(config.camera.position).sub(controls.target).multiplyScalar(Math.max(1,referenceAspect/camera.aspect)).add(controls.target);camera.fov=+(params.get('fov')||config.camera.fov);camera.updateProjectionMatrix();controls.update();}
controls.addEventListener('start',()=>{referenceView=false;});
controls.addEventListener('change',invalidate);
reset();
scene.add(new THREE.HemisphereLight(config.ambient.sky,config.ambient.ground,config.ambient.intensity));
const sun=new THREE.DirectionalLight(config.sun.color,config.sun.intensity);sun.position.fromArray(config.sun.position);sun.castShadow=true;
sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-62,right:62,top:62,bottom:-62,near:1,far:170});sun.shadow.normalBias=.065;sun.shadow.bias=-.0001;sun.shadow.radius=2;
sun.target.position.set(-5,0,0);scene.add(sun,sun.target);
const loader=new GLTFLoader(),clock=new THREE.Clock(),anchors=[],timings=[];
const loadGLTF=loader.loadAsync.bind(loader);
loader.loadAsync=async(...args)=>shareTextureSources(await loadGLTF(...args));
window.__village={ready:false,revision:config.revision,errors:[],anchors:[],metrics:{},measurements:{}};
if(import.meta.env.DEV)window.__village.captureFrame=name=>new Promise(resolve=>{
  const capture=()=>{invalidate();renderFrame();renderer.domElement.toBlob(async blob=>{const response=await fetch(`/__capture?name=${encodeURIComponent(name)}`,{method:'POST',body:blob});resolve(await response.text());},'image/png');};
  if(document.hidden)setTimeout(capture,0);else requestAnimationFrame(capture);
});
renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{const message=[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n');window.__village.errors.push(message.slice(0,2000));console.error(message);};
const ocean=addOcean(scene);
ocean.setSun(sun.position.clone().sub(sun.target.position));
addSky(scene);
const contact=contactOn?contactLighting(renderer,scene,camera,params.get('ao')==='full'?{scale:.65,samples:12,pdSamples:12}:undefined):null;
if(import.meta.env.DEV)window.__village.setContact=settings=>{contact?.study(settings);invalidate();};
if(import.meta.env.DEV)window.__village.setShadowStudy=({bias,normalBias})=>{if(bias!==undefined)sun.shadow.bias=bias;if(normalBias!==undefined)sun.shadow.normalBias=normalBias;renderer.shadowMap.needsUpdate=true;ocean.setSun(sun.position.clone().sub(sun.target.position));invalidate();};
renderer.info.autoReset=false;
if(import.meta.env.DEV)window.__village.debug={scene,renderer,camera,ocean,contact,sun,invalidate};
let sample,vegetation,activity,maritime,residents,free=false;const keys=new Set();
function setFree(value){
  invalidate();
  free=value;controls.enabled=!free;
  if(free){referenceView=false;const direction=new THREE.Vector3();camera.getWorldDirection(direction);controls.target.copy(camera.position).addScaledVector(direction,5);}
  document.querySelector('#travel').setAttribute('aria-pressed',String(free));
  document.querySelector('#hint').textContent=free?'Drag to look / WASD move / Q/E rise / Shift faster':'Drag to explore / Scroll to approach';
  window.__village.freeCamera=free;
}
document.querySelector('#reset').onclick=()=>{setFree(false);reset();};
document.querySelector('#travel').onclick=()=>setFree(!free);
document.querySelector('#life').onclick=()=>residents?.togglePause?.();
let looking=false,lastPointer=[0,0];
renderer.domElement.addEventListener('pointerdown',e=>{if(!free||e.button!==0)return;looking=true;lastPointer=[e.clientX,e.clientY];renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointermove',e=>{if(!free||!looking)return;const rotation=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');rotation.y-=(e.clientX-lastPointer[0])*.003;rotation.x=THREE.MathUtils.clamp(rotation.x-(e.clientY-lastPointer[1])*.003,-1.45,1.45);camera.quaternion.setFromEuler(rotation);lastPointer=[e.clientX,e.clientY];const direction=new THREE.Vector3();camera.getWorldDirection(direction);controls.target.copy(camera.position).addScaledVector(direction,5);invalidate();});
for(const event of ['pointerup','pointercancel'])renderer.domElement.addEventListener(event,()=>{looking=false;});
addEventListener('blur',()=>{keys.clear();looking=false;});
addEventListener('keydown',e=>{keys.add(e.code);if(e.code==='Digit1'){setFree(false);reset();}if(e.code==='KeyF'&&!e.repeat)setFree(!free);
  if(e.code==='KeyV'&&!e.repeat)residents?.togglePause?.();
  if(e.code==='KeyP'&&import.meta.env.DEV)window.__village.captureFrame(params.get('capture')||config.revision).then(result=>{window.__village.capture=result;});
});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;if(referenceView)reset();else camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);contact?.resize();invalidate();});

function prepare(root){root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;const materials=Array.isArray(o.material)?o.material:[o.material];const ground=o.name.includes('ContinuousGround');for(const m of materials){m.metalness=0;weatherBuildingMaterial(m);for(const key of ['map','normalMap','roughnessMap'])if(m[key])m[key].anisotropy=ground?8:4;}}});}
function anchor(id,x,y,h){anchors.push({id,position:new THREE.Vector3(x,h,-y)});}

async function build(){
  await loadSurfaceTextures();
  const metadata=await fetch('/assets/terrain-layout-r15.json').then(r=>r.json());
  const terrain=(await loader.loadAsync('/assets/packed/terrain-r15.glb')).scene;prepare(terrain);
  terrain.traverse(o=>{if(o.name.includes('Water'))o.visible=false;if(o.isLight||o.isCamera)o.visible=false;});scene.add(terrain);
  sample=extendLandscape(scene,makeGroundSampler(terrain),metadata);ocean.setCoast(metadata.coast);
  ocean.setBottom(sample,metadata.bounds);
  detailGround(sample.ground.material,metadata.bounds);
  if(import.meta.env.DEV)window.__village.setGroundStudy=({normalStrength,soilStrength,receiveShadow})=>{if(normalStrength!==undefined)sample.ground.material.normalScale.setScalar(normalStrength);if(soilStrength!==undefined)sample.ground.material.userData.soilStrength.value=soilStrength;if(receiveShadow!==undefined)sample.ground.receiveShadow=receiveShadow;invalidate();};
  sample.coverAt=await groundCover(metadata.bounds,'/assets/ground-cover-r14.png');
  window.__village.hinterland=await addHinterland(scene,loader,sample,metadata);
  if(params.has('coastcheck')){
    window.__village.coastCheck=metadata.coast.map(p=>({xy:p,height:sample.at(...p)}));
    for(const p of metadata.coast){const dot=new THREE.Mesh(new THREE.SphereGeometry(.55,10,8),new THREE.MeshBasicMaterial({color:'#ff2050',depthTest:false}));dot.position.set(p[0],-.59,-p[1]);dot.renderOrder=999;scene.add(dot);}
  }
  // Screen anchors come from the exact supplied image; ray solve onto the actual
  // inherited terrain establishes coherent 3D positions before adding geometry.
  function solveScreen(screen){
    const ray=new THREE.Vector3(screen[0]*2-1,1-screen[1]*2,.5).unproject(referenceCamera).sub(referenceCamera.position).normalize();
    let lastT=.2,p=new THREE.Vector3();
    const clearance=t=>{p.copy(referenceCamera.position).addScaledVector(ray,t);return p.y-(sample.at(p.x,-p.z)??-.6);};
    for(let t=.5;t<900;t+=.7){
      if(clearance(t)<=0){let lo=lastT,hi=t;for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(clearance(mid)>0)lo=mid;else hi=mid;}clearance((lo+hi)/2);return[p.x,-p.z];}
      lastT=t;
    }
    throw new Error(`Reference anchor has no visible terrain: ${screen}`);
  }
  const calibrating=import.meta.env.DEV&&params.has('calibrate');
  if(import.meta.env.DEV)window.__village.inspectScreen=(u,v)=>{const xy=solveScreen([u,v]);return{xy,height:sample.at(...xy),coastDistance:sample.coastDistance(...xy)};};
  if(calibrating){for(const item of [...config.cottages,config.landmark,config.workshop,config.market,config.landing])item.xy=solveScreen(item.screen);}
  else for(const key of ['cottages','landmark','workshop','market','landing'])config[key]=metadata.placements[key];
  const paths=calibrating?config.pathsScreen.map(p=>({...p,points:p.points.map(solveScreen)})):metadata.paths;
  for(const item of [...config.cottages,config.landmark,config.workshop,config.market,config.landing])item.groundHeight=sample.at(...item.xy);
  const coast=config.coastScreen.map(s=>{const ray=new THREE.Vector3(s[0]*2-1,1-s[1]*2,.5).unproject(referenceCamera).sub(referenceCamera.position).normalize();const p=referenceCamera.position.clone().addScaledVector(ray,(-.6-referenceCamera.position.y)/ray.y);return[p.x,-p.z];});
  if(import.meta.env.DEV)await fetch('/__layout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...config,paths,coast})});
  window.__village.layout=JSON.parse(JSON.stringify({cottages:config.cottages,landmark:config.landmark,workshop:config.workshop,market:config.market,landing:config.landing}));
  const cottageAssets={foreground:'/assets/packed/cottage-foreground-r15.glb',west:'/assets/packed/cottage-west-r15.glb',garden:'/assets/packed/cottage-garden-r17.glb',rear:'/assets/packed/cottage-rear-r15.glb',east:'/assets/packed/cottage-east-r15.glb'};
  const cottages=Object.fromEntries(await Promise.all(Object.entries(cottageAssets).map(async([id,url])=>{const model=batchStaticModel((await loader.loadAsync(url)).scene);prepare(model);return [id,model];})));
  for(const spec of config.cottages){const root=cottages[spec.id].clone(true),[x,y]=spec.xy;const h=sample.at(x,y);root.position.set(x,h??0,-y);root.rotation.y=spec.yaw;root.scale.setScalar(spec.scale);root.name=`Cottage ${spec.id}`;scene.add(root);anchor(spec.id,x,y,(h??0)+3);window.__village.measurements[spec.id]=projectedBounds(root,referenceCamera);}
  const landmark=batchStaticModel((await loader.loadAsync('/assets/packed/landmark-r07.glb')).scene);prepare(landmark);
  landmark.position.set(config.landmark.xy[0],sample.at(...config.landmark.xy),-config.landmark.xy[1]);landmark.rotation.y=1.5;landmark.scale.setScalar(config.landmark.scale??1.25);scene.add(landmark);
  window.__village.measurements.landmark=projectedBounds(landmark,referenceCamera);
  const workshop=batchStaticModel((await loader.loadAsync('/assets/packed/workshop-r03.glb')).scene);prepare(workshop);
  workshop.position.set(config.workshop.xy[0],sample.at(...config.workshop.xy),-config.workshop.xy[1]);workshop.rotation.y=1.55;scene.add(workshop);
  window.__village.measurements.workshop=projectedBounds(workshop,referenceCamera);
  anchor('landmark',...config.landmark.xy,(sample.at(...config.landmark.xy)??0)+7);
  anchor('market',...config.market.xy,(sample.at(...config.market.xy)??0));
  anchor('landing',...config.landing.xy,0);
  const layout=await fetch('/assets/layout-source.json').then(r=>r.json());
  layout.paths=paths;
  activity=await addVillageActivity(scene,loader,sample,config,solveScreen);window.__village.activity=activity.counts;
  const surroundings=await addSurroundings(scene,loader,sample,config,solveScreen,activity.templates);window.__village.surroundings={count:surroundings.count};
  maritime=await addMaritime(scene,loader,sample,referenceCamera,activity.templates);window.__village.maritime={...maritime.counts,berths:maritime.berthAudit};
  ocean.setBoats(maritime.waterHulls);
  const background=await addVillagers(scene,loader,sample,referenceCamera,solveScreen,activity,maritime,config);
  terrain.updateMatrixWorld(true);terrain.traverse(o=>{if(!o.isMesh||!o.name.includes('Outcrop'))return;const p=new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());if(Math.hypot(p.x-config.market.xy[0],-p.z-config.market.xy[1])<10.5)o.visible=false;});
  window.__village.groundDetails=await addGroundDetails(scene,loader,terrain,sample,config,paths,solveScreen);
  residents=await addUbcVillagers(scene,loader,sample,referenceCamera,solveScreen,{activity,maritime,config,paths,layout:metadata,background,surroundings,controls,invalidate,still,camera});
  if(typeof residents?.update!=='function')throw new Error('UBC residents API is missing update');
  window.__village.residents=residents;
  if(import.meta.env.DEV){
    window.__village.residents.placements=background.placements;
    window.__village.debug.residents=window.__village.residents;
  }
  for(const key of ['framingTrees','framingConifers'])config[key]=config[key].map(spec=>{
    const xy=solveScreen(spec.screen),h=sample.at(...xy);let low=.5,high=42;
    for(let i=0;i<18;i++){const mid=(low+high)/2,p=new THREE.Vector3(xy[0],h+mid,-xy[1]).project(referenceCamera);if((1-p.y)/2>spec.top)low=mid;else high=mid;}
    return{...spec,xy,height:(low+high)/2};
  });
  vegetation=await addVegetation(scene,loader,sample,config,layout);
  window.__village.vegetation=vegetation.counts;
  window.__village.placementAudit={activity:activity.placements,plots:config.cultivatedPlots,boats:maritime.waterHulls.map(({base})=>base.toArray()),framingTrees:config.framingTrees,framingConifers:config.framingConifers};
  function applyReviewView(view){
  if(!view||view==='overview'){setFree(false);reset();invalidate();return;}
  if(view)referenceView=false;
  const b=config.cottages[0].xy;
  if(view==='meadow'){camera.position.set(b[0]-6,sample.at(...b)+3.2,-b[1]+9);controls.target.set(b[0]-6,sample.at(...b)+.5,-b[1]+1);}
  if(view==='roof'){camera.position.set(b[0]+12,sample.at(...b)+10,-b[1]+13);controls.target.set(b[0],sample.at(...b)+4,-b[1]);}
  if(view==='roof-back'){camera.position.set(b[0]-10,sample.at(...b)+8,-b[1]-11);controls.target.set(b[0],sample.at(...b)+2.8,-b[1]);}
  if(view==='cottage'){camera.position.set(b[0]+9,sample.at(...b)+4.6,-b[1]-3);controls.target.set(b[0],sample.at(...b)+2.2,-b[1]);}
  if(view==='landmark'){const p=config.landmark.xy;camera.position.set(p[0]+18,sample.at(...p)+11,-p[1]+14);controls.target.set(p[0],sample.at(...p)+7,-p[1]);}
  if(view==='construction'){const p=config.workshop.xy;camera.position.set(p[0]+15,sample.at(...p)+6,-p[1]-3);controls.target.set(p[0],sample.at(...p)+3.4,-p[1]);}
  if(view==='market'){const p=config.market.xy;camera.position.set(p[0]+5,sample.at(...p)+3.0,-p[1]+7);controls.target.set(p[0],sample.at(...p)+1.1,-p[1]);}
  if(view==='harbor'){const p=config.landing.xy;camera.position.set(p[0]+15,6,-p[1]+12);controls.target.set(p[0]+1,.3,-p[1]);}
  if(view==='headland'){camera.position.set(-45,12,-120);controls.target.set(-78,6,-174);}
  if(view==='farms'){const p=config.cultivatedPlots[1].xy;camera.position.set(p[0]+23,sample.at(...p)+17,-p[1]+16);controls.target.set(p[0]-3,sample.at(...p)+1.2,-p[1]-2);}
  controls.update();
  invalidate();
  }
  applyReviewView(params.get('view'));
  if(import.meta.env.DEV)window.__village.setView=applyReviewView;
  if(import.meta.env.DEV)window.__village.farms={plots:config.cultivatedPlots,setGrowth:(id,growth)=>{activity.crops.setGrowth(id,growth);renderer.shadowMap.needsUpdate=true;invalidate();}};
  if(import.meta.env.DEV)window.__village.cameraProbe=()=>({position:camera.position.toArray(),target:controls.target.toArray(),floor:Math.max(-.59,sample.at(camera.position.x,-camera.position.z))+.7,free});
  if(import.meta.env.DEV)window.__village.setReviewCamera=({position,target,fov=config.camera.fov})=>{setFree(false);referenceView=false;camera.position.fromArray(position);controls.target.fromArray(target);camera.fov=fov;camera.updateProjectionMatrix();controls.update();invalidate();};
  if(import.meta.env.DEV)window.__village.setLandmark=({yaw,scale,screen})=>{if(yaw!==undefined)landmark.rotation.y=yaw;if(scale)landmark.scale.fromArray(scale);if(screen){const [x,y]=solveScreen(screen);landmark.position.set(x,sample.at(x,y),-y);}renderer.shadowMap.needsUpdate=true;window.__village.measurements.landmark=projectedBounds(landmark,referenceCamera);invalidate();};
  renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
  window.__village.ready=true;invalidate();document.querySelector('#load').classList.add('done');
  if(import.meta.env.DEV)window.__village.setLighting=({sunIntensity,ambient,exposure,position,fogDensity,sunColor,skyColor,bounceColor})=>{const hemi=scene.children.find(o=>o.isHemisphereLight);if(sunIntensity!==undefined)sun.intensity=sunIntensity;if(ambient!==undefined)hemi.intensity=ambient;if(skyColor)hemi.color.set(skyColor);if(bounceColor)hemi.groundColor.set(bounceColor);if(sunColor)sun.color.set(sunColor);if(exposure!==undefined)renderer.toneMappingExposure=exposure;if(position)sun.position.fromArray(position);if(fogDensity!==undefined)scene.fog.density=fogDensity;renderer.shadowMap.needsUpdate=true;ocean.setSun(sun.position.clone().sub(sun.target.position));invalidate();};
}
build().catch(e=>{window.__village.errors.push(e.message);document.querySelector('#load').textContent=`Scene could not load: ${e.message}`;console.error(e);});

let frames=0,last=performance.now();
const reflectionHidden=[];
const reflectionPrefixes=['Fine meadow blades','Headland grass colonies','Wildflower colonies','Path shoulder pebbles','Woodland fern colonies','Native meadow shrubs','Distant leaf crowns','Distant branching trunks','Opposite headland crowns','Opposite headland trunks','Coast and woodland stones','Small broken granite'];
const reflectionPrepare={
  before(){
    reflectionHidden.length=0;
    scene.traverse(o=>{
      if(o.userData?.plotId||reflectionPrefixes.some(prefix=>(o.name||'').startsWith(prefix))){
        reflectionHidden.push([o,o.visible]);o.visible=false;
      }
    });
    vegetation?.reflectionTier(true);
  },
  after(){
    for(const [o,visible] of reflectionHidden)o.visible=visible;
    reflectionHidden.length=0;
    vegetation?.reflectionTier(false);
  },
};
function renderFrame(){
  const now=performance.now(),frameMs=now-last,dt=Math.min(.05,frameMs/1000);last=now;
  if(!window.__village.ready)return;
  if(!free)controls.update();
  const moving=free&&['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE'].some(key=>keys.has(key));
  if(still&&!renderNeeded&&!moving)return;
  renderNeeded=false;const t=still?4:clock.getElapsedTime();
  if(free){const direction=new THREE.Vector3();camera.getWorldDirection(direction);direction.y=0;direction.normalize();const right=new THREE.Vector3().crossVectors(direction,camera.up).normalize();const delta=new THREE.Vector3();const speed=(keys.has('ShiftLeft')?20:7)*dt;if(keys.has('KeyW'))delta.addScaledVector(direction,speed);if(keys.has('KeyS'))delta.addScaledVector(direction,-speed);if(keys.has('KeyD'))delta.addScaledVector(right,speed);if(keys.has('KeyA'))delta.addScaledVector(right,-speed);if(keys.has('KeyE'))delta.y+=speed;if(keys.has('KeyQ'))delta.y-=speed;if(sample){const floor=Math.max(-.59,sample.at(camera.position.x+delta.x,-camera.position.z-delta.z))+.7;delta.y=Math.max(delta.y,floor-camera.position.y);}camera.position.add(delta);controls.target.add(delta);}
  camera.updateMatrixWorld();vegetation?.update(t,camera);activity?.update(t);maritime?.update(t);residents?.update(t,still?0:dt);ocean.update(t);renderer.info.reset();
  const baking=renderer.shadowMap.needsUpdate;if(baking)vegetation?.shadowBake(true);
  if(!params.has('noReflection'))ocean.refreshReflection(renderer,camera,params.has('reflectFull')?undefined:reflectionPrepare);
  if(contact)contact.render();else renderer.render(scene,camera);
  if(baking){vegetation?.shadowBake(false);invalidate();}
  if(window.__village.ready)timings.push(frameMs);if(timings.length>180)timings.shift();
  window.__village.renderedFrames=++frames;
  if(still||frames%30===0){const sorted=[...timings].sort((a,b)=>a-b);window.__village.metrics={mode:still?'on-demand':'animated',calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,frameMs:still?null:timings.reduce((a,b)=>a+b,0)/(timings.length||1),p95FrameMs:still?null:sorted[Math.floor(sorted.length*.95)]??0,samples:timings.length,camera:camera.position.toArray(),target:controls.target.toArray()};window.__village.anchors=anchors.map(a=>{const p=a.position.clone().project(camera);return{id:a.id,world:a.position.toArray(),screen:[(p.x+1)/2,(1-p.y)/2]};});}
}
function updateVisibility(){keys.clear();looking=false;last=performance.now();invalidate();window.__village.renderingPaused=document.hidden;renderer.setAnimationLoop(document.hidden?null:renderFrame);}
addEventListener('visibilitychange',updateVisibility);updateVisibility();
