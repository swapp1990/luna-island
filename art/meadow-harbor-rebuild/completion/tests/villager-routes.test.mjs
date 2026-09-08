import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {geometryOnlyScene} from '../scripts/geometry_only_scene.mjs';
import {makeGroundSampler,coastDistance} from '../terrain.js';
import {config} from '../config.js';
import {
  CHARACTER_RADIUS, FACE_SEPARATION, MIN_ACTOR_SEPARATION, MIN_VALID_LENGTH, REQUIRED_CLIPS, SOCIAL_SPECS,
  WALKER_PAUSES, WALKER_ROUTE_SPECS, WALKER_SPEEDS, WALK_SPEED_MAX, WALK_SPEED_MIN,
  cumulativeLengths, deltaAngle, hitsObstacle, layoutObstacles, makeCircle, makeObb, namedPath,
  pointIssues, polylineLength, prepareWalkerRoute, resamplePolyline,
  resolvePairCandidate, resolvePointCandidate, slopeDeg, tangentAt, talkBlend,
  trapezoidTravel, validatePath, walkBlend, walkerKinematics, walkerWorldPose,
  wrapAngle, yawFromGroundDelta,
} from '../villager-routes.js';

const COMPLETION=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const layout=JSON.parse(fs.readFileSync(path.join(COMPLETION,'public/assets/terrain-layout-r15.json'),'utf8'));
const assetPath=path.join(COMPLETION,'public/assets/ubc/ubc-male-ual-village.glb');
const terrainPath=path.join(COMPLETION,'public/assets/packed/terrain-r15.glb');

function flatWorld(height=1,inland=8){
  return {at:()=>height,coastDistance:()=>inland,obstacles:[],paths:layout.paths};
}

function assertAlmost(actual,expected,eps,label){
  assert.ok(Math.abs(actual-expected)<=eps,`${label}: ${actual} vs ${expected}`);
}

{
  const wall=makeObb([0,5],[.4,2],0,0,'wall');
  const world={...flatWorld(),obstacles:[wall]};
  const path=[[0,0],[0,10]];
  const report=validatePath(path,world,{radius:CHARACTER_RADIUS});
  assert.equal(report.valid,false,'path through a wall must be rejected');
  assert.ok(report.samples.some(sample=>sample.reasons.some(reason=>reason.includes('wall'))),'wall id is reported');
  assert.ok(!report.usable||report.usable.length<polylineLength(path),'unsafe remainder is not kept as the full path');
  const prepared=prepareWalkerRoute([{name:'blocked',width:2.2,points:path}],{name:'blocked'},world);
  assert.equal(prepared.valid,false);
  assert.equal(prepared.reason,'no-safe-segment');
}

{
  const world={at:(x,y)=>y*.5,coastDistance:()=>8,obstacles:[],paths:[]};
  const steep=slopeDeg(world.at,0,0,.7);
  assert.ok(steep>12,`synthetic slope ${steep} should exceed 12°`);
  const report=validatePath([[0,0],[0,4]],world);
  assert.equal(report.valid,false);
  assert.ok(report.samples.every(sample=>sample.reasons.some(reason=>reason.startsWith('slope:'))));
}

{
  const world={at:()=>-.2,coastDistance:()=>-1.5,obstacles:[],paths:[]};
  const report=validatePath([[1,1],[4,1]],world);
  assert.equal(report.valid,false);
  assert.ok(report.samples.every(sample=>sample.reasons.some(reason=>reason.startsWith('coast:')||reason.startsWith('height:'))));
}

{
  const points=[[0,0],[4,0],[4,4]];
  const a=tangentAt(points,.5),b=tangentAt(points,3.9),c=tangentAt(points,4.1),d=tangentAt(points,7.5);
  assertAlmost(a.sx,1,1e-6,'start tangent x');
  assertAlmost(d.sy,1,1e-6,'end tangent y');
  const startYaw=Math.atan2(a.sx,-a.sy),midYaw=Math.atan2(c.sx,-c.sy),endYaw=Math.atan2(d.sx,-d.sy);
  assert.ok(Math.abs(deltaAngle(startYaw,midYaw))<1.2,'corner yaw is blended, not a raw 90° snap at the vertex');
  assertAlmost(endYaw,Math.atan2(0,-1)+0,1e-6,'final tangent remains the authored outgoing segment');
}

