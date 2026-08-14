/* ═══ MeshMeet — Multi-Peer P2P Video (up to 6) ═══
   Full mesh WebRTC. Host acts as signaling relay via data channels.
   Only the host does manual SDP exchange; inter-joiner connections are automatic. */

(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ── Views ──
const V = { landing: $('#view-landing'), host: $('#view-host'), join: $('#view-join'), call: $('#view-call'), 'quick-host': $('#view-quick-host'), 'quick-join': $('#view-quick-join') };
function showView(k){ Object.values(V).forEach(v=>v.classList.remove('active')); V[k].classList.add('active'); }

// ── DOM refs ──
const inputName = $('#input-name');
const hostPreview=$('#host-preview'), hostPreviewOff=$('#host-preview-off');
const joinPreview=$('#join-preview'), joinPreviewOff=$('#join-preview-off');
const hostMic=$('#host-mic'), hostCam=$('#host-cam'), joinMic=$('#join-mic'), joinCam=$('#join-cam');
const ctlMic=$('#ctl-mic'), ctlCam=$('#ctl-cam'), ctlScreen=$('#ctl-screen'), ctlEnd=$('#ctl-end'), ctlFull=$('#ctl-full'), ctlAdd=$('#ctl-add');
const ctlEmoji=$('#ctl-emoji'), ctlSendQ=$('#ctl-send-q');
const emojiPicker=$('#emoji-picker'), sqPanel=$('#sq-panel');
const callGrid=$('#call-grid'), callTimer=$('#call-timer'), callCount=$('#call-count');
const toastEl=$('#toast'), toastMsg=$('#toast-msg');

// Secure Host room
const hostList=$('#host-participant-list'), hostCountEl=$('#host-count');
const exchIdle=$('#host-exch-idle'), exchOffer=$('#host-exch-offer'), exchAnswer=$('#host-exch-answer');
const hostOfferOut=$('#host-offer-out'), hostAnswerIn=$('#host-answer-in');
const btnAddPart=$('#btn-add-participant'), btnEnterCall=$('#btn-enter-call');

// Secure Join
const joinOfferIn=$('#join-offer-in'), joinAnswerOut=$('#join-answer-out');
const joinStatus=$('#join-status'), joinEnterCall=$('#join-enter-call');
const joinStep1=$('#join-step1'), joinStep2=$('#join-step2');

// Secure Add overlay (in-call)
const addOverlay=$('#add-overlay');
const addOfferOut=$('#add-offer-out'), addAnswerIn=$('#add-answer-in');
const addStepOffer=$('#add-step-offer'), addStepAnswer=$('#add-step-answer');

// Quick Connect refs
const qhPreview=$('#qh-preview'), qhPreviewOff=$('#qh-preview-off');
const qhRoomCode=$('#qh-room-code'), qhPartList=$('#qh-participant-list'), qhCount=$('#qh-count');
const qhStatus=$('#qh-status'), qhEnterCall=$('#qh-enter-call');
const qjPreview=$('#qj-preview'), qjPreviewOff=$('#qj-preview-off');
const qjCodeInput=$('#qj-code-input'), qjStatus=$('#qj-status');
const qjEnterCall=$('#qj-enter-call');

// ── State ──
const myId = crypto.randomUUID().slice(0,8);
let myName = '';
let isHost = false;
let connectMode = 'quick'; // 'quick' or 'secure'
let localStream = null, screenStream = null;
let micOn = true, camOn = true;
let timerInterval = null, callSeconds = 0;
let inCall = false;
let pendingPC = null; // PC being set up during manual exchange
let myPeer = null; // PeerJS instance (quick mode)
let roomCode = '';

const peers = new Map();
const MAX_PEERS = 6;
const RTC_CFG = { iceServers: [{ urls:'stun:stun.l.google.com:19302' },{ urls:'stun:stun1.google.com:19302' }] };
let sendQuality = 'medium'; // 'high', 'medium', 'low'

// Broadcast a message to all peers regardless of connect mode
function broadcastAny(msg, exclude){
  const s=typeof msg==='string'?msg:JSON.stringify(msg);
  peers.forEach((p,id)=>{
    if(id===exclude) return;
    if(p.dc&&p.dc.readyState==='open') p.dc.send(s);
    else if(p.dataConn&&p.dataConn.open) p.dataConn.send(s);
  });
}
// Send to a specific peer regardless of mode
function sendAny(peerId, msg){
  const s=typeof msg==='string'?msg:JSON.stringify(msg);
  const p=peers.get(peerId); if(!p)return;
  if(p.dc&&p.dc.readyState==='open') p.dc.send(s);
  else if(p.dataConn&&p.dataConn.open) p.dataConn.send(s);
}



function genRoomCode(){ const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<6;i++)s+=c[Math.floor(Math.random()*c.length)]; return s; }
function quickRoomLink(code){ const u=new URL(window.location); u.searchParams.set('room',code); return u.toString(); }

