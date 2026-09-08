import {pathDistance} from './random.js';
import {plotContains} from './crops.js';

export const CHARACTER_RADIUS=0.32;
export const ADULT_HEIGHT=1.78;
export const MAX_SLOPE_DEG=12;
export const SAMPLE_SPACING=0.25;
export const MIN_VALID_LENGTH=4;
export const FACE_SEPARATION=1.25;
export const SOCIAL_SEARCH_RADIUS=1.5;
export const MIN_ACTOR_SEPARATION=CHARACTER_RADIUS*2+0.1;
export const WALK_SPEED_MIN=0.9;
export const WALK_SPEED_MAX=1.15;
export const ACCEL_DISTANCE=0.7;
export const TURN_DURATION=1.05;
export const CORNER_BLEND=0.65;
export const REQUIRED_CLIPS=['Walk_Loop','Idle_Loop','Idle_Talking_Loop','Fixing_Kneeling'];
export const UBC_ASSET_URL='/assets/ubc/ubc-male-ual-village.glb';
export const SLOPE_SAMPLE=0.7;
export const COAST_MARGIN=0.45;
export const SITE_PADDING=0.45;
export const PATH_BAND_FACTOR=0.65;

export const WALKER_ROUTE_SPECS=[
  {name:'lower_loop'},
  {name:'market_west',trimStart:3},
  {name:'western_lane',vertices:[2,5]},
];

export const SOCIAL_SPECS=[
  {id:'pair-a',role:'pair',screens:[[.40,.54],[.55,.55]]},
  {id:'pair-b',role:'pair',screen:[.416,.491]},
  {id:'observer',role:'observer',screen:[.45,.70]},
  {id:'worker',role:'worker',path:'workshop_approach'},
];
export const CLIP_FADE=0.32;

export const WALKER_SPEEDS=[.94,1.06,.97,1.12,.91,1.14];
export const WALKER_PAUSES=[1.15,1.85,1.35,2.05,1.55,1.75];

const TAU=Math.PI*2;

export function wrapAngle(a){
  const x=a%TAU;return x<=-Math.PI?x+TAU:x>Math.PI?x-TAU:x;
}
export function deltaAngle(from,to){return wrapAngle(to-from);}
export function lerpAngle(from,to,t){return wrapAngle(from+deltaAngle(from,to)*t);}
export function yawFromGroundDelta(dx,dy){return Math.atan2(dx,-dy);}

export function hypot2(ax,ay,bx,by){return Math.hypot(ax-bx,ay-by);}

export function polylineLength(points){
  let length=0;
  for(let i=1;i<points.length;i++)length+=hypot2(...points[i-1],...points[i]);
  return length;
}

export function cumulativeLengths(points){
  const lengths=[0];
  for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+hypot2(...points[i-1],...points[i]));
  return lengths;
}

export function sliceVertices(points,range){
  if(!range)return points.map(p=>[p[0],p[1]]);
  const [lo,hi]=range;
  if(lo<0||hi>=points.length||hi-lo<1)throw new Error(`Path vertex range ${lo}–${hi} is not valid for ${points.length} points`);
  return points.slice(lo,hi+1).map(p=>[p[0],p[1]]);
}

export function namedPath(paths,name){
  const route=paths.find(item=>item.name===name);
  if(!route)throw new Error(`Expected world path ${name} is missing`);
  return route;
}

export function walkerPathPoints(paths,spec){
  const route=namedPath(paths,spec.name);
  return {name:route.name,width:route.width,points:sliceVertices(route.points,spec.vertices)};
}

export function samplePolyline(points,distance){
  const lengths=cumulativeLengths(points);
  const total=lengths.at(-1);
  const s=Math.max(0,Math.min(total,distance));
  let i=1;
  while(i<lengths.length-1&&lengths[i]<s)i++;
  const span=lengths[i]-lengths[i-1]||1;
  const t=(s-lengths[i-1])/span;
  const a=points[i-1],b=points[i];
  const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;
  return {x:a[0]+dx*t,y:a[1]+dy*t,sx:dx/len,sy:dy/len,segment:i-1,s,length:total};
}