{
  const length=12,speed=1.02,pause=1.4;
  const kin0=walkerKinematics({length,speed,pause,t:0});
  const kin1=walkerKinematics({length,speed,pause,t:.05});
  assert.ok(kin1.s>=kin0.s,'walkers do not teleport backward at start');
  const travel=trapezoidTravel(1e6,length,speed);
  const tOne=travel.tOne;
  const before=walkerKinematics({length,speed,pause,t:tOne-.25});
  const atEnd=walkerKinematics({length,speed,pause,t:tOne+.1});
  assertAlmost(atEnd.s,length,.02,'decelerate onto the endpoint');
  assert.equal(atEnd.paused,true);
  assert.ok(Math.abs(before.vel)>0.05,'still moving while decelerating into the endpoint');
  assert.ok(before.s<length-.02,'has not jumped to the endpoint before the pause');
  const turning=walkerKinematics({length,speed,pause,t:tOne+pause+.4});
  assert.equal(turning.turning,true);
  assert.equal(turning.moving,false);
  assert.ok(turning.turnBlend>0&&turning.turnBlend<1,'turn blend is in (0,1)');
  const after=walkerKinematics({length,speed,pause,t:tOne+pause+1.05+1.0});
  assert.equal(after.dir,-1);
  assert.ok(after.s<length-.2,'after the turn the walker reverses without jumping to the other end');
  assert.ok(after.s>length-2.5,'reverse walk starts from the same endpoint');
  let last=null;
  for(let t=0;t<tOne*2+pause*2+3;t+=.05){
    const kin=walkerKinematics({length,speed,pause,t});
    if(last){
      assert.ok(Math.abs(kin.s-last.s)<speed*.05+.08,`path distance jumped ${last.s} -> ${kin.s} at t=${t}`);
      const pose=walkerWorldPose({points:[[0,0],[length,0]],width:2.2,length},kin,0);
      const prev=walkerWorldPose({points:[[0,0],[length,0]],width:2.2,length},last,0);
      if(last.turning||kin.turning){
        assert.ok(Math.abs(deltaAngle(prev.yaw,pose.yaw))<1.05,`yaw flipped ${prev.yaw} -> ${pose.yaw} at t=${t}`);
      }
    }
    last=kin;
  }
}

{
  const route={points:[[0,0],[20,0]],width:2.2,length:20};
  const a=walkerKinematics({length:20,speed:.94,pause:1.2,phase:0,t:3});
  const b=walkerKinematics({length:20,speed:1.08,pause:1.8,phase:a.tLeg,t:3});
  const poseA=walkerWorldPose(route,a,0);
  const poseB=walkerWorldPose(route,b,1);
  assert.ok(Math.hypot(poseA.x-poseB.x,poseA.y-poseB.y)>=CHARACTER_RADIUS*2,'opposite-phase walkers stay apart');
  assert.ok(WALKER_SPEEDS.every(speed=>speed>=WALK_SPEED_MIN&&speed<=WALK_SPEED_MAX),'speeds stay in the requested band');
  assert.equal(new Set(WALKER_SPEEDS).size,WALKER_SPEEDS.length,'walkers do not share one cadence');
}

{
  const idle=walkBlend(0),mid=walkBlend(.14),cruise=walkBlend(1.05);
  assertAlmost(idle.Walk_Loop,0,1e-6,'stopped uses idle');
  assertAlmost(idle.Idle_Loop,1,1e-6,'stopped idle weight');
  assert.ok(mid.Walk_Loop>0&&mid.Walk_Loop<1&&Math.abs(mid.Walk_Loop+mid.Idle_Loop-1)<1e-6,'walk/idle crossfade');
  assert.ok(cruise.Walk_Loop>.98);
  const edge=talkBlend(5.36,0,5.2,0,.32);
  assert.ok(edge.Idle_Talking_Loop>0&&edge.Idle_Talking_Loop<1,'talk/idle eases at the boundary');
}

{
  assert.deepEqual(SOCIAL_SPECS[0].screens[0],[.40,.54]);
  assert.deepEqual(SOCIAL_SPECS[1].screen,[.416,.491]);
  assert.deepEqual(SOCIAL_SPECS[2].screen,[.45,.70]);
}

{
  const blocked={at:()=>1,coastDistance:()=>8,obstacles:[makeObb([0,0],[2,2],0,0,'house')],paths:[]};
  const miss=resolvePointCandidate('blocked',[0,0],blocked,{requireOffPath:false});
  assert.equal(miss.ok,false);
  assert.equal(miss.chosen,null);
}

