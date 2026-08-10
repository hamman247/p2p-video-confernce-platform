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
const RTC_CFG = { iceServers: [{ urls:'stun:stun.l.google.com:19302' },{ urls:'stun:stun1.l.google.com:19302' }] };

function genRoomCode(){ const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<6;i++)s+=c[Math.floor(Math.random()*c.length)]; return s; }

// ── Helpers ──
function toast(m,ms=3000){ toastMsg.textContent=m; toastEl.classList.remove('hidden'); clearTimeout(toastEl._t); toastEl._t=setTimeout(()=>toastEl.classList.add('hidden'),ms); }
function fmtTime(s){ return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function encode(d){ return btoa(JSON.stringify(d)); }
function decode(s){ try{ return new RTCSessionDescription(JSON.parse(atob(s.trim()))); }catch{ return null; } }
function waitICE(pc){ return new Promise(r=>{ if(pc.iceGatheringState==='complete'){r();return;} const t=setTimeout(r,6000); pc.addEventListener('icegatheringstatechange',()=>{ if(pc.iceGatheringState==='complete'){clearTimeout(t);r();} }); }); }
function setOfferURL(b64){ const u=new URL(window.location); u.searchParams.set('offer',b64); history.replaceState(null,'',u); }
function clearOfferURL(){ const u=new URL(window.location); u.searchParams.delete('offer'); history.replaceState(null,'',u); }
function getOfferLink(b64){ const u=new URL(window.location); u.searchParams.set('offer',b64); return u.toString(); }
function totalPeers(){ return peers.size + 1; } // +1 for self

// ── Media ──
async function acquireMedia(){
  try{ localStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:{echoCancellation:true,noiseSuppression:true}}); micOn=true;camOn=true; }
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
    updateHostUI();
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
  const peerId = crypto.randomUUID().slice(0,8); // placeholder until joiner tells us theirs
  const pc = createPC(peerId);
  const dc = pc.createDataChannel('host-link');
  const entry = { pc, dc, stream:null, name:'Pending…', connected:false, isHostLink:true, tempId:peerId };
  // When joiner sends display-name, we'll know their real ID and name
  setupDC(dc, peerId);
  // ICE candidates for manual exchange: wait for gathering
  peers.set(peerId, entry);
  pc.createDataChannel('ctrl'); // ensure data section
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitICE(pc);
  pendingPC = peerId;
  return encode(pc.localDescription);
}

async function hostProcessAnswer(b64){
  const desc = decode(b64);
  if(!desc||desc.type!=='answer'){ toast('Invalid answer'); return false; }
  const p = peers.get(pendingPC);
  if(!p){ toast('No pending connection'); return false; }
  await p.pc.setRemoteDescription(desc);
  setExchState(exchIdle);
  pendingPC=null;
  toast('Participant connected!');
  return true;
}

// ══════════════════════════════════════
// ── QUICK CONNECT (PeerJS) ──
// ══════════════════════════════════════

function quickRoomLink(code){ const u=new URL(window.location); u.search=''; u.searchParams.set('room',code); return u.toString(); }

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

function setupQuickPeerHandlers(peer, peerId, entry){
  // Data connection
  function handleDataConn(conn){
    entry.dataConn=conn;
    conn.on('open',()=>{ conn.send(JSON.stringify({type:'display-name',name:myName,peerId:myPeer.id})); });
    conn.on('data', raw=>{
      let msg; try{msg=JSON.parse(raw);}catch{return;}
      if(msg.type==='display-name'){ entry.name=msg.name; updatePeerLabel(peerId,msg.name); if(isHost)updateQuickHostUI(); }
      if(msg.type==='cam-status') updateRemoteTileAvatar(peerId, msg.cam);
    });
  }
  // If we initiated the data connection
  if(entry.dataConn) handleDataConn(entry.dataConn);
  // If they connect to us
  peer.on('connection', conn=>{ if(!entry.dataConn) handleDataConn(conn); });
}