// ── Helpers ──
function toast(m,ms=3000){ toastMsg.textContent=m; toastEl.classList.remove('hidden'); clearTimeout(toastEl._t); toastEl._t=setTimeout(()=>toastEl.classList.add('hidden'),ms); }
function fmtTime(s){ return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function encode(d){ return btoa(JSON.stringify(d)); }
function decode(s){
  try{
    const obj=JSON.parse(atob(s.trim()));
    // New format: {sdp:{type,sdp}, relay:'peerjs-id'}
    if(obj.sdp&&obj.relay) return {desc:new RTCSessionDescription(obj.sdp), relay:obj.relay};
    // Old format: plain SDP object
    return {desc:new RTCSessionDescription(obj), relay:null};
  }catch{ return {desc:null,relay:null}; }
}
function waitICE(pc){ return new Promise(r=>{ if(pc.iceGatheringState==='complete'){r();return;} const t=setTimeout(r,6000); pc.addEventListener('icegatheringstatechange',()=>{ if(pc.iceGatheringState==='complete'){clearTimeout(t);r();} }); }); }
function setOfferURL(b64){ const u=new URL(window.location); u.searchParams.set('offer',b64); history.replaceState(null,'',u); }
function clearOfferURL(){ const u=new URL(window.location); u.searchParams.delete('offer'); history.replaceState(null,'',u); }
function getOfferLink(b64){ const u=new URL(window.location); u.searchParams.set('offer',b64); return u.toString(); }
function totalPeers(){ return peers.size + 1; } // +1 for self

// ── Media ──
async function acquireMedia(){
  try{ localStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:{echoCancellation:true,noiseSuppression:true}}); micOn=true;camOn=true; }
  catch{ try{ localStream=await navigator.mediaDevices.getUserMedia({audio:true}); micOn=true;camOn=false;toast('Camera unavailable — audio only'); }catch{ localStream=null;micOn=false;camOn=false;toast('No camera or mic found'); } }
  syncBtns();
}
function attachPreview(vid,ph){ if(localStream&&localStream.getVideoTracks().length>0&&camOn){vid.srcObject=localStream;ph.classList.add('hidden');}else{vid.srcObject=localStream;ph.classList.remove('hidden');} }
function syncBtns(){ [hostMic,joinMic,ctlMic].forEach(b=>b.classList.toggle('active',micOn)); [hostCam,joinCam,ctlCam].forEach(b=>b.classList.toggle('active',camOn)); }
function toggleMic(){ micOn=!micOn; if(localStream)localStream.getAudioTracks().forEach(t=>t.enabled=micOn); syncBtns(); broadcastAll({type:'cam-status',from:myId,mic:micOn,cam:camOn}); }
function toggleCam(){ camOn=!camOn; if(localStream)localStream.getVideoTracks().forEach(t=>t.enabled=camOn); hostPreviewOff.classList.toggle('hidden',camOn); joinPreviewOff.classList.toggle('hidden',camOn); updateLocalTileAvatar(); syncBtns(); broadcastAll({type:'cam-status',from:myId,mic:micOn,cam:camOn}); }

// ── Peer Connection Factory ──
function createPC(peerId){
  const pc = new RTCPeerConnection(RTC_CFG);
  if(localStream) localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  pc.ontrack = e => {
    const p=peers.get(peerId); if(p){p.stream=e.streams[0];} updateRemoteTile(peerId,e.streams[0]);
  };
  pc.onconnectionstatechange = () => {
    const s=pc.connectionState;
    console.log(`[RTC ${peerId}] ${s}`);
    if(s==='connected') onPeerConnected(peerId);
    else if(s==='disconnected'||s==='failed'||s==='closed') onPeerLeft(peerId);
  };
  pc.oniceconnectionstatechange = () => console.log(`[ICE ${peerId}] ${pc.iceConnectionState}`);
  return pc;
}

function setupDC(dc, peerId){
  dc.onopen = () => { console.log(`[DC ${peerId}] open`); dc.send(JSON.stringify({type:'display-name',from:myId,name:myName})); };
  dc.onmessage = e => handleMsg(peerId, e.data);
  dc.onclose = () => console.log(`[DC ${peerId}] closed`);
}

// ── Messaging ──
function sendTo(peerId, msg){
  const p=peers.get(peerId);
  if(p&&p.dc&&p.dc.readyState==='open') p.dc.send(typeof msg==='string'?msg:JSON.stringify(msg));
}
function broadcastAll(msg, exclude){
  const s=typeof msg==='string'?msg:JSON.stringify(msg);
  peers.forEach((p,id)=>{ if(id!==exclude&&p.dc&&p.dc.readyState==='open') p.dc.send(s); });
}

function handleMsg(fromId, raw){
  let msg; try{msg=JSON.parse(raw);}catch{return;}
  // Host relay: forward messages with a "to" field to the target peer
  if(isHost && msg.to && msg.to !== myId){
    sendTo(msg.to, raw); return;
  }
  switch(msg.type){
    case 'display-name': {
      const p=peers.get(fromId); if(p)p.name=msg.name;
      updatePeerLabel(fromId, msg.name);
      break;
    }
    case 'cam-status': {
      updateRemoteTileAvatar(msg.from, msg.cam);
      break;
    }
    case 'peer-list': {
      // Joiner: received list of existing peers from host — create offers to each
      (msg.peers||[]).forEach(pid => autoConnect(pid, true));
      break;
    }
    case 'new-peer': {
      // Existing joiner: new peer joined — create offer for them
      autoConnect(msg.peerId, true);
      break;
    }
    case 'sdp-offer': {
      // Received an offer relayed through host
      autoAnswer(msg.from, msg.sdp);
      break;
    }
    case 'sdp-answer': {
      // Received an answer relayed through host
      const p=peers.get(msg.from);
      if(p&&p.pc){ p.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.sdp))).catch(console.error); }
      break;
    }
    case 'ice-candidate': {
      const p=peers.get(msg.from);
      if(p&&p.pc&&msg.candidate) p.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(()=>{});
      break;
    }
    case 'peer-left': {
      onPeerLeft(msg.peerId);
      break;
    }
    case 'emoji-reaction': {
      showEmojiOnTile(msg.from||fromId, msg.emoji);
      break;
    }
    case 'quality-request': {
      handleQualityRequest(msg.from||fromId, msg.quality);
      break;
    }
  }
}