{
  const world={
    ...flatWorld(),
    paths:[{name:'lane',width:2,points:[[0,0],[12,0]]}],
    obstacles:[makeCircle([6,0],.6,'stall')],
  };
  const pair=resolvePairCandidate('pair-a',[6,2],world);
  assert.equal(pair.ok,true);
  assertAlmost(Math.hypot(pair.people[0].xy[0]-pair.people[1].xy[0],pair.people[0].xy[1]-pair.people[1].xy[1]),FACE_SEPARATION,.05,'face-to-face spacing');
  const yawGap=Math.abs(wrapAngle(pair.people[0].yaw-pair.people[1].yaw));
  assertAlmost(yawGap,Math.PI,.08,'pair faces one another');
  for(const person of pair.people){
    assert.ok(pointIssues(...person.xy,world,{requireOffPath:true}).length===0,`${person.id} stays off the lane`);
  }
}

{
  const terrain=await geometryOnlyScene(terrainPath);
  const sampler=makeGroundSampler(terrain);
  const world={
    at:(x,y)=>sampler.at(x,y),
    coastDistance:(x,y)=>coastDistance(layout.coast,x,y),
    obstacles:layoutObstacles(layout,{cultivatedPlots:[]},null,null),
    paths:layout.paths,
  };
  const reports=WALKER_ROUTE_SPECS.map(spec=>{
    const prepared=prepareWalkerRoute(layout.paths,spec,world);
    assert.ok(prepared.points.length>=2,`${spec.name} produced no polyline`);
    assert.ok(prepared.length>=MIN_VALID_LENGTH,`${spec.name} usable length ${prepared.length}`);
    const samples=resamplePolyline(prepared.points,.25);
    for(const sample of samples){
      const inland=world.coastDistance(sample.x,sample.y);
      const slope=slopeDeg(world.at,sample.x,sample.y);
      assert.ok(inland>CHARACTER_RADIUS,`${spec.name} hits water at ${sample.x},${sample.y} inland=${inland}`);
      assert.ok(slope<=12.5,`${spec.name} slope ${slope.toFixed(2)}° at ${sample.x},${sample.y}`);
      for(const obstacle of world.obstacles){
        assert.equal(hitsObstacle(sample.x,sample.y,obstacle,CHARACTER_RADIUS),false,`${spec.name} crosses ${obstacle.id} at ${sample.x},${sample.y}`);
      }
    }
    const start=samples[0],end=samples.at(-1);
    assert.ok(Math.hypot(start.x-prepared.points[0][0],start.y-prepared.points[0][1])<1e-6);
    assert.ok(Math.hypot(end.x-prepared.points.at(-1)[0],end.y-prepared.points.at(-1)[1])<1e-6);
    return {name:prepared.name,length:Number(prepared.length.toFixed(3)),valid:prepared.valid,note:prepared.note,sourceValid:prepared.sourceValid,rejected:prepared.rejected.length,start:prepared.points[0],end:prepared.points.at(-1)};
  });
  const repoTmp=path.resolve(COMPLETION,'../../..','.tmp');
  fs.mkdirSync(repoTmp,{recursive:true});
  const marketRoute=prepareWalkerRoute(layout.paths,WALKER_ROUTE_SPECS.find(spec=>spec.name==='market_west'),world);
  assert.equal(marketRoute.valid,true,'trimmed market_west must revalidate');
  assert.ok(marketRoute.length>=30.5&&marketRoute.length<=31.5,`market_west trim should leave ~31m, got ${marketRoute.length}`);
  const a=layout.paths.find(p=>p.name==='market_west').points[0],b=layout.paths.find(p=>p.name==='market_west').points[1];
  const along=Math.hypot(b[0]-a[0],b[1]-a[1]),t=3/along;
  const expected=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  assert.ok(Math.hypot(marketRoute.points[0][0]-expected[0],marketRoute.points[0][1]-expected[1])<.08,`market_west start ${marketRoute.points[0]} vs ${expected}`);

  const camera=new THREE.PerspectiveCamera(config.camera.fov,1672/941,.15,10000);
  camera.position.fromArray(config.camera.position);camera.lookAt(...config.camera.target);camera.updateMatrixWorld(true);
  function solveScreen(screen){
    const ray=new THREE.Vector3(screen[0]*2-1,1-screen[1]*2,.5).unproject(camera).sub(camera.position).normalize();
    let lastT=.2,p=new THREE.Vector3();
    const clearance=t=>{p.copy(camera.position).addScaledVector(ray,t);return p.y-(sampler.at(p.x,-p.z)??-.6);};
    for(let t=.5;t<900;t+=.7){if(clearance(t)<=0){let lo=lastT,hi=t;for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(clearance(mid)>0)lo=mid;else hi=mid;}clearance((lo+hi)/2);return[p.x,-p.z];}lastT=t;}
    throw new Error(`no terrain ${screen}`);
  }
  const people=[];
  WALKER_ROUTE_SPECS.forEach((spec,routeIndex)=>{
    const route=prepareWalkerRoute(layout.paths,spec,world);
    assert.equal(route.valid,true,`${spec.name} invalid after trim`);
    for(const lane of [0,1]){
      const speed=WALKER_SPEEDS[routeIndex*2+lane],pause=WALKER_PAUSES[routeIndex*2+lane];
      const probe=walkerKinematics({length:route.length,speed,pause,t:0});
      people.push({id:`walker-${route.name}-${lane}`,role:'walker',route,lane,speed,pause,phase:lane?probe.tLeg:routeIndex*.37});
    }
  });
  for(const spec of SOCIAL_SPECS){
    if(spec.role==='pair'){
      const screens=spec.screens??[spec.screen];
      let picked=null;
      for(const screen of screens){
        const resolved=resolvePairCandidate(spec.id,solveScreen(screen),world);
        if(resolved.ok){picked=resolved;break;}
      }
      assert.ok(picked?.ok,`${spec.id} has no valid standing`);
      picked.people.forEach((person,index)=>people.push({id:person.id,role:'talk',xy:person.xy}));
    }else if(spec.role==='observer'){
      const resolved=resolvePointCandidate(spec.id,solveScreen(spec.screen),world,{requireOffPath:true});
      assert.equal(resolved.ok,true,'observer invalid');
      people.push({id:spec.id,role:'observer',xy:resolved.chosen});
    }else{
      const endpoint=namedPath(layout.paths,spec.path).points.at(-1);
      const resolved=resolvePointCandidate(spec.id,endpoint,world,{requireOffPath:true});
      assert.equal(resolved.ok,true,`worker invalid: ${resolved.reasons}`);
      people.push({id:spec.id,role:'worker',xy:resolved.chosen});
    }
  }
  assert.equal(people.length,12);
  function poseOf(actor,t){
    if(actor.role!=='walker')return {x:actor.xy[0],y:actor.xy[1]};
    const kin=walkerKinematics({length:actor.route.length,speed:actor.speed,pause:actor.pause,phase:actor.phase,t});
    const pose=walkerWorldPose(actor.route,kin,actor.lane);
    return {x:pose.x,y:pose.y};
  }
  let minSep=Infinity,maxSpeed=0,worst=null,jump=null;
  let prev=people.map(actor=>poseOf(actor,0));
  for(let t=.1;t<=180.0001;t+=.1){
    const now=people.map(actor=>poseOf(actor,t));
    for(let i=0;i<now.length;i++){
      const speed=Math.hypot(now[i].x-prev[i].x,now[i].y-prev[i].y)/.1;
      if(speed>maxSpeed){maxSpeed=speed;jump={t,id:people[i].id,speed};}
      for(let j=i+1;j<now.length;j++){
        const dist=Math.hypot(now[i].x-now[j].x,now[i].y-now[j].y);
        if(dist<minSep){minSep=dist;worst={t,a:people[i].id,b:people[j].id,dist};}
      }
    }
    prev=now;
  }
  const soak={minSep,maxSpeed,worst,jump,routes:reports,count:people.length};
  fs.writeFileSync(path.join(repoTmp,'ubc-actor-soak.json'),JSON.stringify(soak,null,2));
  function cornerContinuity(route,s,eps){
    const lo=tangentAt(route.points,s-eps),hi=tangentAt(route.points,s+eps),mid=tangentAt(route.points,s);
    const yaw=Math.abs(deltaAngle(yawFromGroundDelta(lo.sx,lo.sy),yawFromGroundDelta(hi.sx,hi.sy)))*180/Math.PI;
    const kin=dir=>({s:dir,dir:1,turning:false,turnBlend:0,vel:1,moving:true});
    const pa=walkerWorldPose(route,kin(s-eps),0),pb=walkerWorldPose(route,kin(s+eps),0),pc=walkerWorldPose(route,kin(s),0);
    return {yaw,pos:Math.hypot(pa.x-pb.x,pa.y-pb.y),midYaw:Math.abs(deltaAngle(yawFromGroundDelta(lo.sx,lo.sy),yawFromGroundDelta(mid.sx,mid.sy)))*180/Math.PI,lane:Math.hypot(pa.x-pc.x,pa.y-pc.y)};
  }
  const fixtures=[{name:'market_west',s:16.260887292183117},{name:'lower_loop',s:3.9172196770888825}];
  for(const fixture of fixtures){
    const route=prepareWalkerRoute(layout.paths,WALKER_ROUTE_SPECS.find(spec=>spec.name===fixture.name),world);
    const lengths=cumulativeLengths(route.points);
    assert.ok(lengths.some(s=>Math.abs(s-fixture.s)<.02),`${fixture.name} fixture s=${fixture.s} is not a corner of the loaded route ${lengths}`);
    const coarse=cornerContinuity(route,fixture.s,1e-4),fine=cornerContinuity(route,fixture.s,1e-5);
    assert.ok(fine.yaw<coarse.yaw*1.05+1e-6,`${fixture.name} yaw jump did not shrink with epsilon (${coarse.yaw} -> ${fine.yaw})`);
    assert.ok(fine.pos<coarse.pos*1.05+1e-9,`${fixture.name} lane/position jump did not shrink with epsilon`);
    assert.ok(fine.yaw<0.05,`${fixture.name} heading still jumps ${fine.yaw}° at s±1e-5`);
    assert.ok(fine.pos<1e-3,`${fixture.name} pose jump ${fine.pos} m at s±1e-5`);
    assert.ok(fine.midYaw<0.05,`${fixture.name} left side disagrees with vertex blend by ${fine.midYaw}°`);
  }
  assert.ok(minSep>=MIN_ACTOR_SEPARATION,`min separation ${minSep} at t=${worst?.t} ${worst?.a} vs ${worst?.b}`);
  assert.ok(maxSpeed<=2.5,`motion jump ${maxSpeed} m/s at t=${jump?.t} ${jump?.id}`);
  console.log('soak',JSON.stringify({minSep,maxSpeed,worst,jump}));
  fs.writeFileSync(path.join(repoTmp,'ubc-route-diagnostics.json'),JSON.stringify(reports,null,2));
  console.log('routes',JSON.stringify(reports));
}