export function tangentAt(points,distance,blend=CORNER_BLEND){
  const lengths=cumulativeLengths(points);
  const total=lengths.at(-1);
  const s=Math.max(0,Math.min(total,distance));
  const raw=samplePolyline(points,s);
  if(blend<=0||points.length<3)return raw;
  for(let i=1;i<points.length-1;i++){
    const corner=lengths[i];
    const a=points[i-1],b=points[i],c=points[i+1];
    const inLen=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
    const outLen=Math.hypot(c[0]-b[0],c[1]-b[1])||1;
    const window=Math.min(blend,inLen*.5,outLen*.5);
    if(window<=1e-9||s<corner-window||s>corner+window)continue;
    const ix=(b[0]-a[0])/inLen,iy=(b[1]-a[1])/inLen;
    const ox=(c[0]-b[0])/outLen,oy=(c[1]-b[1])/outLen;
    const u=smooth((s-(corner-window))/(2*window));
    const sx=ix+(ox-ix)*u,sy=iy+(oy-iy)*u,len=Math.hypot(sx,sy)||1;
    return {...raw,sx:sx/len,sy:sy/len};
  }
  return raw;
}

export function resamplePolyline(points,spacing=SAMPLE_SPACING){
  const total=polylineLength(points);
  const samples=[];
  for(let s=0;s<=total;s+=spacing)samples.push(samplePolyline(points,Math.min(total,s)));
  if(samples.at(-1).s<total-1e-6)samples.push(samplePolyline(points,total));
  return samples;
}

export function slopeDeg(at,x,y,delta=SLOPE_SAMPLE){
  const h=at(x,y),hx=at(x+delta,y),hy=at(x,y+delta);
  if(![h,hx,hy].every(Number.isFinite))return Infinity;
  return Math.atan(Math.hypot(hx-h,hy-h)/delta)*180/Math.PI;
}

export function makeObb(xy,halfExtents,yaw,padding=0,id='obb'){
  return {type:'obb',id,xy:[xy[0],xy[1]],half:[halfExtents[0]+padding,halfExtents[1]+padding],yaw,c:Math.cos(yaw),s:Math.sin(yaw)};
}

export function makeCircle(xy,radius,id='circle'){
  return {type:'circle',id,xy:[xy[0],xy[1]],radius};
}

export function hitsObb(x,y,obb,radius=0){
  const dx=x-obb.xy[0],dy=y-obb.xy[1];
  return Math.abs(obb.c*dx+obb.s*dy)<obb.half[0]+radius&&Math.abs(-obb.s*dx+obb.c*dy)<obb.half[1]+radius;
}

export function hitsCircle(x,y,circle,radius=0){
  return hypot2(x,y,...circle.xy)<circle.radius+radius;
}

export function hitsPlot(x,y,plot,radius=0){
  return plotContains(plot,x,y,radius);
}

export function hitsObstacle(x,y,obstacle,radius=CHARACTER_RADIUS){
  if(obstacle.type==='obb')return hitsObb(x,y,obstacle,radius);
  if(obstacle.type==='circle')return hitsCircle(x,y,obstacle,radius);
  if(obstacle.type==='plot')return hitsPlot(x,y,obstacle.plot,radius+(obstacle.margin??0));
  return false;
}

export function layoutObstacles(layout,config,activity,surroundings){
  const obstacles=[];
  for(const [index,site] of (layout.graded_sites??[]).entries()){
    obstacles.push(makeObb(site.xy,site.half_extents,site.yaw,SITE_PADDING,site.id??`graded-site-${index}`));
  }
  for(const plot of config.cultivatedPlots??[])obstacles.push({type:'plot',id:plot.id,plot,margin:.15});
  const radii={stall_cream:1.35,stall_blue:1.35,stall_red:1.35,stall_small:1.05,cart:1.05,bench:.72,table:.95,barrel:.42,crate:.45,produce_crate:.45,sack:.4,fire_ring:1.55,log_stack:1.15,garden_shed:1.7,work_tools:.55,wood_tub:.5,clay_jugs:.45};
  for(const item of [...(activity?.placements??[]),...(surroundings?.placements??[])]){
    obstacles.push(makeCircle(item.xy,radii[item.name]??.5,item.name));
  }
  if(activity?.fireXY)obstacles.push(makeCircle(activity.fireXY,1.65,'fire'));
  return obstacles;
}

export function classifySolidName(name=''){
  if(/continuousground|hinterland|water|ocean|sky|blade|grass|fern|flower|crown|trunk|leaf|canopy|shrub|smoke|fire volume|reflection/i.test(name))return 'ignored';
  if(/cottage|landmark|workshop|stall|cart|bench|table|barrel|crate|sack|timber fence|garden_shed|log_stack|outcrop|granite|strata|stone|rock/i.test(name))return 'solid';
  return 'unknown';
}

