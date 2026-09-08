import * as THREE from 'three';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {
  ADULT_HEIGHT, CHARACTER_RADIUS, REQUIRED_CLIPS, SOCIAL_SPECS, UBC_ASSET_URL,
  WALKER_PAUSES, WALKER_ROUTE_SPECS, WALKER_SPEEDS, WALK_SPEED_MAX, WALK_SPEED_MIN,
  collectSceneSolids, hypot2, layoutObstacles, namedPath, observerBlend,
  prepareWalkerRoute, resolvePairCandidate, resolvePointCandidate, talkBlend,
  walkBlend, walkerKinematics, walkerWorldPose, workerPhase, yawFromGroundDelta,
} from './villager-routes.js';

function clipMap(animations){
  const found=Object.fromEntries((animations??[]).map(clip=>[clip.name,clip]));
  const missing=REQUIRED_CLIPS.filter(name=>!found[name]);
  if(missing.length)throw new Error(`UBC village clips missing (${missing.join(', ')}). Found: ${(animations??[]).map(c=>c.name).join(', ')||'none'}`);
  return found;
}

function measureBind(root){
  root.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(root);
  const height=box.max.y-box.min.y;
  if(!(height>1.2&&height<2.6))throw new Error(`UBC bind height ${height.toFixed(3)} m is outside an adult standing range`);
  return {floor:box.min.y,height,size:box.getSize(new THREE.Vector3())};
}

function measureStride(root,clip){
  const mixer=new THREE.AnimationMixer(root);
  const action=mixer.clipAction(clip);action.play();
  const foot=root.getObjectByName('ball_l')||root.getObjectByName('foot_l')||root.getObjectByName('calf_l');
  if(!foot)throw new Error('UBC walk stride cannot be measured; foot bone is missing');
  mixer.setTime(0);root.updateMatrixWorld(true);
  const a=foot.getWorldPosition(new THREE.Vector3());
  mixer.setTime(clip.duration*.5);root.updateMatrixWorld(true);
  const b=foot.getWorldPosition(new THREE.Vector3());
  mixer.stopAllAction();root.traverse(object=>{if(object.isSkinnedMesh)object.skeleton?.pose();});
  const step=Math.hypot(b.x-a.x,b.z-a.z);
  return Math.max(.9,Math.min(2.15,step*2));
}

function disableFrozenShadows(root){
  root.traverse(object=>{
    if(!object.isMesh)return;
    object.castShadow=false;
    object.receiveShadow=true;
    object.frustumCulled=false;
    if(object.isSkinnedMesh)object.matrixAutoUpdate=true;
  });
}

function makeBlob(geometry,material){
  const mesh=new THREE.Mesh(geometry,material);
  mesh.rotation.x=-Math.PI/2;
  mesh.renderOrder=2;
  mesh.castShadow=false;
  mesh.receiveShadow=false;
  mesh.frustumCulled=false;
  mesh.name='UBC contact shadow';
  return mesh;
}

function addWorkerBoard(group,sampler,xy,yaw){
  const fx=Math.sin(yaw),fy=-Math.cos(yaw);
  const cx=xy[0]+.52*fx,cy=xy[1]+.52*fy;
  const terrain=sampler.at(cx,cy);
  if(!Number.isFinite(terrain))throw new Error('Worker board has no terrain');
  const wood=new THREE.MeshStandardMaterial({name:'UBC work timber',color:'#6b5438',roughness:.94,metalness:0});
  const top=terrain+.38;
  const board=new THREE.Mesh(new THREE.BoxGeometry(.85,.08,.32),wood);
  board.position.set(cx,top-.04,-cy);board.rotation.y=yaw;
  board.castShadow=true;board.receiveShadow=true;board.name='UBC worker board';
  const posts=[];
  for(const side of [-.28,.28]){
    const px=cx+Math.cos(yaw)*side,py=cy+Math.sin(yaw)*side,ground=sampler.at(px,py);
    const height=Math.max(.06,top-.08-ground);
    const post=new THREE.Mesh(new THREE.BoxGeometry(.055,height,.055),wood);
    post.position.set(px,ground+height/2,-py);post.rotation.y=yaw;
    post.castShadow=true;post.receiveShadow=true;post.name='UBC worker board post';
    group.add(post);
    posts.push({xy:[px,py],height,ground});
  }
  group.add(board);
  return {xy:[cx,cy],yaw,top,terrain,size:[.85,.08,.32],forward:.52,posts};
}

