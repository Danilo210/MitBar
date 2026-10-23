// WebRTC ponto a ponto: uma conexão de áudio por pessoa próxima e outra para vídeo por convite.
export class RtcManager {
  constructor(socket, handlers = {}, iceServers = []) {
    this.socket = socket;
    this.handlers = handlers;
    this.iceServers = iceServers.length ? iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
    this.localId = null;
    this.voiceStream = null;
    this.voicePeers = new Map();
    this.neighborIds = new Set();
    this.mutedUsers = new Set();
    this.blockedUsers = new Set();
    this.callPeer = null;
    this.videoPc = null;
    this.videoInitPromise = null;
    this.cameraStream = null;
    this.callStream = null;
    this.videoIceQueue = [];
    this.videoRemoteStream = null;
  }
  get micOn() { return !!this.voiceStream?.getAudioTracks().some(t => t.enabled && t.readyState === 'live'); }
  get hasMicrophone() { return !!this.voiceStream?.getAudioTracks().some(t => t.readyState === 'live'); }
  emitSignal(type, targetId, data) { this.socket.emit('rtc:signal', { type, targetId, data }); }
  peerConfig() { return { iceServers: this.iceServers, iceCandidatePoolSize: 0 }; }

  async enableMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não oferece acesso ao microfone.');
    if (this.hasMicrophone) {
      this.voiceStream.getAudioTracks().forEach(t => t.enabled = true);
      return;
    }
    this.voiceStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    for(const id of [...this.voicePeers.keys()]) {
      this.closeVoicePeer(id);
      this.socket.emit('voice:refresh', { targetId: id });
    }
  }
  async toggleMicrophone() {
    if (!this.hasMicrophone) { await this.enableMicrophone(); return true; }
    const turnOn = !this.micOn;
    this.voiceStream.getAudioTracks().forEach(t => t.enabled = turnOn);
    if (this.callStream) this.callStream.getAudioTracks().forEach(t => t.enabled = turnOn);
    return turnOn;
  }
  setRemoteMuted(id, muted) {
    if (muted) this.mutedUsers.add(id); else this.mutedUsers.delete(id);
    const peer = this.voicePeers.get(id);
    if (peer?.audio) peer.audio.muted = this.shouldMute(id);
    if (id === this.callPeer) this.handlers.onVideoMute?.(this.mutedUsers.has(id));
  }
  shouldMute(id) { return this.mutedUsers.has(id) || this.blockedUsers.has(id) || this.callPeer===id; }
  setBlocked(id, blocked) {
    if(blocked){ this.blockedUsers.add(id); this.closeVoicePeer(id); }
    else this.blockedUsers.delete(id);
    this.setRemoteMuted(id, this.mutedUsers.has(id));
    if (blocked && this.callPeer===id) this.socket.emit('call:end');
  }

  updateNeighbors(ids) {
    this.neighborIds = new Set(ids.filter(id => !this.blockedUsers.has(id)));
    for(const id of [...this.voicePeers.keys()]) if(!this.neighborIds.has(id)) this.closeVoicePeer(id);
    for(const id of this.neighborIds) {
      if(this.localId && this.localId < id && !this.voicePeers.has(id)) this.createVoicePeer(id,true);
    }
  }
  createVoicePeer(id, initiator = false) {
    if(this.blockedUsers.has(id) || this.voicePeers.has(id)) return this.voicePeers.get(id);
    const pc = new RTCPeerConnection(this.peerConfig());
    const record = { pc, audio: null, iceQueue: [] };
    this.voicePeers.set(id,record);
    pc.onicecandidate = event => { if(event.candidate) this.emitSignal('voice',id,{candidate:event.candidate.toJSON()}); };
    pc.ontrack = event => {
      if(record.audio) record.audio.remove();
      const audio=document.createElement('audio');
      audio.autoplay=true; audio.playsInline=true; audio.style.display='none';
      audio.srcObject=event.streams[0] || new MediaStream([event.track]);
      audio.muted=this.shouldMute(id);
      document.body.appendChild(audio);
      record.audio=audio;
      audio.play().catch(() => this.handlers.onAudioUnlockNeeded?.());
    };
    pc.onconnectionstatechange = () => {
      if(pc.connectionState==='failed') {
        this.closeVoicePeer(id);
        this.handlers.onVoiceFail?.(id);
      }
    };
    const audioTracks=this.voiceStream?.getAudioTracks().filter(t=>t.readyState==='live')||[];
    if(audioTracks.length) audioTracks.forEach(track => pc.addTrack(track,this.voiceStream));
    else pc.addTransceiver('audio',{direction:'recvonly'});
    if(initiator) {
      (async () => {
        try {
          const offer=await pc.createOffer();
          if(this.voicePeers.get(id)!==record) return;
          await pc.setLocalDescription(offer);
          this.emitSignal('voice',id,{sdp:pc.localDescription.toJSON()});
        } catch(err) { console.warn('MitBar voz / offer:',err); this.closeVoicePeer(id); }
      })();
    }
    return record;
  }
  closeVoicePeer(id) {
    const record=this.voicePeers.get(id); if(!record) return;
    this.voicePeers.delete(id);
    if(record.audio){ record.audio.pause(); record.audio.srcObject=null; record.audio.remove(); }
    record.pc.onicecandidate=null;record.pc.ontrack=null;record.pc.close();
  }
  async handleVoiceSignal(id,data) {
    if(this.blockedUsers.has(id)) return;
    // Um offer inicial pode chegar antes da atualização da lista de vizinhos.
    let record=this.voicePeers.get(id);
    if(!record && data.sdp?.type==='offer') record=this.createVoicePeer(id,false);
    if(!record) return;
    const pc=record.pc;
    try {
      if(data.sdp) {
        if(data.sdp.type==='offer' && pc.signalingState==='have-local-offer') {
          // Caso de negociação simultânea, o menor socket.id toma a iniciativa.
          if(this.localId < id) return;
          this.closeVoicePeer(id);record=this.createVoicePeer(id,false);
        }
        const active=record.pc;
        await active.setRemoteDescription(data.sdp);
        for(const ice of record.iceQueue.splice(0)) await active.addIceCandidate(ice).catch(()=>{});
        if(data.sdp.type==='offer') {
          const answer=await active.createAnswer();await active.setLocalDescription(answer);
          this.emitSignal('voice',id,{sdp:active.localDescription.toJSON()});
        }
      } else if(data.candidate) {
        if(record.pc.remoteDescription) await record.pc.addIceCandidate(data.candidate);
        else record.iceQueue.push(data.candidate);
      }
    }catch(err){console.warn('MitBar voz / signal:',err.message);}
  }
  handleVoiceRefresh(id) {
    this.closeVoicePeer(id);
    if(this.neighborIds.has(id) && this.localId && this.localId < id) this.createVoicePeer(id,true);
  }
  unlockAudio() {
    let pending = false;
    for(const record of this.voicePeers.values()) {
      record.audio?.play().catch(()=>{pending=true;});
    }
    if(this.videoRemoteStream) this.handlers.onRetryVideoPlay?.();
    return pending;
  }

  async startVideo(peerId, initiator) {
    this.endVideoLocal();
    this.callPeer=peerId;
    this.videoInitPromise=this.prepareVideo(peerId,initiator);
    try { await this.videoInitPromise; }
    catch(err) {
      console.warn('MitBar video:',err);
      this.handlers.onVideoError?.(err);
      this.socket.emit('call:end');
      this.endVideoLocal();
    }
  }
  async prepareVideo(peerId,initiator) {
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Navegador sem suporte a câmera.');
    let camera;
    try {
      camera=await navigator.mediaDevices.getUserMedia({ video: { facingMode:'user',width:{ideal:640},height:{ideal:480} }, audio:!this.hasMicrophone });
    }catch(err){
      if(this.hasMicrophone) throw err;
      // Permite entrar somente com câmera se o microfone não foi autorizado.
      camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});
    }
    if(this.callPeer!==peerId) { camera.getTracks().forEach(t=>t.stop()); return; }
    this.cameraStream=camera;
    const audioTracks=this.hasMicrophone?this.voiceStream.getAudioTracks():camera.getAudioTracks();
    this.callStream=new MediaStream([...camera.getVideoTracks(),...audioTracks]);
    this.handlers.onLocalVideo?.(this.callStream);
    const pc=new RTCPeerConnection(this.peerConfig());this.videoPc=pc;
    for(const track of this.callStream.getTracks()) pc.addTrack(track,this.callStream);
    pc.onicecandidate=e=>{if(e.candidate) this.emitSignal('video',peerId,{candidate:e.candidate.toJSON()});};
    pc.ontrack=e=>{
      const stream=e.streams[0]||new MediaStream([e.track]);
      this.videoRemoteStream=stream;this.handlers.onRemoteVideo?.(stream,this.mutedUsers.has(peerId));
    };
    pc.onconnectionstatechange=()=>{
      if(pc.connectionState==='connected')this.handlers.onVideoConnected?.();
      if(pc.connectionState==='failed')this.handlers.onVideoError?.(new Error('Não foi possível estabelecer a videochamada. Configure um servidor TURN se isso ocorrer com frequência.'));
    };
    for(const ice of this.videoIceQueue.splice(0)) {
      if(pc.remoteDescription) pc.addIceCandidate(ice).catch(()=>{});
      else this.videoIceQueue.push(ice);
    }
    if(initiator){
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);
      if(this.callPeer===peerId)this.emitSignal('video',peerId,{sdp:pc.localDescription.toJSON()});
    }
  }
  async handleVideoSignal(peerId,data) {
    if(peerId!==this.callPeer) return;
    if(this.videoInitPromise) await this.videoInitPromise.catch(()=>{});
    const pc=this.videoPc;if(!pc || pc.signalingState==='closed')return;
    try {
      if(data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        for(const ice of this.videoIceQueue.splice(0)) await pc.addIceCandidate(ice).catch(()=>{});
        if(data.sdp.type==='offer'){
          const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
          this.emitSignal('video',peerId,{sdp:pc.localDescription.toJSON()});
        }
      } else if(data.candidate) {
        if(pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else this.videoIceQueue.push(data.candidate);
      }
    }catch(err){console.warn('MitBar video / signal:',err);this.handlers.onVideoError?.(err);}
  }
  toggleCamera() {
    const tracks=this.cameraStream?.getVideoTracks()||[];
    if(!tracks.length)return false;
    const next=!tracks[0].enabled;tracks.forEach(t=>t.enabled=next);return next;
  }
  endVideoLocal() {
    const previous=this.callPeer;
    this.callPeer=null;
    if(this.videoPc){this.videoPc.ontrack=null;this.videoPc.onicecandidate=null;this.videoPc.close();this.videoPc=null;}
    // Apenas trilhas adquiridas para a câmera são encerradas; o microfone de proximidade permanece.
    this.cameraStream?.getTracks().forEach(track=>track.stop());
    this.cameraStream=null;this.callStream=null;this.videoInitPromise=null;this.videoIceQueue=[];
    this.videoRemoteStream=null;
    if(previous){const peer=this.voicePeers.get(previous);if(peer?.audio)peer.audio.muted=this.shouldMute(previous);}
    this.handlers.onVideoEnded?.();
  }
  resetConnection() {
    for(const id of [...this.voicePeers.keys()])this.closeVoicePeer(id);
    this.neighborIds.clear();this.endVideoLocal();this.localId=null;
  }
  dispose() {
    this.resetConnection();this.voiceStream?.getTracks().forEach(t=>t.stop());this.voiceStream=null;
  }
}