export function collectSceneSolids(scene){
  const extras=[],unhandled=[];
  if(!scene?.traverse)return {extras,unhandled};
  scene.traverse(object=>{
    const name=object.name||'';
    const kind=classifySolidName(name);
    if(kind==='ignored'||!name)return;
    if(object.isInstancedMesh&&object.count&&object.instanceMatrix){
      if(!/stone|granite|outcrop|strata|timber fence|rock/i.test(name)){
        if(kind==='unknown')unhandled.push({name,kind:'instanced',count:object.count});
        return;
      }
      if(!object.geometry.boundingBox)object.geometry.computeBoundingBox?.();
      const box=object.geometry.boundingBox;
      const gx=box?Math.abs(box.max.x-box.min.x)*.5:.5;
      const gz=box?Math.abs(box.max.z-box.min.z)*.5:.5;
      const array=object.instanceMatrix.array;
      for(let i=0;i<object.count;i++){
        const o=i*16;
        const x=array[o+12],z=array[o+14],sx=Math.hypot(array[o],array[o+1],array[o+2]),sz=Math.hypot(array[o+8],array[o+9],array[o+10]);
        const radius=Math.max(sx*gx,sz*gz)*.9;
        if(radius<.55)continue;
        extras.push(makeCircle([x,-z],Math.min(radius,3.2),`${name}:${i}`));
      }
      return;
    }
    if(!object.isMesh)return;
    if(kind==='unknown'){
      unhandled.push({name,kind:'mesh'});
      return;
    }
    if(!object.geometry)return;
    if(!object.geometry.boundingBox)object.geometry.computeBoundingBox?.();
    const box=object.geometry.boundingBox;
    if(!box)return;
    object.updateWorldMatrix?.(true,false);
    const m=object.matrixWorld?.elements;
    if(!m)return;
    const width=Math.abs(box.max.x-box.min.x)*Math.hypot(m[0],m[1],m[2]);
    const depth=Math.abs(box.max.z-box.min.z)*Math.hypot(m[8],m[9],m[10]);
    if(width>22||depth>22||width<.4||depth<.4)return;
    const x=m[12],z=m[14];
    extras.push(makeCircle([x,-z],Math.min(Math.max(width,depth)*.45,4),name));
  });
  return {extras,unhandled};
}

export function pointIssues(x,y,world,{radius=CHARACTER_RADIUS,requireOffPath=false,maxSlope=MAX_SLOPE_DEG}={}){
  const reasons=[];
  const at=world.at,coastDistance=world.coastDistance,obstacles=world.obstacles??[],paths=world.paths??[];
  const height=at?.(x,y);
  if(!Number.isFinite(height))reasons.push('no-terrain');
  else if(height<0.02)reasons.push(`height:${height.toFixed(3)}`);
  if(coastDistance){
    const inland=coastDistance(x,y);
    if(inland<COAST_MARGIN+radius)reasons.push(`coast:${inland.toFixed(3)}`);
  }
  const slope=world.at?slopeDeg(world.at,x,y):0;
  if(Number.isFinite(maxSlope)&&slope>maxSlope)reasons.push(`slope:${slope.toFixed(1)}`);
  for(const obstacle of obstacles){
    if(hitsObstacle(x,y,obstacle,radius))reasons.push(`obstacle:${obstacle.id}`);
  }
  if(requireOffPath&&paths.length){
    const band=pathDistance(x,y,paths);
    if(band<radius+.08)reasons.push(`path-band:${band.toFixed(3)}`);
  }
  return reasons;
}

export function pointClear(x,y,world,options){return pointIssues(x,y,world,options).length===0;}

