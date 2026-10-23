import * as THREE from 'three';
import { createWorld, createAvatar, FLOOR_HEIGHT, FLOOR_NAMES } from './world.js';
import { RtcManager } from './rtc.js';

const $ = id => document.getElementById(id);
const COLORS = {
  skin: ['#f2c8a2', '#dba97c', '#ae785a', '#865540', '#513528', '#e8b8a8'],
  hair: ['#241d25', '#66412c', '#bd8756', '#9c4d55', '#d7cab1', '#426c83'],
  outfit: ['#8d70e8', '#f17d96', '#57b5a9', '#e2a65b', '#718dc8', '#d4d1da'],
};
const genders = { masculino: 'Masculino', feminino: 'Feminino', neutro: 'Neutro' };
const look = { skin: COLORS.skin[0], hair: COLORS.hair[0], outfit: COLORS.outfit[0], style:'curto' };
let gender='neutro';
let session=null, connected=false, myId=null, myAvatar=null, myFloor=0;
let selectedId=null, incomingFrom=null, callPending=false;
let rtc=null, servers={proximityRadius:11,interactionRadius:8};
const players=new Map();
const keys=new Set();
const movement={x:0,z:0};
const socket=io({autoConnect:false,reconnection:true,reconnectionDelay:1000,reconnectionDelayMax:7000});
let lastFrame=performance.now(),lastNetwork=0,lastNearby=0;
let gameError=null;
const scene=new THREE.Scene();
let renderer,world;
const camera=new THREE.PerspectiveCamera(58,1,.1,160);
let yaw=0,pitch=.12,camDistance=8.7;
let ownRotation=Math.PI;
let dragging=false, pointerStart=null, pointerLast=null;
const raycaster=new THREE.Raycaster(),rayPosition=new THREE.Vector2();
const clock=new THREE.Clock();

function setText(id,text){$(id).textContent=String(text);}
function hide(id){$(id).classList.add('hidden');}
function show(id){$(id).classList.remove('hidden');}
function toast(message){
  const el=document.createElement('div');el.className='toast';el.textContent=message;
  $('toast-stack').appendChild(el);setTimeout(()=>el.remove(),4000);
}
function joined(){return connected && !!myId && !!myAvatar;}
function getPlayer(id){return players.get(id);}
function distance(a,b){return Math.hypot(a.x-b.x,a.z-b.z);}
function avatarData(){return {nick:$('nick').value.trim()||'Você',gender,look:{...look}};}
function destroyObject(group){
  const textures=new Set(),geometries=new Set(),materials=new Set();
  group.traverse(obj=>{
    if(obj.geometry)geometries.add(obj.geometry);
    if(obj.material){
      for(const material of Array.isArray(obj.material)?obj.material:[obj.material]) {
        materials.add(material);
        if(material.map)textures.add(material.map);
      }
    }
  });
  group.parent?.remove(group);
  textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());
}
try {
  renderer=new THREE.WebGLRenderer({canvas:$('game'),antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,matchMedia('(max-width: 760px)').matches?1.4:1.8));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.12;
  world=createWorld(scene);
}catch(err){gameError=err;console.error(err);}