// ── Auto-Mesh (via host relay) ──
async function autoConnect(peerId, initiator){
  if(peers.has(peerId)) return;
  const pc = createPC(peerId);
  const entry = { pc, dc:null, stream:null, name:'Peer', connected:false };
  if(initiator){
    const dc = pc.createDataChannel('mesh');
    setupDC(dc, peerId);
    entry.dc = dc;
  } else {
    pc.ondatachannel = e => { entry.dc=e.channel; setupDC(e.channel, peerId); };
  }
  peers.set(peerId, entry);
  // ICE trickle through host relay
  pc.onicecandidate = e => {
    if(e.candidate){
      // Find the host peer to relay through (or if we ARE host, relay directly)
      const iceMsg = {type:'ice-candidate',from:myId,to:peerId,candidate:e.candidate.toJSON()};
      if(isHost){ sendTo(peerId, iceMsg); }
      else {
        // Send to host, who will relay
        const hostEntry = [...peers.values()].find(p=>p.isHostLink);
        if(hostEntry&&hostEntry.dc&&hostEntry.dc.readyState==='open') hostEntry.dc.send(JSON.stringify(iceMsg));
      }
    }
  };
  if(initiator){
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const offerMsg = {type:'sdp-offer',from:myId,to:peerId,sdp:JSON.stringify(pc.localDescription)};
    if(isHost){ sendTo(peerId, offerMsg); }
    else {
      const hostEntry=[...peers.values()].find(p=>p.isHostLink);
      if(hostEntry&&hostEntry.dc&&hostEntry.dc.readyState==='open') hostEntry.dc.send(JSON.stringify(offerMsg));
    }
  }
}

async function autoAnswer(fromId, sdpStr){
  let entry = peers.get(fromId);
  if(!entry){
    const pc = createPC(fromId);
    entry = { pc, dc:null, stream:null, name:'Peer', connected:false };
    pc.ondatachannel = e => { entry.dc=e.channel; setupDC(e.channel, fromId); };
    pc.onicecandidate = e => {
      if(e.candidate){
        const iceMsg={type:'ice-candidate',from:myId,to:fromId,candidate:e.candidate.toJSON()};
        if(isHost){ sendTo(fromId, iceMsg); }
        else {
          const hostEntry=[...peers.values()].find(p=>p.isHostLink);
          if(hostEntry&&hostEntry.dc&&hostEntry.dc.readyState==='open') hostEntry.dc.send(JSON.stringify(iceMsg));
        }
      }
    };
    peers.set(fromId, entry);
  }
  const offer = new RTCSessionDescription(JSON.parse(sdpStr));
  await entry.pc.setRemoteDescription(offer);
  const answer = await entry.pc.createAnswer();
  await entry.pc.setLocalDescription(answer);
  const ansMsg = {type:'sdp-answer',from:myId,to:fromId,sdp:JSON.stringify(entry.pc.localDescription)};
  if(isHost){ sendTo(fromId, ansMsg); }
  else {
    const hostEntry=[...peers.values()].find(p=>p.isHostLink);
    if(hostEntry&&hostEntry.dc&&hostEntry.dc.readyState==='open') hostEntry.dc.send(JSON.stringify(ansMsg));
  }
}

// ── Peer lifecycle ──
function onPeerConnected(peerId){
  const p=peers.get(peerId); if(!p||p.connected)return;
  p.connected=true;
  console.log(`[Mesh] Peer ${peerId} connected`);
  toast(`${p.name||'Peer'} connected`);
  if(isHost){
    // Tell all other connected peers about the new one
    peers.forEach((op,oid)=>{
      if(oid!==peerId && op.connected && op.isHostLink){
        sendTo(oid,{type:'new-peer',peerId});
        sendTo(peerId,{type:'new-peer',peerId:oid});
      }
    });
    if(connectMode==='quick') updateQuickHostUI();
    else updateHostUI();
    // If we're in a call, add the tile immediately
    if(inCall) addVideoTile(peerId, p.name, p.stream);
  }
  // Joiner: if we're waiting to enter call, enable the button
  if(!isHost && !inCall){
    joinStatus.classList.add('connected');
    joinStatus.querySelector('span').textContent='Connected to host!';
    joinEnterCall.style.display='';
  }
  if(inCall){
    addVideoTile(peerId, p.name, p.stream);
    updateGridCount();
  }
}

function onPeerLeft(peerId){
  const p=peers.get(peerId); if(!p)return;
  toast(`${p.name||'Peer'} left`);
  if(p.pc) try{p.pc.close();}catch{}
  peers.delete(peerId);
  removeVideoTile(peerId);
  updateGridCount();
  if(isHost) updateHostUI();
  broadcastAll({type:'peer-left',peerId});
}

// ── Host UI management ──
function updateHostUI(){
  // Rebuild participant list
  hostList.innerHTML='<div class="participant-item self"><span class="participant-dot online"></span><span class="participant-name">You ('+myName+')</span></div>';
  peers.forEach((p,id)=>{
    if(!p.isHostLink) return;
    const div=document.createElement('div');
    div.className='participant-item';
    div.innerHTML=`<span class="participant-dot ${p.connected?'online':'pending'}"></span><span class="participant-name">${p.name||'Connecting…'}</span>`;
    hostList.appendChild(div);
  });
  const cnt=totalPeers();
  hostCountEl.textContent=cnt;
  btnEnterCall.disabled = ![...peers.values()].some(p=>p.connected);
  btnAddPart.disabled = cnt >= MAX_PEERS;
  if(cnt>=MAX_PEERS) btnAddPart.textContent='Room Full (6/6)';
}

// ── Manual SDP exchange (Host ↔ Joiner) ──
function setExchState(which){
  [exchIdle,exchOffer,exchAnswer].forEach(e=>e.classList.remove('active'));
  which.classList.add('active');
}


async function hostGenOffer(){
  try {
    const peerId = crypto.randomUUID().slice(0,8);
    const pc = createPC(peerId);
    const dc = pc.createDataChannel('host-link');
    const entry = { pc, dc, stream:null, name:'Pending\u2026', connected:false, isHostLink:true, tempId:peerId };
    setupDC(dc, peerId);
    peers.set(peerId, entry);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitICE(pc);
    pendingPC = peerId;
    return encode(pc.localDescription);
  } catch(e) {
    console.error('[hostGenOffer] Error:', e);
    toast('Failed to generate PassKey: ' + e.message);
    return '';
  }
}