export function validatePath(points,world,{radius=CHARACTER_RADIUS,spacing=SAMPLE_SPACING,clearanceWidth}={}){
  const total=polylineLength(points);
  const samples=resamplePolyline(points,spacing);
  const width=clearanceWidth??0;
  const flags=samples.map(sample=>{
    const reasons=pointIssues(sample.x,sample.y,world,{radius});
    if(width>0){
      const nx=-sample.sy,ny=sample.sx;
      const half=Math.max(0,width/2-radius);
      for(const side of [-half,half]){
        reasons.push(...pointIssues(sample.x+nx*side,sample.y+ny*side,world,{radius}).map(reason=>`shoulder:${reason}`));
      }
    }
    return {s:sample.s,x:sample.x,y:sample.y,ok:reasons.length===0,reasons:[...new Set(reasons)]};
  });
  const spans=[];
  let start=null;
  const flush=(endIndex)=>{
    if(start===null)return;
    const a=flags[start],b=flags[endIndex];
    spans.push({start:a.s,end:b.s,length:b.s-a.s,ok:a.ok});
    start=null;
  };
  for(let i=0;i<flags.length;i++){
    const ok=flags[i].ok;
    if(start===null){start=i;continue;}
    if(ok!==flags[start].ok){flush(i-1);start=i;}
  }
  flush(flags.length-1);
  const valid=spans.filter(span=>span.ok);
  const longest=valid.reduce((best,span)=>span.length>(best?.length??-1)?span:best,null);
  return {
    length:total,
    valid:!!longest&&longest.start<=1e-6&&longest.end>=total-1e-6,
    samples:flags,
    spans,
    longestValid:longest,
    usable:longest&&longest.length>=MIN_VALID_LENGTH?longest:null,
  };
}

export function pathFromSpan(points,span){
  if(!span)return [];
  const lengths=cumulativeLengths(points);
  const sliced=[];
  sliced.push([samplePolyline(points,span.start).x,samplePolyline(points,span.start).y]);
  for(let i=0;i<points.length;i++){
    if(lengths[i]>span.start+1e-4&&lengths[i]<span.end-1e-4)sliced.push([points[i][0],points[i][1]]);
  }
  const end=samplePolyline(points,span.end);
  if(hypot2(sliced.at(-1)[0],sliced.at(-1)[1],end.x,end.y)>1e-4)sliced.push([end.x,end.y]);
  return sliced;
}

export function prepareWalkerRoute(paths,spec,world){
  const source=walkerPathPoints(paths,spec);
  const clearanceWidth=source.width;
  const report=validatePath(source.points,world,{radius:CHARACTER_RADIUS,clearanceWidth});
  let points=source.points,used=report,note='full';
  if(!report.valid){
    if(!report.usable){
      return {name:source.name,width:source.width,points:[],length:0,valid:false,reason:'no-safe-segment',report};
    }
    points=pathFromSpan(source.points,report.usable);
    used=validatePath(points,world,{radius:CHARACTER_RADIUS,clearanceWidth});
    note=`longest-valid:${report.usable.length.toFixed(2)}m`;
  }
  if(spec.trimStart>0){
    const total=polylineLength(points);
    if(total-spec.trimStart<MIN_VALID_LENGTH){
      return {name:source.name,width:source.width,points:[],length:0,valid:false,reason:`trim-start:${spec.trimStart} left <${MIN_VALID_LENGTH}m`,report:used,sourceLength:polylineLength(source.points),sourceValid:report.valid,rejected:used.samples.filter(sample=>!sample.ok).slice(0,12)};
    }
    points=pathFromSpan(points,{start:spec.trimStart,end:total});
    used=validatePath(points,world,{radius:CHARACTER_RADIUS,clearanceWidth});
    note=`${note};trim-start:${spec.trimStart}`;
    if(!used.valid){
      return {name:source.name,width:source.width,points:[],length:0,valid:false,reason:'trim-start-unsafe',report:used,sourceLength:polylineLength(source.points),sourceValid:report.valid,rejected:used.samples.filter(sample=>!sample.ok).slice(0,12)};
    }
  }
  return {
    name:source.name,
    width:source.width,
    points,
    length:polylineLength(points),
    valid:used.valid&&polylineLength(points)>=MIN_VALID_LENGTH,
    note,
    report:used,
    sourceLength:polylineLength(source.points),
    sourceValid:report.valid,
    rejected:report.samples.filter(sample=>!sample.ok).slice(0,12),
  };
}

export function laneOffsetFor(width,index,dir,mode){
  const maxOffset=Math.max(0,width*PATH_BAND_FACTOR-CHARACTER_RADIUS-.08);
  const offset=Math.min(.38,maxOffset);
  if(offset<.16)return 0;
  if(mode==='assigned')return index===0?-offset:offset;
  return dir>=0?offset:-offset;
}