// Prévia do avatar na entrada, criada só enquanto o formulário está aberto.
let previewScene=null,previewRenderer=null,previewAvatar=null;
function initPreview(){
  if(gameError)return;
  try{
    previewRenderer=new THREE.WebGLRenderer({canvas:$('avatar-preview'),alpha:true,antialias:true,powerPreference:'low-power'});
    previewRenderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    previewRenderer.outputColorSpace=THREE.SRGBColorSpace;
    previewScene=new THREE.Scene();
    previewScene.add(new THREE.HemisphereLight(0xffddf5,0x34304e,3));
    const dir=new THREE.DirectionalLight(0xffd3b6,2.4);dir.position.set(-3,5,5);previewScene.add(dir);
    refreshPreview();
  }catch(err){console.warn('Prévia indisponível:',err);$('avatar-preview').style.display='none';}
}
function refreshPreview(){
  if(!previewScene)return;
  if(previewAvatar)destroyObject(previewAvatar.group);
  previewAvatar=createAvatar(avatarData());
  previewAvatar.group.position.y=-.85;
  previewScene.add(previewAvatar.group);
}
function drawPreview(time){
  if(!previewRenderer||!previewScene||$('entrance').classList.contains('hidden'))return;
  const canvas=$('avatar-preview'),r=canvas.getBoundingClientRect();
  const w=Math.max(20,Math.floor(r.width)),h=Math.max(20,Math.floor(r.height));
  if(canvas.width!==Math.round(w*previewRenderer.getPixelRatio())||canvas.height!==Math.round(h*previewRenderer.getPixelRatio()))previewRenderer.setSize(w,h,false);
  const cam=new THREE.PerspectiveCamera(40,w/h,.1,60);
  cam.position.set(0,.9,5.3);cam.lookAt(0,.26,0);
  if(previewAvatar){previewAvatar.group.rotation.y=Math.sin(time*.25)*.21;previewAvatar.animate(time,false);}
  previewRenderer.render(previewScene,cam);
}
function createSwatches(key){
  const wrap=$(`${key}-picker`);
  COLORS[key].forEach((color,index)=>{
    const button=document.createElement('button');button.type='button';button.style.background=color;
    button.setAttribute('aria-label',`Cor ${index+1}`);button.title=`Cor ${index+1}`;
    if(look[key]===color)button.classList.add('active');
    button.addEventListener('click',()=>{
      look[key]=color;
      [...wrap.children].forEach(el=>el.classList.toggle('active',el===button));
      refreshPreview();
    });
    wrap.appendChild(button);
  });
}
for(const key of Object.keys(COLORS))createSwatches(key);
[...document.querySelectorAll('[data-gender]')].forEach(button=>button.addEventListener('click',()=>{
  gender=button.dataset.gender;
  document.querySelectorAll('[data-gender]').forEach(b=>b.classList.toggle('active',b===button));
  refreshPreview();
}));
$('hair-style').addEventListener('change',e=>{look.style=e.target.value;refreshPreview();});
$('nick').addEventListener('input',()=>refreshPreview());
initPreview();

function resize(){
  if(!renderer)return;
  const width=innerWidth,height=innerHeight;
  renderer.setSize(width,height,false);
  camera.aspect=width/height;camera.fov=width<700?69:58;camera.updateProjectionMatrix();
}
window.addEventListener('resize',resize);
resize();