// Quick Host
async function quickHost(){
  roomCode=genRoomCode();
  myPeer=new Peer(roomCode,{config:RTC_CFG});
  myPeer.on('error',e=>{ toast('PeerJS error: '+e.type); console.error(e); });
  myPeer.on('open',id=>{
    qhRoomCode.textContent=id;
    const u=new URL(window.location); u.search=''; u.searchParams.set('room',id); history.replaceState(null,'',u);
    toast('Room created! Share the code or link.');
  });
  // Incoming calls (joiners)
  myPeer.on('call', call=>{
    const pid=call.peer;
    call.answer(localStream);
    let entry=peers.get(pid);
    if(!entry){ entry={dataConn:null,mediaConn:call,stream:null,name:'Peer',connected:false}; peers.set(pid,entry); }
    else { entry.mediaConn=call; }
    call.on('stream', s=>{ entry.stream=s; entry.connected=true; updateRemoteTile(pid,s); updateQuickHostUI(); if(inCall)addVideoTile(pid,entry.name,s); });
    call.on('close',()=>onQuickPeerLeft(pid));
    // Tell new joiner about all existing peers
    setTimeout(()=>{
      const peerIds=[...peers.keys()].filter(k=>k!==pid&&peers.get(k).connected);
      if(entry.dataConn&&entry.dataConn.open) entry.dataConn.send(JSON.stringify({type:'peer-list',peers:peerIds}));
      // Tell existing peers about new one
      peers.forEach((p,k)=>{ if(k!==pid&&p.connected&&p.dataConn&&p.dataConn.open) p.dataConn.send(JSON.stringify({type:'new-peer',peerId:pid})); });
    },1000);
  });
  // Incoming data connections
  myPeer.on('connection', conn=>{
    const pid=conn.peer;
    let entry=peers.get(pid);
    if(!entry){ entry={dataConn:conn,mediaConn:null,stream:null,name:'Peer',connected:false}; peers.set(pid,entry); }
    else { entry.dataConn=conn; }
    conn.on('open',()=>{ conn.send(JSON.stringify({type:'display-name',name:myName,peerId:myPeer.id})); });
    conn.on('data', raw=>{
      let msg; try{msg=JSON.parse(raw);}catch{return;}
      if(msg.type==='display-name'){ entry.name=msg.name; updatePeerLabel(pid,msg.name); updateQuickHostUI(); }
      if(msg.type==='cam-status') updateRemoteTileAvatar(pid, msg.cam);
    });
  });
}

function onQuickPeerLeft(pid){
  const p=peers.get(pid); if(!p)return;
  toast((p.name||'Peer')+' left');
  peers.delete(pid); removeVideoTile(pid); updateGridCount();
  if(isHost) updateQuickHostUI();
}

// Quick Join
async function quickJoin(code){
  myPeer=new Peer(undefined,{config:RTC_CFG});
  myPeer.on('error',e=>{ toast('Connection error: '+e.type); console.error(e); });
  myPeer.on('open',()=>{
    // Connect data channel to host
    const dc=myPeer.connect(code,{reliable:true});
    const entry={dataConn:dc,mediaConn:null,stream:null,name:'Host',connected:false};
    peers.set(code,entry);
    dc.on('open',()=>{
      dc.send(JSON.stringify({type:'display-name',name:myName,peerId:myPeer.id}));
      // Call host with our stream
      const call=myPeer.call(code,localStream);
      entry.mediaConn=call;
      call.on('stream', s=>{ entry.stream=s; entry.connected=true; updateRemoteTile(code,s); toast('Connected to host!'); qjStatus.style.display=''; qjStatus.classList.add('connected'); qjStatus.querySelector('span').textContent='Connected! Entering call\u2026'; setTimeout(()=>enterCall(),1500); });
      call.on('close',()=>onQuickPeerLeft(code));
    });
    dc.on('data', raw=>{
      let msg; try{msg=JSON.parse(raw);}catch{return;}
      if(msg.type==='display-name'){ entry.name=msg.name; updatePeerLabel(code,msg.name); }
      if(msg.type==='cam-status') updateRemoteTileAvatar(code, msg.cam);
      if(msg.type==='peer-list') (msg.peers||[]).forEach(pid=>quickConnectToPeer(pid));
      if(msg.type==='new-peer') quickConnectToPeer(msg.peerId);
    });
  });
  // Accept incoming calls from other peers in the mesh
  myPeer.on('call', call=>{
    const pid=call.peer;
    call.answer(localStream);
    let entry=peers.get(pid);
    if(!entry){ entry={dataConn:null,mediaConn:call,stream:null,name:'Peer',connected:false}; peers.set(pid,entry); }
    else { entry.mediaConn=call; }
    call.on('stream', s=>{ entry.stream=s; entry.connected=true; updateRemoteTile(pid,s); if(inCall)addVideoTile(pid,entry.name,s); });
    call.on('close',()=>onQuickPeerLeft(pid));
  });
  myPeer.on('connection', conn=>{
    const pid=conn.peer;
    let entry=peers.get(pid);
    if(!entry){ entry={dataConn:conn,mediaConn:null,stream:null,name:'Peer',connected:false}; peers.set(pid,entry); }
    else { entry.dataConn=conn; }
    conn.on('open',()=>{ conn.send(JSON.stringify({type:'display-name',name:myName,peerId:myPeer.id})); });
    conn.on('data', raw=>{
      let msg; try{msg=JSON.parse(raw);}catch{return;}
      if(msg.type==='display-name'){ entry.name=msg.name; updatePeerLabel(pid,msg.name); }
      if(msg.type==='cam-status') updateRemoteTileAvatar(pid, msg.cam);
    });
  });
}