export function trapezoidTravel(time,length,speed,accelDistance=ACCEL_DISTANCE){
  const dAcc=Math.min(accelDistance,length/3);
  const cruise=Math.max(0,length-2*dAcc);
  const tAcc=speed>0?2*dAcc/speed:0;
  const tCruise=speed>0?cruise/speed:0;
  const tOne=tAcc+tCruise+tAcc;
  const t=Math.max(0,Math.min(tOne,time));
  const a=tAcc>0?speed/tAcc:0;
  let dist,vel;
  if(t<=tAcc){dist=.5*a*t*t;vel=a*t;}
  else if(t<=tAcc+tCruise){dist=dAcc+speed*(t-tAcc);vel=speed;}
  else{
    const u=t-(tAcc+tCruise);
    dist=dAcc+cruise+speed*u-.5*a*u*u;
    vel=Math.max(0,speed-a*u);
  }
  return {dist:Math.max(0,Math.min(length,dist)),vel,tOne,dAcc,tAcc,tCruise};
}

export function walkerKinematics({length,speed,pause=1.4,turnDuration=TURN_DURATION,phase=0,accelDistance=ACCEL_DISTANCE,t}){
  if(length<=0||speed<=0)return {s:0,vel:0,dir:1,moving:false,turning:false,paused:true,turnBlend:0,traveled:0,leg:'idle'};
  const tOne=trapezoidTravel(0,length,speed,accelDistance).tOne;
  const tLeg=tOne+pause+turnDuration;
  const cycle=2*tLeg;
  let tau=(t+phase)%cycle;if(tau<0)tau+=cycle;
  const forward=tau<tLeg;
  const local=forward?tau:tau-tLeg;
  const dir=forward?1:-1;
  let s,vel=0,moving=false,turning=false,paused=false,turnBlend=0,leg='walk';
  if(local<tOne){
    const travel=trapezoidTravel(local,length,speed,accelDistance);
    s=forward?travel.dist:length-travel.dist;
    vel=travel.vel*dir;
    moving=travel.vel>.03;
  }else if(local<tOne+pause){
    s=forward?length:0;paused=true;leg='pause';
  }else{
    s=forward?length:0;turning=true;leg='turn';
    turnBlend=Math.max(0,Math.min(1,(local-tOne-pause)/turnDuration));
  }
  const completed=Math.floor((t+phase)/tLeg);
  const onLeg=local<tOne?trapezoidTravel(local,length,speed,accelDistance).dist:length;
  const traveled=Math.max(0,completed)*length+onLeg;
  return {s,vel,dir,moving,turning,paused,turnBlend,traveled,leg,cycle,tLeg,tau};
}

export function walkerWorldPose(route,kinematics,index){
  const sample=tangentAt(route.points,kinematics.s);
  const offset=laneOffsetFor(route.width,index,kinematics.dir,'assigned');
  const nx=-sample.sy,ny=sample.sx;
  const walkYaw=yawFromGroundDelta(sample.sx*kinematics.dir,sample.sy*kinematics.dir);
  let yaw=walkYaw;
  if(kinematics.turning){
    const reverse=yawFromGroundDelta(-sample.sx*kinematics.dir,-sample.sy*kinematics.dir);
    yaw=lerpAngle(walkYaw,reverse,smooth(kinematics.turnBlend));
  }
  return {
    x:sample.x+nx*offset,
    y:sample.y+ny*offset,
    yaw,
    sx:sample.sx,
    sy:sample.sy,
    offset,
    mode:'assigned',
    terrainHint:[sample.x,sample.y],
  };
}

export function smooth(t){return t*t*(3-2*t);}

export function walkBlend(speed,band=.22){
  const u=smooth(Math.max(0,Math.min(1,(Math.abs(speed)-.03)/band)));
  return {Walk_Loop:u,Idle_Loop:1-u};
}

export function talkBlend(t,index,period=5.2,stagger=1.7,fade=CLIP_FADE){
  const span=period*2,local=(((t+index*stagger)%span)+span)%span;
  let talk=0;
  if(local<fade)talk=smooth(local/fade);
  else if(local<period)talk=1;
  else if(local<period+fade)talk=1-smooth((local-period)/fade);
  return {Idle_Talking_Loop:talk,Idle_Loop:1-talk};
}

export function nearestPathInfo(x,y,paths){
  let best=null;
  for(const route of paths){
    for(let i=1;i<route.points.length;i++){
      const a=route.points[i-1],b=route.points[i],dx=b[0]-a[0],dy=b[1]-a[1],span=dx*dx+dy*dy||1;
      const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/span));
      const px=a[0]+dx*t,py=a[1]+dy*t,dist=Math.hypot(x-px,y-py);
      if(!best||dist<best.dist)best={name:route.name,dist,x:px,y:py,sx:dx/Math.hypot(dx,dy),sy:dy/Math.hypot(dx,dy),width:route.width};
    }
  }
  return best;
}