function timberAnchor(endpoint,surroundings){
  const stacks=(surroundings?.placements??[]).filter(item=>item.name==='log_stack');
  let nearest=null;
  for(const stack of stacks){
    const distance=hypot2(endpoint[0],endpoint[1],...stack.xy);
    if(distance<14&&(!nearest||distance<nearest.distance))nearest={xy:stack.xy,distance};
  }
  if(!nearest)return endpoint;
  return [endpoint[0]+(nearest.xy[0]-endpoint[0])*.38,endpoint[1]+(nearest.xy[1]-endpoint[1])*.38];
}

export async function addUbcVillagers(scene,loader,sampler,camera,solveScreen,context){
  const {activity,config,paths,layout,background,surroundings,controls,invalidate,still,camera:viewCamera}=context;
  let gltf;
  try{
    gltf=await loader.loadAsync(UBC_ASSET_URL);
  }catch(error){
    throw new Error(`UBC village body failed to load at ${UBC_ASSET_URL}: ${error.message}`);
  }
  const clips=clipMap(gltf.animations);
  const template=gltf.scene;
  template.updateMatrixWorld(true);
  const bind=measureBind(template);
  const scale=ADULT_HEIGHT/bind.height;
  const stride=measureStride(template,clips.Walk_Loop);
  const obstacles=layoutObstacles(layout,config,activity,surroundings);
  const sceneSolids=collectSceneSolids(scene);
  obstacles.push(...sceneSolids.extras);
  const world={
    at:(x,y)=>sampler.at(x,y),
    coastDistance:(x,y)=>sampler.coastDistance(x,y),
    obstacles,
    paths,
  };
  const routes=WALKER_ROUTE_SPECS.map(spec=>prepareWalkerRoute(paths,spec,world));
  const placement={routes:routes.map(route=>({name:route.name,width:route.width,length:route.length,valid:route.valid,note:route.note,sourceValid:route.sourceValid,rejected:route.rejected})),social:[],unhandledObstacles:sceneSolids.unhandled,failures:[]};
  function publishPlacement(fatal){
    if(typeof window!=='undefined'){
      window.__village=window.__village||{};
      window.__village.residentPlacement=placement;
    }
    if(!fatal)return;
    const failures=placement.failures.map(item=>`${item.id}:${(item.reasons||[]).join('|')||'invalid'}`).join('; ');
    throw new Error(`UBC placement failed: ${failures}`);
  }
  const invalid=routes.filter(route=>!route.valid);
  if(invalid.length){
    for(const route of invalid)placement.failures.push({id:route.name,role:'route',reasons:[route.reason??'no-safe-segment'],rejected:route.rejected,selected:null});
    publishPlacement(true);
  }
  const blobGeometry=new THREE.CircleGeometry(CHARACTER_RADIUS*1.15,18);
  const blobMaterial=new THREE.MeshBasicMaterial({color:0x1a140e,transparent:true,opacity:.3,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
  const group=new THREE.Group();group.name='Meadow Harbor UBC residents';scene.add(group);
  const actors=[];
  let followId=null,frozenT=null,pauseOffset=0,lastWall=0,appliedT=0,workSupport=null;

  function plantHeight(x,y){
    const ground=sampler.at(x,y);
    if(!Number.isFinite(ground))throw new Error(`UBC resident has no terrain at ${x.toFixed(2)},${y.toFixed(2)}`);
    return ground-bind.floor*scale;
  }

  function createActor(id,role,extra={}){
    const root=cloneSkeleton(template);
    root.name=`UBC ${id}`;
    root.scale.setScalar(scale);
    disableFrozenShadows(root);
    const mixer=new THREE.AnimationMixer(root);
    const actions={};
    for(const name of REQUIRED_CLIPS){
      const action=mixer.clipAction(clips[name]);
      action.enabled=false;action.setEffectiveWeight(0);action.play();action.paused=true;
      actions[name]=action;
    }
    const blob=makeBlob(blobGeometry,blobMaterial);
    group.add(root,blob);
    const skeleton=root.getObjectByProperty('isSkinnedMesh',true)?.skeleton;
    if(!skeleton)throw new Error(`UBC clone ${id} has no independent skeleton`);
    const actor={id,role,root,mixer,actions,blob,skeleton,clip:null,...extra};
    actors.push(actor);
    return actor;
  }

  routes.forEach((route,routeIndex)=>{
    if(!route.valid||route.points.length<2)throw new Error(`No safe walking segment on ${route.name}: need >=4 m of clear path`);
    for(const lane of [0,1]){
      const speed=WALKER_SPEEDS[routeIndex*2+lane];
      const pause=WALKER_PAUSES[routeIndex*2+lane];
      if(speed<WALK_SPEED_MIN||speed>WALK_SPEED_MAX)throw new Error(`Walker speed ${speed} outside ${WALK_SPEED_MIN}–${WALK_SPEED_MAX}`);
      const probe=walkerKinematics({length:route.length,speed,pause,t:0});
      createActor(`walker-${route.name}-${lane}`,'walker',{
        route,lane,speed,pause,phase:lane?probe.tLeg:routeIndex*.37,
      });
    }
  });

  const social=[];
  function failSocial(entry){
    placement.social.push(entry);
    placement.failures.push(entry);
    publishPlacement(true);
  }
  for(const spec of SOCIAL_SPECS){
    if(spec.role==='pair'){
      const screens=spec.screens??[spec.screen];
      const attempts=[];
      let picked=null;
      for(const screen of screens){
        const anchor=solveScreen(screen);
        const resolved=resolvePairCandidate(spec.id,anchor,world);
        attempts.push({screen,anchor,ok:resolved.ok,people:resolved.people,reasons:resolved.reasons,rejected:resolved.rejected.slice(0,8)});
        if(resolved.ok){picked={screen,anchor,resolved};break;}
      }
      const entry={id:spec.id,role:'pair',screen:picked?.screen??screens[0],anchor:picked?.anchor??attempts[0]?.anchor,resolved:picked?.resolved??{ok:false,people:[],reasons:attempts[0]?.reasons??['pair-clearance'],rejected:attempts[0]?.rejected??[]},attempts};
      if(!picked)failSocial({id:spec.id,role:'pair',reasons:attempts.flatMap(item=>item.reasons??[]),selected:null,attempts});
      social.push(entry);placement.social.push(entry);
      for(const [index,person] of picked.resolved.people.entries()){
        createActor(person.id,'talk',{xy:person.xy,yaw:person.yaw,talkIndex:index,anchor:picked.screen});
      }
    }else if(spec.role==='observer'){
      const anchor=solveScreen(spec.screen);
      const resolved=resolvePointCandidate(spec.id,anchor,world,{requireOffPath:true});
      const entry={id:spec.id,role:'observer',screen:spec.screen,anchor,resolved};
      if(!resolved.ok)failSocial({id:spec.id,role:'observer',reasons:resolved.reasons,selected:null,anchor,rejected:resolved.rejected});
      social.push(entry);placement.social.push(entry);
      const look=social.find(item=>item.role==='pair'&&item.resolved?.ok);
      const target=look?.resolved.people[0]?.xy??config.market.xy;
      const yaw=yawFromGroundDelta(target[0]-resolved.chosen[0],target[1]-resolved.chosen[1]);
      createActor(spec.id,'observer',{xy:resolved.chosen,yaw,anchor:spec.screen});
    }else if(spec.role==='worker'){
      const path=namedPath(paths,spec.path);
      const endpoint=path.points.at(-1);
      const biased=timberAnchor(endpoint,surroundings);
      const from=hypot2(biased[0],biased[1],...endpoint)<=1.5?biased:endpoint;
      const resolved=resolvePointCandidate(spec.id,from,world,{requireOffPath:true});
      const entry={id:spec.id,role:'worker',anchor:endpoint,biased,resolved};
      if(!resolved.ok)failSocial({id:spec.id,role:'worker',reasons:resolved.reasons,selected:null,anchor:endpoint,biased,rejected:resolved.rejected});
      social.push(entry);placement.social.push(entry);
      const yaw=yawFromGroundDelta(config.workshop.xy[0]-resolved.chosen[0],config.workshop.xy[1]-resolved.chosen[1]);
      const worker=createActor(spec.id,'worker',{xy:resolved.chosen,yaw});
      workSupport=addWorkerBoard(group,sampler,worker.xy,worker.yaw);
    }
  }

  if(actors.length!==12)throw new Error(`UBC village expected 12 residents, created ${actors.length}`);

  function wrapTime(time,duration){
    return ((time%duration)+duration)%duration;
  }

  function poseFor(actor,t,kin){
    if(actor.role==='walker'){
      const kinematics=kin??walkerKinematics({length:actor.route.length,speed:actor.speed,pause:actor.pause,phase:actor.phase,t});
      const pose=walkerWorldPose(actor.route,kinematics,actor.lane);
      const weights=walkBlend(kinematics.vel);
      const walkDuration=clips.Walk_Loop.duration,idleDuration=clips.Idle_Loop.duration;
      const clipTimes={Walk_Loop:wrapTime((kinematics.traveled/stride)*walkDuration,walkDuration),Idle_Loop:wrapTime(t+actor.phase,idleDuration)};
      const clip=weights.Walk_Loop>=weights.Idle_Loop?'Walk_Loop':'Idle_Loop';
      return {
        x:pose.x,y:pose.y,height:plantHeight(pose.x,pose.y),yaw:pose.yaw,terrain:sampler.at(pose.x,pose.y),
        clip,clipTime:clipTimes[clip],clipTimes,weights,playing:true,
        moving:kinematics.moving,vel:kinematics.vel,s:kinematics.s,dir:kinematics.dir,turning:kinematics.turning,paused:kinematics.paused,
        route:actor.route.name,routeValid:actor.route.valid,routeLength:actor.route.length,
      };
    }
    const height=plantHeight(...actor.xy);
    if(actor.role==='talk'){
      const weights=talkBlend(t,actor.talkIndex);
      const clipTimes={Idle_Talking_Loop:wrapTime(t+actor.talkIndex*1.15,clips.Idle_Talking_Loop.duration),Idle_Loop:wrapTime(t+actor.talkIndex*1.15,clips.Idle_Loop.duration)};
      const clip=weights.Idle_Talking_Loop>=weights.Idle_Loop?'Idle_Talking_Loop':'Idle_Loop';
      return {x:actor.xy[0],y:actor.xy[1],height,yaw:actor.yaw,terrain:sampler.at(...actor.xy),clip,clipTime:clipTimes[clip],clipTimes,weights,playing:true,moving:false,vel:0};
    }
    if(actor.role==='observer'){
      const weights=observerBlend(t);
      const clipTimes={Idle_Talking_Loop:wrapTime(t+.6,clips.Idle_Talking_Loop.duration),Idle_Loop:wrapTime(t+.6,clips.Idle_Loop.duration)};
      const clip=weights.Idle_Talking_Loop>=weights.Idle_Loop?'Idle_Talking_Loop':'Idle_Loop';
      return {x:actor.xy[0],y:actor.xy[1],height,yaw:actor.yaw,terrain:sampler.at(...actor.xy),clip,clipTime:clipTimes[clip],clipTimes,weights,playing:true,moving:false,vel:0,gesturing:weights.Idle_Talking_Loop>.5};
    }
    const work=workerPhase(t,clips.Fixing_Kneeling.duration);
    return {x:actor.xy[0],y:actor.xy[1],height,yaw:actor.yaw,terrain:sampler.at(...actor.xy),clip:work.clip,clipTime:work.clipTime,clipTimes:{Fixing_Kneeling:work.clipTime},weights:{Fixing_Kneeling:1},playing:true,moving:false,vel:0,stationary:true};
  }

  function applyPose(actor,pose){
    actor.root.position.set(pose.x,pose.height,-pose.y);
    actor.root.rotation.y=pose.yaw;
    actor.blob.position.set(pose.x,(pose.terrain??pose.height)+.02,-pose.y);
    actor.blob.scale.setScalar(1);
    const weights=pose.weights??{[pose.clip]:1};
    const times=pose.clipTimes??{[pose.clip]:pose.clipTime};
    for(const [name,action] of Object.entries(actor.actions)){
      const w=weights[name]??0;
      action.enabled=w>0.001;
      action.setEffectiveWeight(w);
      if(w>0.001&&times[name]!=null)action.time=wrapTime(times[name],action.getClip().duration);
      action.paused=w<=0.001;
    }
    actor.mixer.update(0);
    actor.clip=pose.clip;
    actor.pose=pose;
  }

  function posesAt(t){
    return actors.map(actor=>poseFor(actor,t));
  }

  function applyAll(t){
    const poses=posesAt(t);
    actors.forEach((actor,index)=>applyPose(actor,poses[index]));
    appliedT=t;
  }

  applyAll(0);
  publishPlacement(false);

  function followCamera(actor){
    if(!viewCamera||!actor)return;
    const p=actor.root.position,yaw=actor.root.rotation.y;
    viewCamera.position.set(p.x-Math.sin(yaw)*4.6,p.y+1.55,p.z-Math.cos(yaw)*4.6);
    if(controls){controls.target.set(p.x,p.y+1.12,p.z);controls.update();}
    invalidate?.();
  }

  function actorState(actor){
    const pose=actor.pose??poseFor(actor,appliedT);
    return {
      id:actor.id,role:actor.role,clip:pose.clip,clipTime:Number(pose.clipTime.toFixed(3)),
      playing:pose.playing,xy:[Number(pose.x.toFixed(3)),Number(pose.y.toFixed(3))],
      world:[Number(pose.x.toFixed(3)),Number(pose.height.toFixed(3)),Number((-pose.y).toFixed(3))],
      yaw:Number(pose.yaw.toFixed(3)),terrainHeight:Number((pose.terrain??pose.height).toFixed(3)),
      speed:Number((pose.vel??0).toFixed(3)),moving:!!pose.moving,turning:!!pose.turning,
      route:pose.route,routeLength:pose.routeLength,routeValid:pose.routeValid,s:pose.s,
      weights:pose.weights,springs:false,cloth:false,
    };
  }

  function minSeparation(){
    let min=Infinity;
    for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++){
      const a=actors[i].root.position,b=actors[j].root.position;
      min=Math.min(min,Math.hypot(a.x-b.x,a.z-b.z));
    }
    return min;
  }

  function diagnostics(){
    return {
      t:appliedT,paused:frozenT!==null,still:!!still,
      backgroundCount:background.count,seated:background.seated,dock:background.dock,workshop:background.workshop,
      ubcCount:actors.length,count:background.count+actors.length,
      bindFloor:bind.floor,bindHeight:bind.height,scale,adultHeight:ADULT_HEIGHT,strideMeters:stride,
      facing:'+Z',springs:false,cloth:false,
      routes:routes.map(route=>({name:route.name,width:route.width,length:route.length,valid:route.valid,note:route.note,sourceLength:route.sourceLength,sourceValid:route.sourceValid,rejected:route.rejected})),
      social:social.map(item=>({id:item.id,role:item.role,screen:item.screen??item.resolved?.screen??null,anchor:item.anchor,ok:item.resolved.ok,chosen:item.resolved.chosen??item.resolved.people,reasons:item.resolved.reasons??[],rejected:(item.resolved.rejected??[]).slice(0,8),attempts:item.attempts})),
      placement,workSupport,
      unhandledObstacles:sceneSolids.unhandled,
      minSeparation:minSeparation(),
      actors:actors.map(actorState),
    };
  }

  function setPaused(value){
    if(value){if(frozenT===null)frozenT=appliedT;}
    else if(frozenT!==null){pauseOffset=lastWall-frozenT;frozenT=null;}
    const button=document.querySelector('#life');
    if(button){button.setAttribute('aria-pressed',String(frozenT!==null));button.textContent=frozenT!==null?'\u25B6':' \u23F8 ';}
    invalidate?.();
  }

  const api={
    count:background.count+actors.length,
    backgroundCount:background.count,
    ubcCount:actors.length,
    seated:background.seated,
    dock:background.dock,
    workshop:background.workshop,
    placements:background.placements,
    update(t){
      lastWall=t;
      applyAll(frozenT??t-pauseOffset);
      if(followId){
        const actor=actors.find(item=>item.id===followId);
        if(actor)followCamera(actor);
      }
    },
    pause(){setPaused(true);},
    resume(){setPaused(false);},
    togglePause(){setPaused(frozenT===null);},
    get paused(){return frozenT!==null;},
    workSupport,
  };

  if(import.meta.env?.DEV){
    api.diagnostics=diagnostics;
    api.sample=(id,t=appliedT)=>{
      const index=actors.findIndex(item=>item.id===id);
      if(index<0)throw new Error(`Unknown UBC resident ${id}`);
      const pose=posesAt(t)[index];
      return {...pose,id:actors[index].id,role:actors[index].role,springs:false,cloth:false};
    };
    api.seek=(idOrTime,maybeTime)=>{
      if(typeof idOrTime==='number'&&maybeTime===undefined){applyAll(idOrTime);if(frozenT!==null)frozenT=idOrTime;invalidate?.();return diagnostics();}
      const index=actors.findIndex(item=>item.id===idOrTime);
      if(index<0)throw new Error(`Unknown UBC resident ${idOrTime}`);
      const t=maybeTime??appliedT;
      applyPose(actors[index],posesAt(t)[index]);
      invalidate?.();
      return actorState(actors[index]);
    };
    api.follow=(id=null)=>{followId=id;invalidate?.();return followId;};
    api.actors=()=>actors.map(actor=>actor.id);
    api.routes=routes;
    api.social=social;
    api.placement=placement;
    api.workSupport=workSupport;
    api.bind=bind;
    api.stride=stride;
  }

  return api;
}