function addPlayer(data,mine=false){
  if(players.has(data.id))removePlayer(data.id);
  const avatar=createAvatar({gender:data.gender,look:data.look,nick:mine?`${data.nick} · VOCÊ`:data.nick,mine,id:data.id});
  avatar.group.position.set(data.x,(data.floor||0)*FLOOR_HEIGHT,data.z);
  avatar.group.rotation.y=data.rotation||0;
  scene.add(avatar.group);
  const entry={data,avatar,x:data.x,z:data.z,floor:data.floor,rotation:data.rotation||0,targetX:data.x,targetZ:data.z,targetRotation:data.rotation||0,moving:false};
  players.set(data.id,entry);
  if(mine){myAvatar=entry;myFloor=data.floor;ownRotation=data.rotation||0;world.setFloor(myFloor);updateFloorHud();}
}
function removePlayer(id){
  const other=players.get(id);if(!other)return;
  if(selectedId===id)closeProfile();
  destroyObject(other.avatar.group);
  players.delete(id);
  if(id===myId)myAvatar=null;
}
function clearPlayers(){for(const id of [...players.keys()])removePlayer(id);}
function updateFloorHud(){
  setText('floor-name',FLOOR_NAMES[myFloor]);
  setText('location-label',['PUB SOCIAL','LOUNGE','SKY BAR'][myFloor]);
  world?.setFloor(myFloor);
  document.querySelectorAll('[data-floor]').forEach(button=>{
    const number=Number(button.dataset.floor);
    button.disabled=number===myFloor||Math.abs(number-myFloor)>1;
    button.classList.toggle('current',number===myFloor);
  });
}
function showProfile(id){
  if(!joined()||id===myId||!players.has(id))return;
  const target=players.get(id);
  if(target.floor!==myFloor||distance(myAvatar,target)>servers.interactionRadius){toast('Aproxime-se do personagem para ver o perfil.');return;}
  selectedId=id;updateProfile();show('profile-panel');
}
function closeProfile(){selectedId=null;hide('profile-panel');}
function updateProfile(){
  const other=getPlayer(selectedId);
  if(!other||!myAvatar){closeProfile();return;}
  setText('profile-nick',other.data.nick);
  setText('profile-gender',genders[other.data.gender]||'Neutro');
  const same=other.floor===myFloor;
  const gap=same?distance(myAvatar,other):0;
  setText('profile-distance',same?`${gap.toFixed(1)} m · ${gap<=servers.interactionRadius?'Perto':'Longe'}`:'Em outro andar');
  const available=same&&gap<=servers.interactionRadius&&!callPending&&!rtc?.callPeer&&!rtc?.blockedUsers.has(selectedId);
  $('profile-call').disabled=!available;
  setText('profile-mute',rtc?.mutedUsers.has(selectedId)?'♩ Ouvir esta pessoa':'♩ Silenciar esta pessoa');
  setText('profile-block',rtc?.blockedUsers.has(selectedId)?'Desbloquear':'Bloquear');
}
$('profile-close').addEventListener('click',closeProfile);
$('profile-mute').addEventListener('click',()=>{
  if(!selectedId||!rtc)return;
  rtc.setRemoteMuted(selectedId,!rtc.mutedUsers.has(selectedId));updateProfile();
  toast(rtc.mutedUsers.has(selectedId)?'Você silenciou esta pessoa.':'Você voltou a ouvir esta pessoa.');
});
$('profile-block').addEventListener('click',()=>{
  if(!selectedId||!rtc)return;
  const block=!rtc.blockedUsers.has(selectedId);
  rtc.setBlocked(selectedId,block);updateProfile();
  toast(block?'Você bloqueou essa pessoa nesta sessão.':'Pessoa desbloqueada.');
});
$('profile-report').addEventListener('click',()=>{
  if(!selectedId)return;
  const reason=prompt('Descreva brevemente o motivo da denúncia (opcional):');
  if(reason===null)return;
  socket.emit('user:report',{targetId:selectedId,reason:reason||'Comportamento inadequado'});
});
$('profile-call').addEventListener('click',()=>{
  if(!selectedId||$('profile-call').disabled)return;
  callPending=true;
  socket.emit('call:request',{targetId:selectedId});
  closeProfile();
});

function pickAvatar(pointX,pointY){
  rayPosition.set(pointX/innerWidth*2-1,-(pointY/innerHeight*2-1));
  raycaster.setFromCamera(rayPosition,camera);
  const targetMeshes=[];
  for(const [id,p] of players){
    if(id===myId||p.floor!==myFloor)continue;
    p.avatar.group.traverse(child=>{if(child.isMesh)targetMeshes.push(child);});
  }
  const intersects=raycaster.intersectObjects(targetMeshes,false);
  if(intersects.length){
    const id=intersects[0].object.userData.playerId;
    if(id)showProfile(id);
  }else closeProfile();
}
$('game').addEventListener('pointerdown',e=>{
  if(!joined())return;
  dragging=true;pointerStart={x:e.clientX,y:e.clientY};pointerLast={x:e.clientX,y:e.clientY};
  $('game').setPointerCapture(e.pointerId);
});
$('game').addEventListener('pointermove',e=>{
  if(!dragging||!pointerLast)return;
  const dx=e.clientX-pointerLast.x,dy=e.clientY-pointerLast.y;
  yaw-=dx*.005;
  pitch=Math.max(-.2,Math.min(.8,pitch+dy*.003));
  pointerLast={x:e.clientX,y:e.clientY};
});
function endPointer(e){
  if(!dragging)return;
  dragging=false;
  if(pointerStart&&Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)<9)pickAvatar(e.clientX,e.clientY);
  pointerStart=null;pointerLast=null;
}
$('game').addEventListener('pointerup',endPointer);
$('game').addEventListener('pointercancel',()=>{dragging=false;pointerStart=null;pointerLast=null;});
$('game').addEventListener('wheel',e=>{
  camDistance=Math.max(5.0,Math.min(12.6,camDistance+Math.sign(e.deltaY)*.5));
},{passive:true});
window.addEventListener('keydown',e=>{
  if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;
  if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','KeyE'].includes(e.code))e.preventDefault();
  keys.add(e.code);
  if(e.code==='KeyE'&&!e.repeat&&joined())toggleFloorPanel();
  if(e.code==='Escape'){closeProfile();hide('floor-panel');hide('help-modal');}
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{keys.clear();movement.x=0;movement.z=0;updateStick();});

// Controle analógico sensível ao toque, independente do gesto para mover a câmera.
let stickPointer=null;
function updateStick(){const mx=movement.x*28,my=movement.z*28;$('joystick-thumb').style.transform=`translate(${mx}px, ${my}px)`;}
function sampleStick(e){
  const b=$('joystick').getBoundingClientRect();
  const dx=(e.clientX-(b.left+b.width/2))/(b.width*.34);
  const dy=(e.clientY-(b.top+b.height/2))/(b.height*.34);
  const mag=Math.max(1,Math.hypot(dx,dy));
  movement.x=dx/mag;movement.z=dy/mag;updateStick();
}
$('joystick').addEventListener('pointerdown',e=>{e.preventDefault();stickPointer=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);sampleStick(e);});
$('joystick').addEventListener('pointermove',e=>{if(stickPointer===e.pointerId){e.preventDefault();sampleStick(e);}});
function stopStick(e){if(stickPointer===e.pointerId){stickPointer=null;movement.x=0;movement.z=0;updateStick();}}
$('joystick').addEventListener('pointerup',stopStick);
$('joystick').addEventListener('pointercancel',stopStick);