async function hostProcessAnswer(b64){
  try {
    const {desc} = decode(b64);
    if(!desc||desc.type!=='answer'){ toast('Invalid answer'); return false; }
    const p = peers.get(pendingPC);
    if(!p){ toast('No pending connection'); return false; }
    await p.pc.setRemoteDescription(desc);
    setExchState(exchIdle);
    pendingPC=null;
    toast('Participant connected!');
    return true;
  } catch(e) {
    console.error('[hostProcessAnswer] Error:', e);
    toast('Failed to connect: ' + e.message);
    return false;
  }
}

// ══════════════════════════════════════
// ── QUICK CONNECT (PeerJS room code) ──
// ══════════════════════════════════════

function updateQuickHostUI(){
  qhPartList.innerHTML='<div class="participant-item self"><span class="participant-dot online"></span><span class="participant-name">You ('+myName+')</span></div>';
  let cnt=1;
  peers.forEach(p=>{
    if(!p.connected) return;
    cnt++;
    const div=document.createElement('div'); div.className='participant-item';
    div.innerHTML='<span class="participant-dot online"></span><span class="participant-name">'+(p.name||'Peer')+'</span>';
    qhPartList.appendChild(div);
  });
  qhCount.textContent=cnt;
  qhEnterCall.disabled=cnt<2;
  if(cnt>=2){ qhStatus.classList.add('connected'); qhStatus.querySelector('span').textContent=cnt-1+' participant(s) connected'; }
}

let quickJoinRetries = 0;
const MAX_QJ_RETRIES = 8;

async function quickHost(){
  roomCode = genRoomCode();
  qhRoomCode.textContent = roomCode;
  try {
    myPeer = new Peer('mm-'+roomCode, {config:RTC_CFG});
    await new Promise((resolve,reject)=>{
      myPeer.on('open', resolve);
      myPeer.on('error', reject);
      setTimeout(()=>reject(new Error('timeout')),10000);
    });
  } catch(e){
    console.error('[quickHost] PeerJS error:', e);
    toast('Failed to create room: '+e.message);
    return;
  }
  console.log('[quickHost] Room code:', roomCode, 'PeerJS ID:', myPeer.id);
  toast('Room ready — share the code!');

  // Accept incoming connections
  myPeer.on('call', mediaConn=>{
    if(localStream) mediaConn.answer(localStream); else mediaConn.answer();
    quickConnectToPeer(mediaConn, null);
  });
  myPeer.on('connection', dataConn=>{
    const existing=[...peers.values()].find(p=>p.dataConn===dataConn);
    if(!existing) quickConnectToPeer(null, dataConn);
  });
  updateQuickHostUI();
}

function quickConnectToPeer(mediaConn, dataConn){
  const peerId = (mediaConn&&mediaConn.peer)||(dataConn&&dataConn.peer)||crypto.randomUUID().slice(0,8);
  let entry = peers.get(peerId);
  if(!entry){
    entry = {pc:null, dc:null, stream:null, name:'Peer', connected:false, isHostLink:true, mediaConn:null, dataConn:null};
    peers.set(peerId, entry);
  }
  if(mediaConn){
    entry.mediaConn = mediaConn;
    mediaConn.on('stream', s=>{ entry.stream=s; updateRemoteTile(peerId,s); });
    // Extract PC for quality control
    const waitPC=()=>{
      const pc=mediaConn.peerConnection;
      if(pc){entry.pc=pc;} else setTimeout(waitPC,200);
    };
    waitPC();
  }
  if(dataConn){
    entry.dataConn = dataConn;
    dataConn.on('open', ()=>{
      console.log(`[Quick DC ${peerId}] open`);
      dataConn.send(JSON.stringify({type:'display-name',from:myId,name:myName}));
      entry.connected=true;
      if(isHost) updateQuickHostUI();
      else {
        qjStatus.style.display='';
        qjStatus.classList.add('connected');
        qjStatus.querySelector('span').textContent='Connected to host!';
        qjEnterCall.style.display='';
      }
      toast((entry.name||'Peer')+' connected');
      if(inCall){ addVideoTile(peerId, entry.name, entry.stream); updateGridCount(); }
    });
    dataConn.on('data', raw=>handleMsg(peerId, raw));
    dataConn.on('close', ()=>onPeerLeft(peerId));
  }
}

async function quickJoin(code){
  try {
    myPeer = new Peer(undefined, {config:RTC_CFG});
    await new Promise((resolve,reject)=>{
      myPeer.on('open', resolve);
      myPeer.on('error', reject);
      setTimeout(()=>reject(new Error('timeout')),10000);
    });
  } catch(e){
    console.error('[quickJoin] PeerJS error:', e);
    toast('Connection failed: '+e.message);
    return;
  }
  const hostId = 'mm-'+code;
  const attemptConnect = ()=>{
    console.log(`[quickJoin] Attempt ${quickJoinRetries+1} connecting to ${hostId}`);
    qjStatus.querySelector('span').textContent='Connecting\u2026';
    // Media connection
    const mediaConn = myPeer.call(hostId, localStream||new MediaStream());
    if(!mediaConn){ retryOrFail(); return; }
    // Data connection
    const dataConn = myPeer.connect(hostId, {reliable:true});
    quickConnectToPeer(mediaConn, dataConn);

    mediaConn.on('error', retryOrFail);
    dataConn.on('error', retryOrFail);

    // Accept reverse calls from host
    myPeer.on('call', mc=>{
      if(localStream) mc.answer(localStream); else mc.answer();
      quickConnectToPeer(mc, null);
    });
  };

  const retryOrFail = ()=>{
    quickJoinRetries++;
    if(quickJoinRetries<MAX_QJ_RETRIES){
      qjStatus.querySelector('span').textContent=`Retrying (${quickJoinRetries}/${MAX_QJ_RETRIES})\u2026`;
      setTimeout(attemptConnect, 2000);
    } else {
      qjStatus.querySelector('span').textContent='Could not find room. Check the code.';
      toast('Room not found');
    }
  };

  attemptConnect();
}