function spiralOffsets(radius=SOCIAL_SEARCH_RADIUS,step=.25){
  const offsets=[[0,0]];
  for(let r=step;r<=radius+1e-6;r+=step){
    const n=Math.max(8,Math.round(TAU*r/step));
    for(let i=0;i<n;i++){
      const a=i*TAU/n;
      offsets.push([Math.cos(a)*r,Math.sin(a)*r]);
    }
  }
  return offsets;
}

export function resolvePointCandidate(id,anchor,world,options={}){
  const rejected=[];
  const issueOptions={radius:options.radiusActor??CHARACTER_RADIUS,requireOffPath:options.requireOffPath??true,maxSlope:options.maxSlope??MAX_SLOPE_DEG};
  for(const [dx,dy] of spiralOffsets(options.radius??SOCIAL_SEARCH_RADIUS)){
    const x=anchor[0]+dx,y=anchor[1]+dy;
    const reasons=pointIssues(x,y,world,issueOptions);
    const candidate={id,xy:[x,y],offset:[dx,dy],reasons,ok:!reasons.length,distance:Math.hypot(dx,dy)};
    if(!reasons.length)return {id,anchor:[anchor[0],anchor[1]],chosen:candidate.xy,offset:candidate.offset,ok:true,reasons:[],rejected};
    if(rejected.length<24)rejected.push(candidate);
  }
  return {id,anchor:[anchor[0],anchor[1]],chosen:null,offset:[0,0],ok:false,reasons:rejected[0]?.reasons??['no-clearance'],rejected};
}

export function resolvePairCandidate(id,center,world){
  const centerHit=resolvePointCandidate(`${id}-center`,center,world,{requireOffPath:true,maxSlope:MAX_SLOPE_DEG});
  const origin=centerHit.ok?centerHit.chosen:center;
  const near=nearestPathInfo(origin[0],origin[1],world.paths??[]);
  const axes=[];
  if(near)axes.push([-near.sy,near.sx],[near.sx,near.sy]);
  for(let i=0;i<12;i++){const a=i*Math.PI/6;axes.push([Math.cos(a),Math.sin(a)]);}
  const rejected=[];
  const issueOptions={requireOffPath:true,maxSlope:MAX_SLOPE_DEG};
  for(const axis of axes){
    const len=Math.hypot(axis[0],axis[1])||1;
    const ux=axis[0]/len,uy=axis[1]/len;
    const half=FACE_SEPARATION/2;
    const a=[origin[0]-ux*half,origin[1]-uy*half];
    const b=[origin[0]+ux*half,origin[1]+uy*half];
    const ra=pointIssues(...a,world,issueOptions);
    const rb=pointIssues(...b,world,issueOptions);
    const reasons=[...ra.map(r=>`a:${r}`),...rb.map(r=>`b:${r}`)];
    if(!reasons.length){
      const yawA=yawFromGroundDelta(b[0]-a[0],b[1]-a[1]);
      return {id,ok:true,center:origin,anchor:center,people:[{id:`${id}-0`,xy:a,yaw:yawA},{id:`${id}-1`,xy:b,yaw:wrapAngle(yawA+Math.PI)}],reasons:[],rejected,centerOk:centerHit.ok};
    }
    rejected.push({axis:[ux,uy],a,b,reasons});
  }
  return {id,ok:false,center:origin,anchor:center,people:[],reasons:rejected[0]?.reasons??['pair-clearance'],rejected,centerOk:centerHit.ok};
}

export function observerBlend(t,period=8.4,hold=2.2,phase=.6,fade=CLIP_FADE){
  const local=(((t+phase)%period)+period)%period;
  let talk=0;
  if(local<fade)talk=smooth(local/fade);
  else if(local<hold)talk=1;
  else if(local<hold+fade)talk=1-smooth((local-hold)/fade);
  return {Idle_Talking_Loop:talk,Idle_Loop:1-talk};
}

export function workerPhase(t,clipDuration=5.2){
  const duration=clipDuration||5.2;
  return {clip:'Fixing_Kneeling',clipTime:((t%duration)+duration)%duration,playing:true,stationary:true};
}