function openFloorPanel(){
  if(!joined())return;
  if(!world.isNearElevator(myAvatar)) {toast('Vá até o elevador iluminado no canto do bar para trocar de andar.');return;}
  updateFloorHud();show('floor-panel');
}
function toggleFloorPanel(){if(!$('floor-panel').classList.contains('hidden'))hide('floor-panel');else openFloorPanel();}
$('floor-button').addEventListener('click',toggleFloorPanel);
$('mobile-floor').addEventListener('click',toggleFloorPanel);
$('floor-close').addEventListener('click',()=>hide('floor-panel'));
document.querySelectorAll('[data-floor]').forEach(btn=>btn.addEventListener('click',()=>{
  if(!joined()||btn.disabled)return;
  socket.emit('world:floor',{floor:Number(btn.dataset.floor)});
  hide('floor-panel');
}));

$('help-button').addEventListener('click',()=>show('help-modal'));
$('help-close').addEventListener('click',()=>hide('help-modal'));
$('help-understood').addEventListener('click',()=>hide('help-modal'));
$('mic-button').addEventListener('click',async()=>{
  if(!rtc)return;
  try{await rtc.toggleMicrophone();updateMicButton();}
  catch(err){toast('Microfone indisponível: confira as permissões do navegador.');updateMicButton();}
});
$('audio-enable').addEventListener('click',()=>{
  if(!rtc)return;
  rtc.unlockAudio();$('audio-enable').classList.add('hidden');
  toast('Áudio ativado. Você ouvirá pessoas dentro do alcance.');
});
function updateMicButton(){
  const on=rtc?.micOn;
  $('mic-button').classList.toggle('on',!!on);
  $('mic-button').classList.toggle('off',!on);
  setText('mic-icon',on?'♩':'♩̸');
  setText('mic-text',on?'Microfone ligado':'Ativar microfone');
  setText('video-mic',on?'♩':'♩̸');
}
$('leave-button').addEventListener('click',()=>{
  if(confirm('Deseja sair do MitBar?'))location.reload();
});