// ══════════════════════════════════════
// ── LANDING PAGE HANDLERS ──
// ══════════════════════════════════════

// Quick Connect
$('#btn-quick-host').addEventListener('click', async()=>{
  myName=inputName.value.trim()||'Host'; isHost=true; connectMode='quick';
  showView('quick-host');
  await acquireMedia(); attachPreview(qhPreview, qhPreviewOff);
  await quickHost();
});
$('#btn-quick-join').addEventListener('click', async()=>{
  myName=inputName.value.trim()||'Guest'; isHost=false; connectMode='quick';
  showView('quick-join');
  await acquireMedia(); attachPreview(qjPreview, qjPreviewOff);
});
$('#qh-copy-link').addEventListener('click',()=>{ navigator.clipboard.writeText(quickRoomLink(roomCode)).then(()=>toast('Link copied! \ud83d\udd17')); });
$('#qh-copy-code').addEventListener('click',()=>{ navigator.clipboard.writeText(roomCode).then(()=>toast('Code copied! \ud83d\udccb')); });
qhEnterCall.addEventListener('click',()=>enterCall());
$('#qh-back').addEventListener('click',()=>{ cleanup(); showView('landing'); });
$('#qh-mic').addEventListener('click',toggleMic);
$('#qh-cam').addEventListener('click',toggleCam);
$('#qj-connect').addEventListener('click',async()=>{
  const code=qjCodeInput.value.trim().toUpperCase();
  if(code.length<4){toast('Enter the room code');return;}
  quickJoinRetries=0;
  qjStatus.style.display='';
  qjStatus.querySelector('span').textContent='Connecting\u2026';
  await quickJoin(code);
});
qjEnterCall.addEventListener('click',()=>enterCall());
$('#qj-back').addEventListener('click',()=>{ cleanup(); showView('landing'); });
$('#qj-mic').addEventListener('click',toggleMic);


// Secure Connect
$('#btn-secure-host').addEventListener('click', async()=>{
  myName=inputName.value.trim()||'Host'; isHost=true; connectMode='secure';
  showView('host');
  await acquireMedia(); attachPreview(hostPreview, hostPreviewOff);
  updateHostUI(); ctlAdd.style.display='';
});
$('#btn-secure-join').addEventListener('click', async()=>{
  myName=inputName.value.trim()||'Guest'; isHost=false; connectMode='secure';
  showView('join');
  await acquireMedia(); attachPreview(joinPreview, joinPreviewOff);
});

// ── SECURE HOST HANDLERS ──
btnAddPart.addEventListener('click', async()=>{
  if(totalPeers()>=MAX_PEERS){toast('Room is full');return;}
  setExchState(exchOffer);
  hostOfferOut.value='Generating\u2026';
  const offerB64=await hostGenOffer();
  hostOfferOut.value=offerB64;
  setOfferURL(offerB64);
  toast('PassKey ready \u2014 share the link or copy');
});

$('#host-copy-offer').addEventListener('click',()=>{ navigator.clipboard.writeText(hostOfferOut.value).then(()=>toast('PassKey copied! \ud83d\udccb')); });
$('#host-copy-link').addEventListener('click',()=>{ navigator.clipboard.writeText(getOfferLink(hostOfferOut.value)).then(()=>toast('Link copied! \ud83d\udd17')); });
$('#host-next-step').addEventListener('click',()=>{ setExchState(exchAnswer); hostAnswerIn.value=''; });
$('#host-connect-peer').addEventListener('click',async()=>{ await hostProcessAnswer(hostAnswerIn.value); });
$('#host-cancel-exch').addEventListener('click',()=>{
  if(pendingPC){ const p=peers.get(pendingPC); if(p&&p.pc)p.pc.close(); peers.delete(pendingPC); pendingPC=null; }
  setExchState(exchIdle);
});
btnEnterCall.addEventListener('click',()=>enterCall());
$('#host-back').addEventListener('click',()=>{ cleanup(); clearOfferURL(); showView('landing'); });
hostMic.addEventListener('click',toggleMic);
hostCam.addEventListener('click',toggleCam);

// ── SECURE JOINER HANDLERS ──
async function joinerProcessOffer(offerB64){
  const {desc} = decode(offerB64);
  if(!desc||desc.type!=='offer'){toast('Invalid Meeting PassKey');return;}
  const pc=createPC('host');
  const entry={pc,dc:null,stream:null,name:'Host',connected:false,isHostLink:true};
  pc.ondatachannel=e=>{
    if(entry.dc) return;
    entry.dc=e.channel;
    setupDC(e.channel,'host');
  };
  peers.set('host',entry);
  await pc.setRemoteDescription(desc);
  const answer=await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitICE(pc);
  const answerB64 = encode(pc.localDescription);
  joinAnswerOut.value=answerB64;
  joinStep1.classList.remove('active');
  joinStep2.classList.add('active');
  toast('Response Key ready \u2014 send it back to the host');
}


$('#join-process').addEventListener('click', async()=>{
  try {
    await joinerProcessOffer(joinOfferIn.value);
  } catch(e) {
    console.error('[join-process] Error:', e);
    toast('Failed to process PassKey: ' + e.message);
  }
});

$('#join-copy').addEventListener('click',()=>{ navigator.clipboard.writeText(joinAnswerOut.value).then(()=>toast('Copied! \ud83d\udccb')); });
joinEnterCall.addEventListener('click',()=>enterCall());
$('#join-back').addEventListener('click',()=>{ cleanup(); joinStep2.classList.remove('active'); joinStep1.classList.add('active'); joinOfferIn.value=''; clearOfferURL(); showView('landing'); });
joinMic.addEventListener('click',toggleMic);
joinCam.addEventListener('click',toggleCam);

