import * as THREE from 'three';

export const FLOOR_HEIGHT = 4.8;
export const FLOOR_NAMES = ['Térreo · Pub', '2º andar · Lounge', '3º andar · Sky Bar'];
export const ELEVATOR = { x: -16.6, z: -11.6 };
const mat = (color, roughness = .68, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const dark = mat('#14151e');
const brass = mat('#c7a36c', .38, .7);
const colliders = [[], [], []];

function cube(group, w, h, d, x, y, z, material, shadows = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadows; mesh.receiveShadow = shadows;
  group.add(mesh);
  return mesh;
}
function cylinder(group, top, bottom, height, x, y, z, material, segments = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments), material);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}
function sphere(group, r, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), material);
  mesh.position.set(x,y,z); group.add(mesh); return mesh;
}
function glow(color, intensity = 2) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: .4 });
}
function addRect(floor, x, z, width, depth, pad = .38) {
  colliders[floor].push({ x1: x - width/2 - pad, x2: x + width/2 + pad, z1: z - depth/2 - pad, z2: z + depth/2 + pad });
}
function wallArt(group, text, x, y, z, width = 8, height = 1.65, color = '#f6cae0') {
  const canvas = document.createElement('canvas');
  canvas.width = 768; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(13,11,21,.94)'; ctx.fillRect(0,0,768,160);
  ctx.strokeStyle = '#8651d5'; ctx.lineWidth = 8; ctx.strokeRect(7,7,754,146);
  ctx.fillStyle = color; ctx.font = 'bold 68px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text,384,82,710);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(width,height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }));
  sign.position.set(x,y,z); group.add(sign);
}
function buildBase(g, floor) {
  const palette = ['#301f25','#262331','#253039'];
  const flooring = mat(palette[floor], .82);
  cube(g, 42, .55, 32, 0, -.31, 0, flooring);
  const planks = floor === 1 ? 22 : 33;
  const wood = [mat('#51343c'),mat('#59373b'),mat('#4c2d33'),mat('#644149')];
  for (let i=0;i<planks;i++) {
    const z = -15.6 + i * (31.2/planks);
    cube(g, 41.1, .022, 31.2/planks - .035, 0, -.018, z, wood[i % wood.length]);
  }
  cube(g, 42, 3.5, .42, 0, 1.7, -16, mat('#201923'));
  cube(g, .42, 3.5, 32, -21, 1.7, 0, mat('#241a29'));
  cube(g, .42, 3.5, 32, 21, 1.7, 0, mat('#241a29'));
  for(let i=-18;i<=18;i+=6) {
    cube(g, .12, 2.85, .12, i, 1.4, -15.69, glow(floor===0?'#ad6189':floor===1?'#7e78cc':'#54a7bb', .7));
    sphere(g,.13,i,3.15,-15.6,glow('#ffd2ae',1.6));
  }
  const wallTrim = glow(floor===0?'#df729b':floor===1?'#aa89f6':'#66cbd3',1.1);
  cube(g,41,.09,.12,0,2.87,-15.68,wallTrim);
  cube(g,.1,.08,31,-20.68,2.8,0,wallTrim);
  cube(g,.1,.08,31,20.68,2.8,0,wallTrim);
  cube(g,42,.13,.2,0,.15,15.85,brass);
  wallArt(g, ['MITBAR  •  SOCIAL PUB','MITBAR  •  LOUNGE','MITBAR  •  SKY BAR'][floor],4.2,2.25,-15.73,10.7,1.1);
  const lightColors = [0xee86be,0xb39aff,0x82d6ed];
  const lamp = new THREE.PointLight(lightColors[floor], 47, 23, 2);
  lamp.position.set(4, 4.0, 0); g.add(lamp);
  const amberLamp = new THREE.PointLight(0xffc17c, 39, 19, 2);
  amberLamp.position.set(-11, 3.2, 3); g.add(amberLamp);
  const small = new THREE.PointLight(0x8ad8e4,22,17,2); small.position.set(13,3.4,9); g.add(small);
}
function stool(g, x, z, color = '#d19b70') {
  cylinder(g,.36,.36,.12,x,.73,z,mat(color));
  cylinder(g,.07,.1,.72,x,.35,z,dark);
  cylinder(g,.27,.27,.04,x,.08,z,brass);
}
function pubTable(g, floor, x, z, variant=0) {
  const hue = floor===2?'#31616b':'#835c4d';
  cylinder(g,1.09,1.09,.14,x,1.02,z,mat(hue,.42),22);
  cylinder(g,.10,.13,1.0,x,.51,z,brass);
  cylinder(g,.57,.57,.10,x,.055,z,dark);
  const glass = new THREE.MeshStandardMaterial({color:'#68bfc6',metalness:.3,roughness:.22,transparent:true,opacity:.62});
  cylinder(g,.12,.09,.22,x+.33,1.20,z+.24,glass,12);
  sphere(g,.085,x+.33,1.33,z+.24,glow('#f1c06b',.4));
  if (variant % 2 === 0) { stool(g,x+1.4,z,.55); stool(g,x-1.4,z,'#b47c6d'); }
  else { stool(g,x,z+1.43,'#b47c6d'); stool(g,x,z-1.43); }
  addRect(floor,x,z,1.8,1.8,.23);
}
function couch(g, floor, x, z, orientation=0, color='#684f77') {
  const couchGroup = new THREE.Group(); couchGroup.position.set(x,0,z); couchGroup.rotation.y = orientation; g.add(couchGroup);
  const upholstery = mat(color,.91);
  cube(couchGroup,3.4,.48,1.2,0,.47,0,upholstery);
  cube(couchGroup,3.55,.98,.35,0,.8,-.55,upholstery);
  cube(couchGroup,.4,.72,1.3,-1.65,.62,0,upholstery);
  cube(couchGroup,.4,.72,1.3,1.65,.62,0,upholstery);
  addRect(floor,x,z,3.75,1.35,.3);
}
function hangingLight(g,x,z,color) {
  cylinder(g,.025,.025,.85,x,3.0,z,dark);
  cylinder(g,.65,.34,.33,x,2.55,z,mat('#342c37',.4),16);
  sphere(g,.13,x,2.32,z,glow(color,3));
}
function addBar(g, floor, x=6, z=-10.5, len=14) {
  const face=mat(floor===2?'#1b414d':'#50303c');
  cube(g,len,1.22,1.25,x,.63,z,face);
  cube(g,len+.5,.16,1.65,x,1.29,z,mat('#bb8969',.4));
  for(let offset=-len/2+.7;offset<len/2;offset+=1.8){
    cube(g,.2,.9,.07,x+offset,.72,z+.67,brass);
    if(offset>-len/2+1) stool(g,x+offset,z+1.8,'#af7c88');
  }
  for(let i=0;i<13;i++) {
    const bx=x-len/2+.8+i*(len-1.6)/12;
    const bottleColor=['#5c949e','#b8975c','#80a67b','#c67487'][i%4];
    cylinder(g,.095,.12,.38,bx,1.49,z-.25,mat(bottleColor,.3,.3),9);
  }
  addRect(floor,x,z,len,1.25,.35);
}
function buildElevator(g) {
  const frame = mat('#47364a',.45,.6);
  const glowMat = glow('#a975f2',1.8);
  cube(g,3.55,.12,3.25,ELEVATOR.x,.06,ELEVATOR.z,glowMat);
  cube(g,3.3,.05,3,ELEVATOR.x,.115,ELEVATOR.z,mat('#252130',.38));
  for (const xx of [-18.2,-15.0]) for(const zz of [-13.05,-10.15]) {
    cube(g,.22,3.3,.22,xx,1.65,zz,frame);
    sphere(g,.095,xx,3.2,zz,glowMat);
  }
  cube(g,3.55,.24,3.15,ELEVATOR.x,3.27,ELEVATOR.z,frame);
  const rings = new THREE.Group(); g.add(rings);
  rings.position.set(ELEVATOR.x,.16,ELEVATOR.z);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.16,.046,6,36),glowMat);
  ring.rotation.x=Math.PI/2; rings.add(ring);
  wallArt(g,'ANDAR  ▲ ▼',ELEVATOR.x,2.12,-13.08,3.0,.72,'#dac0ff');
  return rings;
}
function groundFeatures(g,floor) {
  if(floor===0){
    addBar(g,floor,7.0,-10.7,14);
    pubTable(g,floor,-9,-2.6); pubTable(g,floor,-1.7,1.1,1);
    pubTable(g,floor,8.7,5,2); pubTable(g,floor,-10.5,9,3);
    couch(g,floor,11,-1.3,Math.PI/2,'#784855');
    const stage=mat('#272234');
    cube(g,8,.16,4,4.4,.09,11.1,stage);
    for(let i=0;i<5;i++) cube(g,1.26,.03,3,1.8+i*1.35,.21,11.1,glow(i%2?'#a16de4':'#e375ab',.7));
    hangingLight(g,-9,-2.6,'#f0a0c5'); hangingLight(g,9,5,'#e9ac95');
  } else if (floor===1) {
    couch(g,floor,-6,8,0,'#4f587e'); couch(g,floor,9,8,0,'#705575');
    couch(g,floor,11,-2.8,Math.PI/2,'#486b71');
    pubTable(g,floor,-8,1.2,1); pubTable(g,floor,3,5,2); pubTable(g,floor,6,-5,3);
    // Mesa de sinuca decorativa
    cube(g,6.1,.7,3.3,0,.76,-8,mat('#39242b'));
    cube(g,5.4,.09,2.7,0,1.15,-8,mat('#277363'));
    for(let i=0;i<5;i++) sphere(g,.15,-1.25+i*.52,1.37,-8.4+(i%2)*.5,mat(i%2?'#e5d28a':'#cd6576',.28));
    addRect(floor,0,-8,6.1,3.3,.32);
    hangingLight(g,0,-8,'#8da9fd'); hangingLight(g,-8,1.2,'#d5acf2');
  } else {
    addBar(g,floor,7,-10.6,13);
    pubTable(g,floor,-10,4); pubTable(g,floor,-1.5,7,1);
    pubTable(g,floor,11,6,2); pubTable(g,floor,3,-2,3);
    // pista de dança
    for(let i=0;i<5;i++) for(let j=0;j<4;j++) {
      cube(g,1.32,.035,1.32,-10+i*1.39,.035,-8.2+j*1.39,
        glow(['#7354aa','#3a8292','#994b80','#6767a3'][(i+j)%4],.37));
    }
    // cabine DJ
    cube(g,6,1.2,1.1,13, .6,-2.2,mat('#242332'));
    for(let j=0;j<2;j++) cylinder(g,.7,.7,.065,11.8+j*2.4,1.23,-2.2,dark,18);
    addRect(floor,13,-2.2,6,1.1,.35);
    hangingLight(g,-10,-1,'#84e8e7'); hangingLight(g,10,6,'#f9b7dc');
  }
}
export function createWorld(scene) {
  scene.background = new THREE.Color('#100f1a');
  scene.fog = new THREE.FogExp2('#100f1a',.015);
  scene.add(new THREE.HemisphereLight(0xe3d6ff,0x332332,2.4));
  const sun = new THREE.DirectionalLight(0xffd9ba,1.5);
  sun.position.set(-8,20,12); scene.add(sun);
  const floorGroups = [];
  const elevatorRings=[];
  for(let floor=0;floor<3;floor++) {
    const g = new THREE.Group(); g.position.y=floor*FLOOR_HEIGHT; scene.add(g);
    buildBase(g,floor); groundFeatures(g,floor);
    elevatorRings.push(buildElevator(g));
    floorGroups.push(g);
  }
  const setFloor = active => floorGroups.forEach((g,index) => g.visible = index===active);
  setFloor(0);
  function collide(x,z,floor=0) {
    if (x < -18.6 || x > 18.6 || z < -13.6 || z > 13.6) return true;
    return colliders[floor].some(r => x>r.x1 && x<r.x2 && z>r.z1 && z<r.z2);
  }
  function moveWithCollision(current, nextX, nextZ, floor) {
    let x=current.x,z=current.z;
    if(!collide(nextX,z,floor))x=nextX;
    if(!collide(x,nextZ,floor))z=nextZ;
    return {x,z};
  }
  return {
    setFloor, moveWithCollision,
    isNearElevator: pos => Math.hypot(pos.x-ELEVATOR.x,pos.z-ELEVATOR.z) < 3.5,
    animate: time => elevatorRings.forEach((r,i) => { r.rotation.z = Math.sin(time*.7+i)*.08; }),
  };
}