// Eventos Socket.IO - o servidor é a referência de identidade, posição e convites.
function joinSocket(){
  if(!session)return;
  setText('connection-status','Conectando ao pub...');
  socket.emit('world:join',session,response=>{
    if(response?.ok)return;
    connected=false;
    $('enter-button').disabled=false;
    setText('enter-button','ENTRAR NO MITBAR →');
    $('join-error').hidden=false;
    $('join-error').textContent=response?.message||'Não foi possível entrar. Tente novamente.';
    if(myId){toast(response?.message||'Não foi possível reconectar.');myId=null;clearPlayers();hide('hud');show('entrance');}
  });
}
socket.on('connect',joinSocket);
socket.on('connect_error',err=>{
  if(!session)return;
  toast('Servidor indisponível. Verifique sua internet ou o endereço do MitBar.');
  console.warn('Conexão:',err.message);
});
socket.on('disconnect',()=>{
  connected=false;
  rtc?.resetConnection();
  callPending=false;
  hide('incoming-modal');hide('video-window');
  setText('connection-status','Reconectando...');
  toast('Conexão interrompida. Tentando reconectar...');
});
socket.on('world:init',data=>{
  rtc?.resetConnection();
  clearPlayers();myId=data.id;
  rtc.localId=myId;
  addPlayer(data.you,true);
  for(const other of data.players)addPlayer(other,false);
  connected=true;callPending=false;
  $('join-error').hidden=true;
  hide('entrance');show('hud');
  if(previewAvatar)destroyObject(previewAvatar.group);
  previewAvatar=null;previewRenderer?.dispose();previewRenderer=null;previewScene=null;
  setText('connection-status','● Conectado');
  setText('online-number',players.size);
  updateMicButton();
  camera.position.set(data.you.x+Math.sin(yaw)*camDistance,7,data.you.z+Math.cos(yaw)*camDistance);
  camera.lookAt(data.you.x,1.3,data.you.z);
  toast(`Bem-vindo ao MitBar, ${data.you.nick}!`);
  if(!rtc.hasMicrophone)toast('Você pode ouvir outras pessoas mesmo sem ativar seu microfone.');
});
socket.on('world:joined',data=>{
  addPlayer(data,false);setText('online-number',players.size);
  toast(`${data.nick} acabou de entrar no pub.`);
});
socket.on('world:left',({id})=>{
  const p=players.get(id);
  if(p)toast(`${p.data.nick} saiu do pub.`);
  rtc?.closeVoicePeer(id);removePlayer(id);setText('online-number',players.size);
});
socket.on('world:count',({online})=>setText('online-number',online));
socket.on('world:moved',data=>{
  const p=players.get(data.id);if(!p||data.id===myId)return;
  p.targetX=data.x;p.targetZ=data.z;p.targetRotation=data.rotation;
  if(p.floor!==data.floor){p.floor=data.floor;p.data.floor=data.floor;p.x=data.x;p.z=data.z;}
});
socket.on('world:teleported',data=>{
  if(!myAvatar)return;
  myFloor=data.floor;myAvatar.floor=data.floor;
  myAvatar.x=data.x;myAvatar.z=data.z;
  myAvatar.targetX=data.x;myAvatar.targetZ=data.z;
  updateFloorHud();closeProfile();
  toast(`Você chegou ao ${FLOOR_NAMES[myFloor]}.`);
});
socket.on('rtc:signal',async({fromId,type,data})=>{
  try{
    if(type==='voice')await rtc?.handleVoiceSignal(fromId,data);
    else if(type==='video')await rtc?.handleVideoSignal(fromId,data);
  }catch(err){console.warn('Sinalização RTC:',err);}
});
socket.on('voice:refresh',({fromId})=>rtc?.handleVoiceRefresh(fromId));
socket.on('user:reported',()=>toast('Denúncia registrada no log do servidor.'));

