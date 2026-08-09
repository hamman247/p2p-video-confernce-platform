/* ════════════════════════════════════════════════════════════
   MeshMeet — Zero-Server P2P Video Calls
   Pure WebRTC with manual SDP exchange. No signaling server.
   
   STUN note: We use Google's public STUN server *only* for
   NAT traversal (discovering your public IP). STUN is a
   single UDP packet — no media flows through it. To go fully
   offline, remove the iceServers config (LAN-only then).
   ════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  // ── Views ──
  const views = {
    landing:   $('#landing-view'),
    host:      $('#setup-host-view'),
    join:      $('#setup-join-view'),
    call:      $('#call-view'),
  };

  // ── Landing ──
  const btnCreate = $('#btn-create');
  const btnJoin   = $('#btn-join');

  // ── Host setup ──
  const hostPreview     = $('#host-preview');
  const hostPreviewOff  = $('#host-preview-off');
  const hostOfferOut    = $('#host-offer-output');
  const hostCopyOffer   = $('#host-copy-offer');
  const hostNext        = $('#host-next');
  const hostStep1       = $('#host-step1');
  const hostStep2       = $('#host-step2');
  const hostAnswerIn    = $('#host-answer-input');
  const hostConnect     = $('#host-connect');
  const hostBackStep1   = $('#host-back-step1');
  const hostBackLanding = $('#host-back-landing');
  const hostToggleMic   = $('#host-toggle-mic');
  const hostToggleCam   = $('#host-toggle-cam');

  // ── Join setup ──
  const joinPreview     = $('#join-preview');
  const joinPreviewOff  = $('#join-preview-off');
  const joinOfferIn     = $('#join-offer-input');
  const joinProcess     = $('#join-process');
  const joinStep1       = $('#join-step1');
  const joinStep2       = $('#join-step2');
  const joinAnswerOut   = $('#join-answer-output');
  const joinCopyAnswer  = $('#join-copy-answer');
  const joinWaiting     = $('#join-waiting');
  const joinBackLanding = $('#join-back-landing');
  const joinToggleMic   = $('#join-toggle-mic');
  const joinToggleCam   = $('#join-toggle-cam');

  // ── Call ──
  const videoLocal    = $('#video-local');
  const videoRemote   = $('#video-remote');
  const localNoVid    = $('#local-no-video');
  const remoteNoVid   = $('#remote-no-video');
  const callTimer     = $('#call-timer');
  const btnMic        = $('#btn-toggle-mic');
  const btnCam        = $('#btn-toggle-cam');
  const btnScreen     = $('#btn-screen-share');
  const btnEnd        = $('#btn-end-call');
  const btnFull       = $('#btn-fullscreen');

  // Toast
  const toastEl  = $('#toast');
  const toastMsg = $('#toast-message');

  // ── State ──
  let pc           = null;   // RTCPeerConnection
  let localStream  = null;
  let screenStream = null;
  let micOn = true, camOn = true;
  let timerInterval = null, callSeconds = 0;
  let isHost = false;          // true = created offer, false = joined
  let joinerReadyForCall = false; // joiner must explicitly enter call

  // ICE / STUN config — only used for NAT traversal, no media relay
  const RTC_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
  };

  // ────────────────────────────────────────────────
  //  Helpers
  // ────────────────────────────────────────────────
  function showView(name) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[name].classList.add('active');
  }

  function toast(msg, ms = 3000) {
    toastMsg.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.add('hidden'), ms);
  }

  function fmtTime(s) {
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }

  /** Encode SDP to a compact, copy-friendly string */
  function encodeSDP(desc) {
    return btoa(JSON.stringify(desc));
  }

  /** Decode pasted SDP string back to an RTCSessionDescription */
  function decodeSDP(str) {
    try {
      const obj = JSON.parse(atob(str.trim()));
      return new RTCSessionDescription(obj);
    } catch {
      return null;
    }
  }

  /** Wait for ICE gathering to finish (or 6s timeout) */
  function waitForICE(conn) {
    return new Promise(resolve => {
      if (conn.iceGatheringState === 'complete') { resolve(); return; }
      const t = setTimeout(resolve, 6000);
      conn.addEventListener('icegatheringstatechange', () => {
        if (conn.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
      });
    });
  }

  // ────────────────────────────────────────────────
  //  Media
  // ────────────────────────────────────────────────
  async function acquireMedia() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      micOn = true; camOn = true;
      return localStream;
    } catch {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micOn = true; camOn = false;
        toast('Camera unavailable — audio only');
        return localStream;
      } catch {
        localStream = null; micOn = false; camOn = false;
        toast('No camera or microphone found');
        return null;
      }
    }
  }

  function attachPreview(videoEl, placeholderEl) {
    if (localStream && localStream.getVideoTracks().length > 0 && camOn) {
      videoEl.srcObject = localStream;
      placeholderEl.classList.add('hidden');
    } else {
      videoEl.srcObject = localStream;   // audio-only still needs srcObject for track mgmt
      placeholderEl.classList.remove('hidden');
    }
  }

  function syncButtons() {
    [hostToggleMic, joinToggleMic, btnMic].forEach(b => b.classList.toggle('active', micOn));
    [hostToggleCam, joinToggleCam, btnCam].forEach(b => b.classList.toggle('active', camOn));
  }

  function toggleMic() {
    micOn = !micOn;
    if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = micOn);
    syncButtons();
  }

  function toggleCam() {
    camOn = !camOn;
    if (localStream) localStream.getVideoTracks().forEach(t => t.enabled = camOn);
    localNoVid.classList.toggle('hidden', camOn);
    // Update whichever preview is visible
    hostPreviewOff.classList.toggle('hidden', camOn);
    joinPreviewOff.classList.toggle('hidden', camOn);
    syncButtons();
  }

  // ────────────────────────────────────────────────
  //  RTCPeerConnection factory
  // ────────────────────────────────────────────────
  function createPC() {
    const conn = new RTCPeerConnection(RTC_CONFIG);

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach(track => conn.addTrack(track, localStream));
    }

    // Receive remote tracks
    conn.ontrack = (e) => {
      videoRemote.srcObject = e.streams[0];
      remoteNoVid.classList.add('hidden');
    };

    // Connection state — only the HOST auto-enters the call.
    // The JOINER stays on the answer screen until they click "Enter Call".
    conn.onconnectionstatechange = () => {
      const s = conn.connectionState;
      console.log('[RTC] connectionState:', s);
      if (s === 'connected') {
        if (isHost || joinerReadyForCall) {
          enterCall();
        } else {
          // Joiner: show "connected" status, let them copy answer first
          joinWaiting.classList.add('connected');
          joinWaiting.querySelector('span').textContent = 'Connected! Copy your answer above, then enter the call.';
          showJoinEnterButton();
        }
      } else if (s === 'disconnected' || s === 'failed' || s === 'closed') {
        toast('Peer disconnected');
        endCall();
      }
    };

    conn.oniceconnectionstatechange = () => {
      console.log('[RTC] iceConnectionState:', conn.iceConnectionState);
      // Only log — don't auto-enter call from here (avoids race condition)
    };

    return conn;
  }

  /** Show an "Enter Call" button for the joiner */
  function showJoinEnterButton() {
    // Avoid duplicates
    if ($('#join-enter-call')) return;
    const btn = document.createElement('button');
    btn.id = 'join-enter-call';
    btn.className = 'btn btn-primary full-width';
    btn.style.marginTop = 'var(--sp-4)';
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15.6 11.6L22 7v10l-6.4-4.5"/><rect x="2" y="7" width="15" height="10" rx="2" ry="2"/></svg> Enter Call';
    btn.addEventListener('click', () => {
      joinerReadyForCall = true;
      enterCall();
    });
    joinStep2.appendChild(btn);
  }

  // ────────────────────────────────────────────────
  //  HOST flow  (Create Offer → Paste Answer)
  // ────────────────────────────────────────────────
  btnCreate.addEventListener('click', async () => {
    isHost = true;
    showView('host');
    await acquireMedia();
    attachPreview(hostPreview, hostPreviewOff);
    syncButtons();

    // Create peer connection & offer
    pc = createPC();
    // Create a data channel (forces a media section even if no tracks)
    pc.createDataChannel('ctrl');

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    hostOfferOut.value = 'Gathering network info…';
    await waitForICE(pc);

    const encoded = encodeSDP(pc.localDescription);
    hostOfferOut.value = encoded;
    toast('Offer ready — copy & send it to your peer');
  });

  hostCopyOffer.addEventListener('click', () => {
    navigator.clipboard.writeText(hostOfferOut.value).then(() => toast('Offer copied! 📋'));
  });

  hostNext.addEventListener('click', () => {
    hostStep1.classList.remove('active');
    hostStep2.classList.add('active');
  });

  hostBackStep1.addEventListener('click', () => {
    hostStep2.classList.remove('active');
    hostStep1.classList.add('active');
  });

  hostConnect.addEventListener('click', async () => {
    const desc = decodeSDP(hostAnswerIn.value);
    if (!desc || desc.type !== 'answer') {
      toast('Invalid answer — check the pasted text'); return;
    }
    try {
      await pc.setRemoteDescription(desc);
      toast('Answer accepted — connecting…');
    } catch (err) {
      toast('Failed to process answer: ' + err.message);
    }
  });

  hostBackLanding.addEventListener('click', () => {
    cleanup();
    hostStep2.classList.remove('active');
    hostStep1.classList.add('active');
    showView('landing');
  });

  hostToggleMic.addEventListener('click', toggleMic);
  hostToggleCam.addEventListener('click', toggleCam);

  // ────────────────────────────────────────────────
  //  JOIN flow  (Paste Offer → Send Answer)
  // ────────────────────────────────────────────────
  btnJoin.addEventListener('click', async () => {
    isHost = false;
    joinerReadyForCall = false;
    showView('join');
    await acquireMedia();
    attachPreview(joinPreview, joinPreviewOff);
    syncButtons();
  });

  joinProcess.addEventListener('click', async () => {
    const desc = decodeSDP(joinOfferIn.value);
    if (!desc || desc.type !== 'offer') {
      toast('Invalid offer — check the pasted text'); return;
    }

    // Create PC & set remote offer
    pc = createPC();
    await pc.setRemoteDescription(desc);

    // Create answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    joinAnswerOut.value = 'Gathering network info…';
    await waitForICE(pc);

    const encoded = encodeSDP(pc.localDescription);
    joinAnswerOut.value = encoded;

    // Move to step 2
    joinStep1.classList.remove('active');
    joinStep2.classList.add('active');
    toast('Answer ready — copy & send it back to your peer');
  });

  joinCopyAnswer.addEventListener('click', () => {
    navigator.clipboard.writeText(joinAnswerOut.value).then(() => toast('Answer copied! 📋'));
  });

  joinBackLanding.addEventListener('click', () => {
    cleanup();
    joinStep2.classList.remove('active');
    joinStep1.classList.add('active');
    joinOfferIn.value = '';
    showView('landing');
  });

  joinToggleMic.addEventListener('click', toggleMic);
  joinToggleCam.addEventListener('click', toggleCam);

  // ────────────────────────────────────────────────
  //  Call lifecycle
  // ────────────────────────────────────────────────
  let inCall = false;

  function enterCall() {
    if (inCall) return;   // prevent double-entry from multiple state events
    inCall = true;
    showView('call');

    videoLocal.srcObject = localStream;
    localNoVid.classList.toggle('hidden', camOn);
    syncButtons();

    callSeconds = 0;
    callTimer.textContent = '00:00';
    timerInterval = setInterval(() => {
      callSeconds++;
      callTimer.textContent = fmtTime(callSeconds);
    }, 1000);

    toast('Connected! 🎉 Direct P2P link established.');
  }

  function endCall() {
    inCall = false;
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    cleanup();
    showView('landing');
    toast('Call ended');
  }

  function cleanup() {
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
    videoLocal.srcObject = null;
    videoRemote.srcObject = null;
    hostPreview.srcObject = null;
    joinPreview.srcObject = null;
    hostOfferOut.value = '';
    hostAnswerIn.value = '';
    joinOfferIn.value = '';
    joinAnswerOut.value = '';
    btnScreen.classList.remove('active');
  }

  // Call controls
  btnMic.addEventListener('click', toggleMic);
  btnCam.addEventListener('click', toggleCam);
  btnEnd.addEventListener('click', endCall);

  btnFull.addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  });

  // Screen share
  btnScreen.addEventListener('click', async () => {
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
      btnScreen.classList.remove('active');
      if (localStream) {
        const cam = localStream.getVideoTracks()[0];
        if (cam) replaceVideoTrack(cam);
        videoLocal.srcObject = localStream;
      }
      toast('Screen sharing stopped');
    } else {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        btnScreen.classList.add('active');
        const st = screenStream.getVideoTracks()[0];
        replaceVideoTrack(st);
        videoLocal.srcObject = screenStream;
        st.onended = () => btnScreen.click();
        toast('Sharing your screen');
      } catch { /* cancelled */ }
    }
  });

  function replaceVideoTrack(track) {
    if (!pc) return;
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(track);
  }

  // Cleanup on unload
  window.addEventListener('beforeunload', cleanup);

})();