export function createAvatar({gender='neutro',look={},nick='Convidado',mine=false,id=''}={}) {
  const root = new THREE.Group(); root.userData.playerId=id;
  const skin = mat(look.skin||'#f2c8a2',.9), hair=mat(look.hair||'#241d25',.93);
  const clothing = mat(look.outfit||'#8d70e8',.82);
  const pants = mat('#202534',.96);
  const shoes=mat('#d8d1cc',.75);
  const female=gender==='feminino', male=gender==='masculino';
  const shoulder=male ? .54 : (female ? .43 : .48);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(shoulder, female ? .37 : .42,.85,10),clothing);
  torso.position.y=1.24; root.add(torso);
  const waist = cylinder(root,.39,.34,.22,0,.81,0,pants);
  const head = sphere(root,.36,0,2.04,0,skin);
  sphere(root,.065,-.135,2.07,.323,mat('#17151c',.35));
  sphere(root,.065,.135,2.07,.323,mat('#17151c',.35));
  cylinder(root,.07,.07,.14,0,1.73,0,skin);
  const legGeo=new THREE.CapsuleGeometry(.16,.66,4,8);
  const leftLeg=new THREE.Mesh(legGeo,pants); leftLeg.position.set(-.20,.42,0); root.add(leftLeg);
  const rightLeg=new THREE.Mesh(legGeo,pants); rightLeg.position.set(.20,.42,0); root.add(rightLeg);
  cube(root,.32,.16,.54,-.20,.1,.09,shoes); cube(root,.32,.16,.54,.20,.1,.09,shoes);
  const armGeo=new THREE.CapsuleGeometry(.13,.65,4,8);
  const leftArm=new THREE.Mesh(armGeo,clothing); leftArm.position.set(-shoulder-.09,1.17,0); leftArm.rotation.z=-.13; root.add(leftArm);
  const rightArm=new THREE.Mesh(armGeo,clothing); rightArm.position.set(shoulder+.09,1.17,0); rightArm.rotation.z=.13; root.add(rightArm);
  sphere(root,.135,-shoulder-.14,.71,.03,skin); sphere(root,.135,shoulder+.14,.71,.03,skin);
  const style=look.style||'curto';
  if(style!=='raspado') {
    const cap=sphere(root,.364,0,2.2,-.045,hair); cap.scale.set(1,.58,1);
    if(style==='longo'){
      sphere(root,.22,-.29,1.75,-.09,hair).scale.set(.78,2,1);
      sphere(root,.22,.29,1.75,-.09,hair).scale.set(.78,2,1);
      sphere(root,.18,0,1.68,-.30,hair).scale.set(1.3,2.2,.7);
    } else if(style==='medio') {
      sphere(root,.18,-.30,1.94,-.06,hair).scale.set(.83,1.4,1);
      sphere(root,.18,.30,1.94,-.06,hair).scale.set(.83,1.4,1);
    } else if(style==='cacheado') {
      for(let i=0;i<12;i++) {
        const a=i/12*Math.PI*2;
        sphere(root,.18,Math.cos(a)*.27,2.31,Math.sin(a)*.27,hair);
      }
      sphere(root,.16,0,2.49,0,hair);
    }
  }
  // Alvo de clique ampliado para facilitar a seleção de personagens no celular.
  const touchTarget = new THREE.Mesh(new THREE.CapsuleGeometry(.68,1.05,4,8),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
  touchTarget.position.y=1.18; root.add(touchTarget);
  const plate = makeNameplate(nick, mine);
  plate.position.y=2.95;
  root.add(plate);
  root.traverse(child => { if(child.isMesh) child.userData.playerId=id; });
  return {
    group: root,
    setId: newId => root.traverse(obj => { obj.userData.playerId=newId; }),
    animate: (t,moving) => {
      const a=moving ? Math.sin(t*10)*.30 : 0;
      leftArm.rotation.x=a; rightArm.rotation.x=-a;
      leftLeg.rotation.x=-a*.8; rightLeg.rotation.x=a*.8;
      torso.position.y=1.24+(moving?Math.abs(Math.sin(t*10))*.025:0);
    },
  };
}
function makeNameplate(nick,mine) {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=114;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle=mine?'rgba(93,58,125,.96)':'rgba(17,18,32,.92)';
  ctx.beginPath(); ctx.roundRect(12,12,488,90,30);ctx.fill();
  ctx.strokeStyle=mine?'#f1c7fa':'#a18cc2';ctx.lineWidth=3;ctx.stroke();
  ctx.fillStyle='#fff4ff';ctx.font='bold 41px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(nick,256,57,460);
  const tex=new THREE.CanvasTexture(canvas); tex.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));
  sprite.scale.set(2.8,.63,1);
  return sprite;
}
