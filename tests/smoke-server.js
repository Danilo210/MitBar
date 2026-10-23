'use strict';
// Testes sem dependências externas: simula Express e Socket.IO para conferir as regras essenciais.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const events = [];
let onConnection;
let instance;
function express() {
  function app(){}
  app.disable=()=>{};app.use=()=>{};
  app.routes={};app.get=(route,cb)=>app.routes[route]=cb;
  instance=app;return app;
}
express.static=()=>()=>{};
class Server {
  constructor(){this.sockets=[];}
  on(name,cb){ if(name==='connection') onConnection=cb; }
  emit(name,data){events.push({kind:'broadcast',name,data});}
  to(id){return {emit:(name,data)=>events.push({kind:'direct',id,name,data})};}
}
class Socket {
  constructor(id){this.id=id;this.handlers={};this.sent=[];this.broadcast={emit:(name,data)=>events.push({kind:'broadcast-except',from:id,name,data})};}
  on(name,cb){this.handlers[name]=cb;}
  emit(name,data){this.sent.push({name,data});}
  fire(name,payload,callback){assert.ok(this.handlers[name],`Missing handler ${name}`);this.handlers[name](payload,callback);}
}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8'), {
  require: name=>{
    if(name==='express')return express;
    if(name==='socket.io')return {Server};
    if(name==='node:http')return {createServer:()=>({listen:(_port,_host,cb)=>cb()})};
    throw Error('Unexpected require '+name);
  },process:{env:{PORT:'3000'}},console:{log(){},warn(){}},setTimeout,clearTimeout,Date,Math,Number,JSON,String,Array,Object,Map,RegExp,Set,Boolean,
});
const a = new Socket('alice'),b = new Socket('bob'),c = new Socket('charlie');
onConnection(a);onConnection(b);onConnection(c);
function join(socket,overrides={}){
  let result;
  socket.fire('world:join',{name:'Nome privado',email:'nao-divulgar@example.com',age:25,nick:socket.id,gender:'neutro',look:{skin:'#f2c8a2',hair:'#241d25',outfit:'#8d70e8',style:'curto'},...overrides},r=>result=r);
  return result;
}
assert.equal(join(a,{age:17}).ok,false,'proíbe menores');
assert.equal(join(a).ok,true);
assert.equal(join(b).ok,true);
assert.equal(join(c,{nick:'bob'}).ok,false,'nome de personagem não pode repetir');
assert.ok(a.sent.find(e=>e.name==='world:init').data.players.length===0);
const publicEntry=events.find(e=>e.name==='world:joined').data;
assert.equal(Object.hasOwn(publicEntry,'email'),false,'email é privado');
assert.equal(Object.hasOwn(publicEntry,'name'),false,'nome real é privado');
a.fire('rtc:signal',{type:'voice',targetId:'bob',data:{sdp:{type:'offer',sdp:'v=0'}}});
assert.ok(events.some(e=>e.name==='rtc:signal'&&e.id==='bob'),'voz perto permitida');
a.fire('call:request',{targetId:'bob'});
assert.ok(events.some(e=>e.name==='call:incoming'&&e.id==='bob'),'convite é enviado');
b.fire('call:reply',{accept:true});
assert.equal(events.filter(e=>e.name==='call:start').length + b.sent.filter(e=>e.name==='call:start').length,2,'chamada só é iniciada após aceitar');
a.fire('call:end');
assert.equal(events.filter(e=>e.name==='call:end').length,2,'termina para ambos');
const floorRequest={floor:2};
a.fire('world:floor',floorRequest);
assert.equal(a.sent.some(e=>e.name==='world:teleported'),false,'não é possível pular andares');
let health;
instance.routes['/health']({}, {json:x=>{health=x;}});
assert.equal(health.online,2);
b.fire('disconnect');
instance.routes['/health']({}, {json:x=>{health=x;}});
assert.equal(health.online,1);
console.log('✓ Acesso 18+; dados privados; presença; voz próxima; convite/aceite e fim de chamada; regras de andares; desconexão');
