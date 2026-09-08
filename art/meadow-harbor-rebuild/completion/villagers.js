import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {batchStaticModel} from './optimize.js';
import {random} from './random.js';

export async function addVillagers(scene,loader,sampler,camera,solveScreen,activity,maritime,config){
  const kit=(await loader.loadAsync('/assets/packed/villagers-r01.glb')).scene;kit.updateMatrixWorld(true);
  const names=['man_stand','man_walk','man_carry','worker','woman_stand','woman_walk','woman_carry','seated'];
  const templates=Object.fromEntries(names.map(n=>[n,batchStaticModel(kit.getObjectByName(`PROP_${n}`))]));
  const rng=random(6817),parts=[],placements=[],dummy=new THREE.Object3D();
  const tunics=['#b5a27d','#967044','#576c73','#ac9d7e','#7d4935','#7a7d51','#c4bba1'];
  const bottoms=['#455860','#68543a','#78848a','#504a39','#314b59'];
  function place(pose,xy,yaw,scale,groundOverride,group='background'){
    const ground=groundOverride??sampler.at(...xy),template=templates[pose],shirt=new THREE.Color(tunics[Math.floor(rng()*tunics.length)]),bottom=new THREE.Color(bottoms[Math.floor(rng()*bottoms.length)]),skin=new THREE.Color('#ba8960').multiplyScalar(.79+rng()*.29);
    dummy.position.set(xy[0],ground,-xy[1]);dummy.rotation.set(0,yaw,0);dummy.scale.setScalar(scale);dummy.updateMatrix();
    for(const o of template.children){
      const g=o.geometry.clone();g.applyMatrix4(dummy.matrix);
      for(const key of Object.keys(g.attributes))if(!['position','normal'].includes(key))g.deleteAttribute(key);
      const color=o.material.name.includes('Tunic')?shirt:o.material.name.includes('Trousers')?bottom:o.material.name.includes('Skin')?skin:o.material.color;
      const values=new Float32Array(g.attributes.position.count*3);for(let i=0;i<values.length;i+=3){values[i]=color.r;values[i+1]=color.g;values[i+2]=color.b;}
      g.setAttribute('color',new THREE.BufferAttribute(values,3));parts.push(g);
    }
    placements.push({pose,xy,yaw,scale,height:ground,group});
  }
  const [fx,fy]=activity.fireXY;
  for(const bench of activity.placements.filter(p=>p.name==='bench')){
    // Exported people face +Z. Convert the ground's XY direction to XZ once.
    const dx=fx-bench.xy[0],dy=fy-bench.xy[1],yaw=Math.atan2(dx,-dy);
    for(const offset of [-.38,.38])place('seated',[bench.xy[0]+Math.cos(yaw)*offset,bench.xy[1]+Math.sin(yaw)*offset],yaw,offset<0?.95:.89,undefined,'seated');
  }
  for(const [pose,sx,sy,yaw]of [['man_carry',.580,.847,1.2],['woman_stand',.631,.812,1],['man_stand',.641,.797,3],['man_carry',.684,.801,1.3],['man_stand',.711,.811,4],['woman_walk',.750,.843,1.7]]){
    const p=maritime.plane([sx,sy],maritime.deckHeight);place(pose,[p.x,-p.z],yaw,.80,maritime.deckHeight+.008,'dock');
  }
  const site=config.workshop,yaw=1.55;
  for(const [pose,x,y]of [['worker',-2.6,-1.4],['man_stand',-.5,-2.6]]){
    const xy=[site.xy[0]+Math.cos(yaw)*x-Math.sin(yaw)*y,site.xy[1]+Math.sin(yaw)*x+Math.cos(yaw)*y];
    place(pose,xy,yaw+.4,.82,sampler.at(...site.xy)+3.06,'workshop');
  }
  const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());
  if(!geometry)throw new Error('Villager geometry batching failed');
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96});
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.name='Meadow Harbor residents';scene.add(mesh);
  return{count:placements.length,placements,seated:placements.filter(p=>p.group==='seated').length,dock:placements.filter(p=>p.group==='dock').length,workshop:placements.filter(p=>p.group==='workshop').length};
}