// ── Call lifecycle ──
function enterCall(){
  if(inCall)return;
  inCall=true;
  showView('call');
  syncBtns();
  // Add local tile
  addVideoTile('local',myName,localStream,true);
  // Add all connected peers
  peers.forEach((p,id)=>{ if(p.connected&&p.stream) addVideoTile(id,p.name,p.stream); });
  updateGridCount();
  // Timer
  callSeconds=0; callTimer.textContent='00:00';
  timerInterval=setInterval(()=>{callSeconds++;callTimer.textContent=fmtTime(callSeconds);},1000);
  // Show add button for host
  if(isHost) ctlAdd.style.display='';
  toast('Connected! 🎉 Full mesh P2P established.');
}

function endCall(){
  inCall=false;
  if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
  cleanup();
  clearOfferURL();
  const u=new URL(window.location); u.searchParams.delete('room'); history.replaceState(null,'',u);
  showView('landing');
  toast('Call ended');
}

function cleanup(){
  peers.forEach((p)=>{ if(p.pc)try{p.pc.close();}catch{} if(p.mediaConn)try{p.mediaConn.close();}catch{} if(p.dataConn)try{p.dataConn.close();}catch{} });
  peers.clear();
  if(myPeer){try{myPeer.destroy();}catch{}myPeer=null;}
  if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
  if(screenStream){screenStream.getTracks().forEach(t=>t.stop());screenStream=null;}
  callGrid.innerHTML='';
  pendingPC=null;
  ctlScreen.classList.remove('active');
}

// (real implementations are defined below)