socket.on('call:incoming',({fromId,fromName})=>{
  if(rtc?.blockedUsers.has(fromId)||rtc?.callPeer||incomingFrom){
    socket.emit('call:reply',{accept:false});return;
  }
  incomingFrom=fromId;
  setText('caller-name',fromName);
  show('incoming-modal');
});
socket.on('call:cancel',()=>{incomingFrom=null;hide('incoming-modal');});
socket.on('call:status',({status,message})=>{
  if(status==='ended')callPending=false;
  toast(message);
});
socket.on('call:start',async({peerId,initiator})=>{
  callPending=false;incomingFrom=null;
  hide('incoming-modal');show('video-window');
  setText('call-status','Aguardando câmera...');
  setText('video-cam','▣');
  rtc?.startVideo(peerId,initiator);
});
socket.on('call:end',({message}={})=>{
  rtc?.endVideoLocal();callPending=false;hide('video-window');
  if(message)toast(message);
});
$('accept-call').addEventListener('click',()=>{
  if(!incomingFrom)return;
  socket.emit('call:reply',{accept:true});hide('incoming-modal');
});
$('reject-call').addEventListener('click',()=>{
  socket.emit('call:reply',{accept:false});incomingFrom=null;hide('incoming-modal');
});
$('end-call').addEventListener('click',()=>{
  socket.emit('call:end');rtc?.endVideoLocal();hide('video-window');
});
$('video-mic').addEventListener('click',async()=>{
  if(!rtc)return;
  if(!rtc.hasMicrophone && rtc.callStream?.getAudioTracks().length){
    const tracks=rtc.callStream.getAudioTracks(),enabled=!tracks[0].enabled;
    tracks.forEach(t=>t.enabled=enabled);
    setText('video-mic',enabled?'♩':'♩̸');return;
  }
  try{await rtc.toggleMicrophone();updateMicButton();}
  catch(err){toast('Não foi possível ativar o microfone.');}
});
$('video-cam').addEventListener('click',()=>{
  if(!rtc)return;
  const on=rtc.toggleCamera();
  $('video-cam').classList.toggle('disabled',!on);
});

async function fetchConfig(){
  try{const response=await fetch('/api/config',{cache:'no-store'});if(response.ok)servers=await response.json();}
  catch{console.warn('Usando configuração WebRTC padrão.');}
}
const configReady=fetchConfig();
function initializeRtc(){
  rtc=new RtcManager(socket,{
    onAudioUnlockNeeded:()=>show('audio-enable'),
    onVideoError:error=>toast(error.message||'Falha ao usar a câmera ou conectar a chamada.'),
    onLocalVideo:stream=>{$('local-video').srcObject=stream;$('local-video').play().catch(()=>{});setText('call-status','Chamando...');},
    onRemoteVideo:(stream,muted)=>{
      $('remote-video').srcObject=stream;$('remote-video').muted=muted;
      $('remote-video').play().catch(()=>show('audio-enable'));
    },
    onVideoConnected:()=>setText('call-status','● Em chamada'),
    onVideoMute:muted=>{$('remote-video').muted=muted;},
    onRetryVideoPlay:()=>$('remote-video').play().catch(()=>{}),
    onVideoEnded:()=>{
      $('local-video').srcObject=null;$('remote-video').srcObject=null;hide('video-window');
    },
  },servers.iceServers);
}
$('join-form').addEventListener('submit',async e=>{
  e.preventDefault();
  if(gameError){$('join-error').hidden=false;$('join-error').textContent='Seu navegador não conseguiu abrir os gráficos 3D. Tente atualizar o navegador ou ativar a aceleração de hardware.';return;}
  const name=$('real-name').value.trim(),email=$('email').value.trim(),nick=$('nick').value.trim();
  const age=Number($('age').value);
  let error='';
  if(name.length<2||nick.length<2)error='Preencha seu nome e o nome do personagem (ao menos 2 caracteres).';
  else if(!$('email').checkValidity())error='Informe um endereço de e-mail válido.';
  else if(!Number.isInteger(age)||age<18||age>120)error='O MitBar é exclusivo para pessoas com 18 anos ou mais.';
  if(error){$('join-error').hidden=false;$('join-error').textContent=error;return;}
  $('join-error').hidden=true;
  $('enter-button').disabled=true;
  setText('enter-button','CONECTANDO...');
  session={name,email,nick,age,gender,look:{...look}};
  await configReady;
  if(!rtc)initializeRtc();
  try{await rtc.enableMicrophone();}
  catch(err){console.warn('Acesso ao microfone recusado:',err.message);toast('Microfone não autorizado. Você poderá ativá-lo mais tarde.');}
  if(socket.connected)joinSocket();else socket.connect();
});