{
  assert.equal(fs.existsSync(assetPath),true,'derived UBC GLB is missing; run scripts/prepare_ubc_village.py');
  const bytes=fs.statSync(assetPath).size;
  assert.ok(bytes>50_000&&bytes<22_602_092,'derived UBC should be smaller than the 22.6MB source and not empty');
  const input=fs.readFileSync(assetPath);
  const jsonSize=input.readUInt32LE(12);
  const doc=JSON.parse(input.subarray(20,20+jsonSize).toString().trim());
  const names=(doc.animations??[]).map(item=>item.name);
  for(const clip of REQUIRED_CLIPS)assert.ok(names.includes(clip),`derived GLB missing ${clip}`);
  assert.equal(names.length,REQUIRED_CLIPS.length,'derived GLB should keep only village clips');
  assert.equal((doc.skins??[]).length,1);
  delete doc.images;delete doc.textures;delete doc.samplers;delete doc.materials;
  for(const mesh of doc.meshes)for(const primitive of mesh.primitives)delete primitive.material;
  const text=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(json);
  const tail=input.subarray(20+jsonSize),buffer=Buffer.alloc(20+json.length+tail.length);
  buffer.write('glTF');buffer.writeUInt32LE(2,4);buffer.writeUInt32LE(buffer.length,8);buffer.writeUInt32LE(json.length,12);buffer.writeUInt32LE(0x4e4f534a,16);json.copy(buffer,20);tail.copy(buffer,20+json.length);
  const gltf=await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.length),'');
  const loadedNames=gltf.animations.map(clip=>clip.name);
  for(const clip of REQUIRED_CLIPS)assert.ok(loadedNames.includes(clip),`loader missing ${clip}`);
  const a=cloneSkeleton(gltf.scene),b=cloneSkeleton(gltf.scene);
  const skelA=a.getObjectByProperty('isSkinnedMesh',true).skeleton;
  const skelB=b.getObjectByProperty('isSkinnedMesh',true).skeleton;
  assert.notEqual(skelA,skelB,'clones must not share a skeleton');
  assert.notEqual(skelA.bones[0],skelB.bones[0]);
  const rest=skelB.bones[0].position.clone();
  skelA.bones[0].position.x+=.35;
  assert.equal(skelB.bones[0].position.x,rest.x,'moving one clone must not move the other');
  const geoA=a.getObjectByProperty('isSkinnedMesh',true).geometry;
  const geoB=b.getObjectByProperty('isSkinnedMesh',true).geometry;
  assert.equal(geoA,geoB,'geometry stays shared');
  console.log(`PASS: UBC asset ${bytes} bytes, clips ${loadedNames.join(',')}, independent skeletons`);
}

console.log('PASS: villager routes, kinematics, social clearance, and UBC asset smoke');