// ── Video tiles ──
function addVideoTile(id,name,stream,isSelf){
  if($(`#tile-${id}`)) return; // already exists
  const tile=document.createElement('div');
  tile.className='video-tile'+(isSelf?' self':'');
  tile.id=`tile-${id}`;
  const initial=(name||'?')[0].toUpperCase();
  const hasVid=stream&&stream.getVideoTracks().length>0;
  // Build tile inner HTML
  let html=`<video autoplay ${isSelf?'muted':''} playsinline></video>`;
  html+=`<div class="emoji-container"></div>`;
  html+=`<div class="tile-avatar ${hasVid?'hidden':''}"><div class="avatar-circle"><span class="avatar-initial">${initial}</span></div></div>`;
  if(isSelf){
    html+=`<div class="tile-label">${name||'You'}<span class="edit-hint">✎</span></div>`;
  } else {
    html+=`<div class="tile-label">${name||'Peer'}</div>`;
    html+=`<div class="tile-controls"><div class="tile-ctrl-bar">`;
    // Mute toggle
    html+=`<button class="tile-ctrl-btn mute-toggle" title="Mute"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button>`;
    // Volume slider
    html+=`<input type="range" class="vol-slider" min="0" max="100" value="100" title="Volume">`;
    // Video toggle
    html+=`<button class="tile-ctrl-btn vid-toggle" title="Hide Video"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
    // Quality dropdown
    html+=`<div class="tile-quality-wrap"><button class="tile-ctrl-btn tile-quality-btn" title="Receive Quality">HD</button>`;
    html+=`<div class="tile-quality-dd"><button data-rq="high" class="active">HD · Full</button><button data-rq="medium">SD · Medium</button><button data-rq="low">LD · Low</button></div></div>`;
    html+=`</div></div>`;
  }
  tile.innerHTML=html;
  const vid=tile.querySelector('video');
  if(stream) vid.srcObject=stream;
  callGrid.appendChild(tile);
  // Wire up tile controls
  if(!isSelf) setupTileControls(tile, id);
  if(isSelf) setupSelfTileEdit(tile);
  updateGridCount();
}

function setupTileControls(tile, peerId){
  const vid=tile.querySelector('video');
  // Volume slider
  const vol=tile.querySelector('.vol-slider');
  if(vol) vol.addEventListener('input',()=>{ vid.volume=vol.value/100; });
  // Mute toggle
  const muteBtn=tile.querySelector('.mute-toggle');
  if(muteBtn) muteBtn.addEventListener('click',()=>{
    vid.muted=!vid.muted;
    muteBtn.classList.toggle('off',vid.muted);
    muteBtn.title=vid.muted?'Unmute':'Mute';
    if(vid.muted){ vol.value=0; } else { vol.value=100; vid.volume=1; }
  });
  // Video toggle (local only)
  const vidBtn=tile.querySelector('.vid-toggle');
  if(vidBtn) vidBtn.addEventListener('click',()=>{
    const hidden=tile.classList.toggle('tile-vid-hidden');
    vidBtn.classList.toggle('off',hidden);
    vidBtn.title=hidden?'Show Video':'Hide Video';
  });
  // Receive quality dropdown
  const qBtn=tile.querySelector('.tile-quality-btn');
  const qDd=tile.querySelector('.tile-quality-dd');
  if(qBtn&&qDd){
    qBtn.addEventListener('click',(e)=>{
      e.stopPropagation();
      qDd.classList.toggle('open');
    });
    qDd.querySelectorAll('button').forEach(b=>{
      b.addEventListener('click',(e)=>{
        e.stopPropagation();
        const q=b.dataset.rq;
        qDd.querySelectorAll('button').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        qBtn.textContent=q==='high'?'HD':q==='medium'?'SD':'LD';
        qDd.classList.remove('open');
        // Request peer to lower quality sent to us
        sendAny(peerId,{type:'quality-request',from:myId,quality:q});
        toast(`Requested ${q} quality from ${peers.get(peerId)?.name||'peer'}`);
      });
    });
    // Close dropdown when clicking elsewhere
    document.addEventListener('click',()=>qDd.classList.remove('open'));
  }
}

function setupSelfTileEdit(tile){
  const label=tile.querySelector('.tile-label');
  label.addEventListener('click',()=>{
    const inp=document.createElement('input');
    inp.type='text'; inp.className='tile-name-input';
    inp.value=myName; inp.maxLength=20;
    label.style.display='none';
    tile.appendChild(inp);
    inp.focus(); inp.select();
    function finish(){
      const v=inp.value.trim();
      if(v&&v!==myName){
        myName=v;
        label.childNodes[0].textContent=v;
        // Broadcast new name to all peers
        broadcastAny({type:'display-name',from:myId,name:myName});
        toast('Name updated to '+v);
      }
      inp.remove();
      label.style.display='';
    }
    inp.addEventListener('blur',finish);
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter')inp.blur(); if(e.key==='Escape'){inp.value=myName;inp.blur();} });
  });
}

// ── Emoji Reactions ──
function showEmojiOnTile(peerId, emoji){
  // Map 'local' for self
  const tileId = peerId===myId ? 'local' : peerId;
  const tile=$(`#tile-${tileId}`);
  if(!tile) return;
  const container=tile.querySelector('.emoji-container');
  if(!container) return;
  const el=document.createElement('span');
  el.className='emoji-float';
  el.textContent=emoji;
  // Random horizontal offset
  el.style.left=`${35+Math.random()*30}%`;
  container.appendChild(el);
  el.addEventListener('animationend',()=>el.remove());
}

function sendReaction(emoji){
  // Show locally
  showEmojiOnTile(myId, emoji);
  // Broadcast to all peers
  broadcastAny({type:'emoji-reaction',from:myId,emoji});
}

// ── Quality Control ──
function getPC(peerId){
  const p=peers.get(peerId); if(!p)return null;
  return p.pc||(p.mediaConn&&p.mediaConn.peerConnection)||null;
}

const QUALITY_PRESETS={
  high:  {maxBitrate:2500000, scaleResolutionDownBy:1},
  medium:{maxBitrate:500000,  scaleResolutionDownBy:2},
  low:   {maxBitrate:150000,  scaleResolutionDownBy:4}
};

function handleQualityRequest(fromId, quality){
  const pc=getPC(fromId);
  if(!pc) return;
  const sender=pc.getSenders().find(s=>s.track&&s.track.kind==='video');
  if(!sender) return;
  applyQualityToSender(sender, quality);
}

function applyQualityToSender(sender, quality){
  const preset=QUALITY_PRESETS[quality]||QUALITY_PRESETS.high;
  try{
    const params=sender.getParameters();
    if(!params.encodings||!params.encodings.length) params.encodings=[{}];
    params.encodings[0].maxBitrate=preset.maxBitrate;
    if(preset.scaleResolutionDownBy>1) params.encodings[0].scaleResolutionDownBy=preset.scaleResolutionDownBy;
    else delete params.encodings[0].scaleResolutionDownBy;
    sender.setParameters(params).catch(e=>console.warn('[Quality]',e));
  }catch(e){console.warn('[Quality]',e);}
}

function setSendQuality(quality){
  sendQuality=quality;
  peers.forEach(p=>{
    const pc=p.pc||(p.mediaConn&&p.mediaConn.peerConnection);
    if(!pc) return;
    const sender=pc.getSenders().find(s=>s.track&&s.track.kind==='video');
    if(sender) applyQualityToSender(sender, quality);
  });
}

function removeVideoTile(id){
  const el=$(`#tile-${id}`);
  if(el) el.remove();
  updateGridCount();
}

function updateGridCount(){
  const n=callGrid.children.length;
  callGrid.setAttribute('data-count',Math.min(n,6));
  callCount.textContent=n;
}

function updateRemoteTile(peerId,stream){
  const tile=$(`#tile-${peerId}`);
  if(tile){
    tile.querySelector('video').srcObject=stream;
    const av=tile.querySelector('.tile-avatar');
    if(stream&&stream.getVideoTracks().length>0) av.classList.add('hidden');
  } else if(inCall){
    const p=peers.get(peerId);
    addVideoTile(peerId, p?p.name:'Peer', stream);
  }
}

function updateRemoteTileAvatar(peerId, camEnabled){
  const tile=$(`#tile-${peerId}`);
  if(tile){ tile.querySelector('.tile-avatar').classList.toggle('hidden',camEnabled); }
}

function updateLocalTileAvatar(){
  const tile=$('#tile-local');
  if(tile){ tile.querySelector('.tile-avatar').classList.toggle('hidden',camOn); }
}

function updatePeerLabel(peerId,name){
  const tile=$(`#tile-${peerId}`);
  if(tile) tile.querySelector('.tile-label').textContent=name;
  if(isHost) updateHostUI();
}


// ── Call controls ──
ctlMic.addEventListener('click',toggleMic);
ctlCam.addEventListener('click',toggleCam);
ctlEnd.addEventListener('click',endCall);
ctlFull.addEventListener('click',()=>{ if(!document.fullscreenElement)document.documentElement.requestFullscreen();else document.exitFullscreen(); });

// Emoji picker
ctlEmoji.addEventListener('click',(e)=>{
  e.stopPropagation();
  sqPanel.classList.add('hidden');
  emojiPicker.classList.toggle('hidden');
  ctlEmoji.classList.toggle('active',!emojiPicker.classList.contains('hidden'));
  ctlSendQ.classList.remove('active');
});
emojiPicker.querySelectorAll('.emoji-pick-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    sendReaction(btn.dataset.emoji);
    emojiPicker.classList.add('hidden');
    ctlEmoji.classList.remove('active');
  });
});

// Send quality panel
ctlSendQ.addEventListener('click',(e)=>{
  e.stopPropagation();
  emojiPicker.classList.add('hidden');
  sqPanel.classList.toggle('hidden');
  ctlSendQ.classList.toggle('active',!sqPanel.classList.contains('hidden'));
  ctlEmoji.classList.remove('active');
});
sqPanel.querySelectorAll('.sq-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    sqPanel.querySelectorAll('.sq-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    setSendQuality(btn.dataset.sq);
    sqPanel.classList.add('hidden');
    ctlSendQ.classList.remove('active');
    toast('Send quality: '+btn.textContent.trim());
  });
});