function controlsVector(){
  const x=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+movement.x;
  const z=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0)+movement.z;
  const len=Math.hypot(x,z);
  if(len<.1)return {x:0,z:0};
  return {x:x/Math.max(1,len),z:z/Math.max(1,len)};
}
function processMovement(dt){
  if(!joined())return;
  const p=myAvatar,control=controlsVector();
  const xDir=Math.cos(yaw)*control.x+Math.sin(yaw)*control.z;
  const zDir=-Math.sin(yaw)*control.x+Math.cos(yaw)*control.z;
  const speed=4.0;
  const newPosition=world.moveWithCollision(p,p.x+xDir*dt*speed,p.z+zDir*dt*speed,myFloor);
  p.moving=Math.hypot(newPosition.x-p.x,newPosition.z-p.z)>.0005;
  p.x=newPosition.x;p.z=newPosition.z;
  if(p.moving)ownRotation=Math.atan2(xDir,zDir);
  p.rotation=ownRotation;
  p.avatar.group.position.set(p.x,myFloor*FLOOR_HEIGHT,p.z);
  let diff=((ownRotation-p.avatar.group.rotation.y+Math.PI*3)%(Math.PI*2))-Math.PI;
  p.avatar.group.rotation.y+=diff*Math.min(1,dt*13);
  p.avatar.animate(clock.getElapsedTime(),p.moving);
  const isNear=world.isNearElevator(p);
  $('elevator-tip').classList.toggle('hidden',!isNear);
  if(!isNear)hide('floor-panel');
  if(performance.now()-lastNetwork>90){
    socket.emit('world:move',{x:p.x,z:p.z,rotation:p.avatar.group.rotation.y});
    lastNetwork=performance.now();
  }
}
function moveRemote(dt,time){
  for(const [id,p] of players){
    if(id===myId)continue;
    const px=p.x,pz=p.z;
    const mix=Math.min(1,dt*10);
    p.x+=(p.targetX-p.x)*mix;p.z+=(p.targetZ-p.z)*mix;
    const delta=((p.targetRotation-p.avatar.group.rotation.y+Math.PI*3)%(Math.PI*2))-Math.PI;
    p.avatar.group.rotation.y+=delta*mix;
    p.avatar.group.position.set(p.x,p.floor*FLOOR_HEIGHT,p.z);
    p.avatar.group.visible=p.floor===myFloor;
    p.moving=Math.hypot(p.x-px,p.z-pz)>.003;
    p.avatar.animate(time,p.moving);
  }
}
function refreshProximity(){
  if(!joined())return;
  const near=[];
  for(const [id,p] of players){
    if(id===myId||p.floor!==myFloor)continue;
    if(distance(myAvatar,p)<=servers.proximityRadius)near.push(id);
  }
  rtc.updateNeighbors(near);
  setText('nearby-label',near.length?`${near.length} pessoa${near.length!==1?'s':''} ao alcance da voz`:'Nenhuma pessoa ao alcance da voz');
  if(selectedId)updateProfile();
}
function updateCamera(dt,time){
  if(joined()){
    const p=myAvatar;
    const offset=camDistance;
    const lift=3.8+pitch*5;
    const desired=new THREE.Vector3(p.x+Math.sin(yaw)*offset,p.floor*FLOOR_HEIGHT+lift,p.z+Math.cos(yaw)*offset);
    camera.position.lerp(desired,Math.min(1,dt*6.5));
    camera.lookAt(p.x,p.floor*FLOOR_HEIGHT+1.35,p.z);
  }else{
    camera.position.set(15+Math.sin(time*.12)*3,11,18+Math.cos(time*.12)*3);
    camera.lookAt(0,1,-2);
  }
}
function frame(timeMs){
  requestAnimationFrame(frame);
  if(!renderer||!world)return;
  const dt=Math.min(.05,(timeMs-lastFrame)/1000||.016);lastFrame=timeMs;
  const t=clock.getElapsedTime();
  processMovement(dt);
  moveRemote(dt,t);
  world.animate(t);
  updateCamera(dt,t);
  if(joined()&&timeMs-lastNearby>800){refreshProximity();lastNearby=timeMs;}
  drawPreview(t);
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);

// Áudio do navegador exige HTTPS (Render fornece TLS) e permissão expressa.
window.addEventListener('beforeunload',()=>rtc?.dispose());