function quickConnectToPeer(pid){
  if(peers.has(pid)||pid===myPeer.id) return;
  const dc=myPeer.connect(pid,{reliable:true});
  const entry={dataConn:dc,mediaConn:null,stream:null,name:'Peer',connected:false};
  peers.set(pid,entry);
  dc.on('open',()=>{
    dc.send(JSON.stringify({type:'display-name',name:myName,peerId:myPeer.id}));
    const call=myPeer.call(pid,localStream);
    entry.mediaConn=call;
    call.on('stream', s=>{ entry.stream=s; entry.connected=true; updateRemoteTile(pid,s); if(inCall)addVideoTile(pid,entry.name,s); });
    call.on('close',()=>onQuickPeerLeft(pid));
  });
  dc.on('data', raw=>{
    let msg; try{msg=JSON.parse(raw);}catch{return;}
    if(msg.type==='display-name'){ entry.name=msg.name; updatePeerLabel(pid,msg.name); }
    if(msg.type==='cam-status') updateRemoteTileAvatar(pid, msg.cam);
  });
}

// ══════════════════════════════════════
// ── LANDING PAGE HANDLERS ──
// ══════════════════════════════════════

// Quick Connect
$('#btn-quick-host').addEventListener('click', async()=>{
  myName=inputName.value.trim()||'Host'; isHost=true; connectMode='quick';
  showView('quick-host');
  await acquireMedia(); attachPreview(qhPreview, qhPreviewOff);
  await quickHost(); updateQuickHostUI();
});
$('#btn-quick-join').addEventListener('click', async()=>{
  myName=inputName.value.trim()||'Guest'; isHost=false; connectMode='quick';
  showView('quick-join');
  await acquireMedia(); attachPreview(qjPreview, qjPreviewOff);
});
$('#qh-copy-link').addEventListener('click',()=>{ navigator.clipboard.writeText(quickRoomLink(roomCode)).then(()=>toast('Link copied! \ud83d\udd17')); });
$('#qh-copy-code').addEventListener('click',()=>{ navigator.clipboard.writeText(roomCode).then(()=>toast('Code copied! \ud83d\udccb')); });
qhEnterCall.addEventListener('click',()=>enterCall());
$('#qh-back').addEventListener('click',()=>{ cleanup(); clearOfferURL(); showView('landing'); });
$('#qh-mic').addEventListener('click',toggleMic);
$('#qh-cam').addEventListener('click',toggleCam);
$('#qj-connect').addEventListener('click',async()=>{
  const code=qjCodeInput.value.trim().toUpperCase();
  if(code.length<4){toast('Enter the room code');return;}
  qjStatus.style.display='';
  await quickJoin(code);
});
$('#qj-back').addEventListener('click',()=>{ cleanup(); showView('landing'); });
$('#qj-mic').addEventListener('click',toggleMic);
$('#qj-cam').addEventListener('click',toggleCam);

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
$('#join-process').addEventListener('click', async()=>{
  const desc=decode(joinOfferIn.value);
  if(!desc||desc.type!=='offer'){toast('Invalid Meeting PassKey');return;}
  const pc=createPC('host');
  const entry={pc,dc:null,stream:null,name:'Host',connected:false,isHostLink:true};
  pc.ondatachannel=e=>{
    entry.dc=e.channel;
    setupDC(e.channel,'host');
    e.channel.onopen=()=>{ e.channel.send(JSON.stringify({type:'display-name',from:myId,name:myName})); };
  };
  peers.set('host',entry);
  await pc.setRemoteDescription(desc);
  const answer=await pc.createAnswer();
  await pc.setLocalDescription(answer);
  joinAnswerOut.value='Gathering network info\u2026';
  await waitICE(pc);
  joinAnswerOut.value=encode(pc.localDescription);
  joinStep1.classList.remove('active');
  joinStep2.classList.add('active');
  toast('Response Key ready \u2014 send it back to the host');
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
  if(isHost && connectMode==='secure') ctlAdd.style.display='';
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

function updatePeerLabel(id,name){ const el=$(`#tile-${id} .tile-name`); if(el)el.textContent=name; }
function updateRemoteTile(id,stream){ /* placeholder for pre-call stream tracking */ }
function updateRemoteTileAvatar(id,cam){ /* future: show/hide avatar when cam off */ }
function removeVideoTile(id){ const t=$(`#tile-${id}`); if(t)t.remove(); }

// ── Video tiles ──
function addVideoTile(id,name,stream,isSelf){
  if($(`#tile-${id}`)) return; // already exists
  const tile=document.createElement('div');
  tile.className='video-tile'+(isSelf?' self':'');
  tile.id=`tile-${id}`;
  const initial=(name||'?')[0].toUpperCase();
  tile.innerHTML=`
    <video autoplay ${isSelf?'muted':''} playsinline></video>
    <div class="tile-label">${name||'Peer'}</div>
    <div class="tile-avatar ${stream&&stream.getVideoTracks().length>0?'hidden':''}">
      <div class="avatar-circle"><span class="avatar-initial">${initial}</span></div>
    </div>`;
  const vid=tile.querySelector('video');
  if(stream) vid.srcObject=stream;
  callGrid.appendChild(tile);
  updateGridCount();
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
  const b64=await hostGenOffer();
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
})();