// Close popups on outside click
document.addEventListener('click',()=>{
  emojiPicker.classList.add('hidden');
  sqPanel.classList.add('hidden');
  ctlEmoji.classList.remove('active');
  ctlSendQ.classList.remove('active');
});
// Prevent popup click from closing
emojiPicker.addEventListener('click',e=>e.stopPropagation());
sqPanel.addEventListener('click',e=>e.stopPropagation());

// Screen share
ctlScreen.addEventListener('click',async()=>{
  if(screenStream){
    screenStream.getTracks().forEach(t=>t.stop()); screenStream=null;
    ctlScreen.classList.remove('active');
    if(localStream){ const c=localStream.getVideoTracks()[0]; if(c) replaceVideoTrackAll(c); }
    const lt=$('#tile-local video'); if(lt)lt.srcObject=localStream;
    toast('Screen sharing stopped');
  } else {
    try{
      screenStream=await navigator.mediaDevices.getDisplayMedia({video:true});
      ctlScreen.classList.add('active');
      const st=screenStream.getVideoTracks()[0];
      replaceVideoTrackAll(st);
      const lt=$('#tile-local video'); if(lt)lt.srcObject=screenStream;
      st.onended=()=>ctlScreen.click();
      toast('Sharing screen');
    }catch{}
  }
});

function replaceVideoTrackAll(track){
  peers.forEach(p=>{
    const pc = p.pc || (p.mediaConn && p.mediaConn.peerConnection);
    if(!pc)return;
    const sender=pc.getSenders().find(s=>s.track&&s.track.kind==='video');
    if(sender)sender.replaceTrack(track);
  });
}

// ── Add participant during call (host only) ──
ctlAdd.addEventListener('click',async()=>{
  if(totalPeers()>=MAX_PEERS){toast('Room is full');return;}
  addOverlay.classList.remove('hidden');
  addStepOffer.classList.add('active'); addStepAnswer.classList.remove('active');
  addOfferOut.value='Generating…'; addAnswerIn.value='';
  const b64=await hostGenOffer(connectMode==='quick');
  addOfferOut.value=b64;
  setOfferURL(b64);
});
$('#add-overlay-close').addEventListener('click',()=>{
  addOverlay.classList.add('hidden');
  clearOfferURL();
  if(pendingPC){const p=peers.get(pendingPC);if(p&&p.pc)p.pc.close();peers.delete(pendingPC);pendingPC=null;}
});
$('#add-copy-offer').addEventListener('click',()=>{ navigator.clipboard.writeText(addOfferOut.value).then(()=>toast('Offer copied! 📋')); });
$('#add-copy-link').addEventListener('click',()=>{ navigator.clipboard.writeText(getOfferLink(addOfferOut.value)).then(()=>toast('Link copied! 🔗')); });
$('#add-next-step').addEventListener('click',()=>{ addStepOffer.classList.remove('active'); addStepAnswer.classList.add('active'); });
$('#add-connect').addEventListener('click',async()=>{
  const ok=await hostProcessAnswer(addAnswerIn.value);
  if(ok){ addOverlay.classList.add('hidden'); clearOfferURL(); }
});

// ── Auto-join from URL ──
(function checkURL(){
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  const offerB64 = params.get('offer');
  if(room){
    setTimeout(async()=>{
      myName = inputName.value.trim() || 'Guest';
      isHost = false; connectMode = 'quick';
      showView('quick-join');
      await acquireMedia(); attachPreview(qjPreview, qjPreviewOff);
      qjCodeInput.value = room;
      qjStatus.style.display='';
      quickJoinRetries=0;
      await quickJoin(room);
    }, 300);
  } else if(offerB64){
    setTimeout(async()=>{
      myName = inputName.value.trim() || 'Guest';
      isHost = false; connectMode = 'secure';
      showView('join');
      await acquireMedia(); attachPreview(joinPreview, joinPreviewOff);
      joinOfferIn.value = offerB64;
      toast('Meeting PassKey detected \u2014 click Generate Response Key');
    }, 300);
  }
})();

// Cleanup on unload
window.addEventListener('beforeunload',cleanup);

// ── Mobile background/foreground resilience ──
document.addEventListener('visibilitychange', async ()=>{
  if(document.visibilityState !== 'visible') return;
  console.log('[Visibility] Page returned to foreground');

  // 1. Reconnect PeerJS if it died while in background (Quick Connect)
  if(myPeer && (myPeer.destroyed || myPeer.disconnected)){
    console.log('[Visibility] PeerJS died in background, reconnecting');
    if(isHost && roomCode){
      try {
        myPeer = new Peer('mm-'+roomCode, {config:RTC_CFG});
        await new Promise((resolve,reject)=>{
          myPeer.on('open', resolve);
          myPeer.on('error', reject);
          setTimeout(()=>reject(new Error('timeout')), 8000);
        });
        myPeer.on('call', mc=>{
          if(localStream) mc.answer(localStream); else mc.answer();
          quickConnectToPeer(mc, null);
        });
        myPeer.on('connection', dc=>{
          quickConnectToPeer(null, dc);
        });
        console.log('[Visibility] PeerJS reconnected');
        toast('Connection restored \u2714');
      } catch(e){
        console.warn('[Visibility] PeerJS reconnect failed:', e.message);
        toast('Room connection lost');
      }
    }
  }

  // 2. Restart ICE for any disconnected WebRTC peers
  peers.forEach((p, pid) => {
    if(!p.pc) return;
    const iceState = p.pc.iceConnectionState;
    if(iceState === 'disconnected' || iceState === 'failed'){
      console.log(`[Visibility] Restarting ICE for peer ${pid} (was ${iceState})`);
      p.pc.restartIce();
    }
  });
});
})();
