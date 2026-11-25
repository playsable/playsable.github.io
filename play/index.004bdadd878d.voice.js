/*
 * SABLE proximity voice for the web build (docs/CHAT_VOICE.md).
 *
 * Godot's WebRTC API has data channels only, no audio tracks, so voice lives here in plain
 * browser JS. Godot drives it through JavaScriptBridge (sandbox/social/voice_web.gd):
 *   - the game server decides WHO may connect (range, blocks) and relays offers / answers / ICE
 *     over the game socket (the Social node), and sends a per-peer gain at 4 Hz;
 *     party members stay linked across the map: the server floors their gain and sends
 *     radio (0 = proximity, 1 = remote) and pan (-1 left .. 1 right) with each row;
 *   - this file owns the microphone, one RTCPeerConnection per peer, one GainNode per peer,
 *     push-to-talk (track.enabled), self-mute, per-peer mute and a speaking detector.
 * Audio is peer to peer (STUN, or the TURN relay from _voice_config when one is configured).
 *
 * API (window.SableVoice). Every argument and callback value is a string, number or bool:
 *   init(onSignal(to, kind, data), onSpeaking(on), onState(stateJson))
 *   enable()                    ask for the mic; listen-only if it is refused. Reports via onState
 *   disable()                   hang up everyone, release the mic
 *   setConfig(configJson)       _voice_config payload: {ice_servers:[{urls, username?, credential?}], ttl}
 *   setPeers(peersJson, localId) _voice_peers payload: [{peer, name, gain, party?, radio?, pan?}].
 *                               The LOWER peer id offers. Per peer: source -> GainNode -> (dry | radio
 *                               band-pass) -> StereoPanner -> speakers; missing nodes fall back to dry
 *   handleSignal(from, kind, data)  _voice_signal: kind offer | answer | ice, data is a JSON string
 *   hangup(peer)                _voice_hangup, or a peer that left the list
 *   setPtt(on)                  push-to-talk mode (default true): transmit only while talking
 *   setTalking(on)              push-to-talk key down / up
 *   setSelfMuted(on)            never transmit
 *   mutePeer(peer, on)          local mute of one peer (gain 0)
 *   setMasterVolume(v)          0..2, multiplies every peer gain
 *   getState()                  JSON string (same shape as onState)
 *   levels()                    JSON {self: 0..1, peers: {id: 0..1}}: mic level while transmitting and
 *                               each remote stream's level (for the speaking diamond), polled by Godot
 */
(function (global) {
  'use strict';
  if (global.SableVoice && global.SableVoice.version >= 1) return;

  var MAX_PEERS = 8;
  var SPEAK_THRESHOLD = 0.02; // RMS of the mic signal
  var SPEAK_HOLD_MS = 250;
  var DETECT_MS = 50;
  var GAIN_RAMP = 0.05; // seconds (setTargetAtTime time constant)
  var MIX_RAMP = 0.25;  // proximity <-> radio crossfade and pan glide
  var RADIO_LOW = 320, RADIO_HIGH = 3200; // band of the remote-party "radio" voice
  var RADIO_MAKEUP = 1.15; // the band-pass loses body; a touch of makeup keeps it as loud
  var LEVEL_FLOOR = 0.008, LEVEL_SPAN = 0.12; // RMS -> 0..1 level for the speaking diamond

  var cb = { signal: null, speaking: null, state: null };
  var st = {
    enabled: false, mic: false, ptt: true, talking: false, selfMuted: false,
    localId: 0, master: 1.0, error: '',
    iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
  };
  var ctx = null, stream = null, track = null, analyser = null, sampleBuf = null;
  var detectTimer = null, speakingNow = false, lastLoud = 0, selfLevel = 0;
  var peers = {}; // id -> {id, pc, gain, audio, source, muted, target, pendingIce, name, offerer}

  function fire(fn) {
    if (typeof fn !== 'function') return;
    var args = Array.prototype.slice.call(arguments, 1);
    try { fn.apply(null, args); } catch (e) { if (global.console) console.warn('SableVoice callback', e); }
  }
  function transmitting() { return st.enabled && st.mic && !st.selfMuted && (!st.ptt || st.talking); }
  function setSpeaking(on) {
    if (on === speakingNow) return;
    speakingNow = on;
    fire(cb.speaking, on);
  }
  function applyTrack() {
    if (track) track.enabled = transmitting();
    if (!transmitting()) setSpeaking(false);
  }
  function stateObject() {
    var list = [];
    Object.keys(peers).forEach(function (k) {
      var p = peers[k];
      list.push({ peer: p.id, name: p.name, gain: p.target, muted: p.muted, party: p.party, radio: p.radio,
        state: p.pc ? (p.pc.connectionState || p.pc.iceConnectionState || '') : 'closed' });
    });
    return { enabled: st.enabled, mic: st.mic, ptt: st.ptt, talking: st.talking, selfMuted: st.selfMuted,
      transmitting: transmitting(), speaking: speakingNow, master: st.master, error: st.error, peers: list };
  }
  function emitState() { fire(cb.state, JSON.stringify(stateObject())); }
  function send(to, kind, obj) { fire(cb.signal, to, kind, JSON.stringify(obj)); }

  function ensureCtx() {
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
    return ctx;
  }

  function startDetector() {
    stopDetector();
    if (!ctx || !stream) return;
    try {
      var src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser); // analyser only, never to the speakers
      sampleBuf = new Float32Array(analyser.fftSize);
    } catch (e) { analyser = null; return; }
    detectTimer = setInterval(function () {
      if (!analyser || !transmitting()) { selfLevel = 0; setSpeaking(false); return; }
      analyser.getFloatTimeDomainData(sampleBuf);
      var sum = 0;
      for (var i = 0; i < sampleBuf.length; i++) sum += sampleBuf[i] * sampleBuf[i];
      var rms = Math.sqrt(sum / sampleBuf.length);
      selfLevel = toLevel(rms);
      var now = Date.now();
      if (rms > SPEAK_THRESHOLD) lastLoud = now;
      setSpeaking(now - lastLoud < SPEAK_HOLD_MS);
    }, DETECT_MS);
  }
  function stopDetector() {
    if (detectTimer) clearInterval(detectTimer);
    detectTimer = null; analyser = null;
    setSpeaking(false);
  }

  function toLevel(rms) { return Math.max(0, Math.min(1, (rms - LEVEL_FLOOR) / LEVEL_SPAN)); }
  function rmsOf(node, buf) {
    if (!node || !node.getFloatTimeDomainData) return 0;
    node.getFloatTimeDomainData(buf);
    var sum = 0;
    for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }
  function ramp(param, v, tc) {
    if (!param) return;
    try { param.setTargetAtTime(v, ctx.currentTime, tc); } catch (e) { param.value = v; }
  }
  // Proximity (dry, panned by position) <-> remote party radio (band-passed, centred).
  function applyMix(p) {
    if (!ctx) return;
    var r = Math.max(0, Math.min(1, p.radio || 0));
    if (p.dry) ramp(p.dry.gain, p.wet ? 1 - r : 1, MIX_RAMP);
    if (p.wet) ramp(p.wet.gain, r * RADIO_MAKEUP, MIX_RAMP);
    if (p.panner) ramp(p.panner.pan, Math.max(-1, Math.min(1, p.pan || 0)) * (1 - r), MIX_RAMP);
  }
  // source -> gain -> dry ------------------------> panner -> destination
  //                \-> highpass -> lowpass -> wet -/
  function buildChain(c, p) {
    p.gain = c.createGain(); p.gain.gain.value = 0;
    var out = c.destination;
    try { if (c.createStereoPanner) { p.panner = c.createStereoPanner(); p.panner.connect(out); out = p.panner; } } catch (e) { p.panner = null; }
    try {
      if (c.createBiquadFilter) {
        p.dry = c.createGain(); p.dry.gain.value = 1;
        p.wet = c.createGain(); p.wet.gain.value = 0;
        p.hp = c.createBiquadFilter(); p.hp.type = 'highpass'; p.hp.frequency.value = RADIO_LOW; p.hp.Q.value = 0.7;
        p.lp = c.createBiquadFilter(); p.lp.type = 'lowpass'; p.lp.frequency.value = RADIO_HIGH; p.lp.Q.value = 0.9;
        p.gain.connect(p.dry); p.dry.connect(out);
        p.gain.connect(p.hp); p.hp.connect(p.lp); p.lp.connect(p.wet); p.wet.connect(out);
        return;
      }
    } catch (e) { p.dry = null; p.wet = null; p.hp = null; p.lp = null; }
    p.gain.connect(out);
  }

  function effectiveGain(p) { return p.muted ? 0 : Math.max(0, Math.min(1, p.target)) * st.master; }
  function applyGain(p) {
    if (!p.gain || !ctx) return;
    var g = effectiveGain(p);
    try { p.gain.gain.setTargetAtTime(g, ctx.currentTime, GAIN_RAMP); } catch (e) { p.gain.gain.value = g; }
  }

  function createPeer(id, name) {
    if (peers[id]) return peers[id];
    if (Object.keys(peers).length >= MAX_PEERS) return null;
    var pc;
    try { pc = new RTCPeerConnection({ iceServers: st.iceServers }); } catch (e) { st.error = 'webrtc_unsupported'; return null; }
    var p = { id: id, pc: pc, gain: null, audio: null, source: null, muted: false, target: 0, pendingIce: [],
      name: name || '', offerer: st.localId > 0 && st.localId < id, party: false, radio: 0, pan: 0,
      dry: null, wet: null, hp: null, lp: null, panner: null, meter: null, meterBuf: null };
    peers[id] = p;
    if (track && stream) pc.addTrack(track, stream);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    var c = ensureCtx();
    if (c) buildChain(c, p);
    pc.onicecandidate = function (e) {
      if (e.candidate) send(id, 'ice', e.candidate.toJSON ? e.candidate.toJSON() : e.candidate);
    };
    pc.ontrack = function (e) {
      var ms = (e.streams && e.streams[0]) ? e.streams[0] : new MediaStream([e.track]);
      attachRemote(p, ms);
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'failed' && p.offerer) {
        try { if (pc.restartIce) pc.restartIce(); } catch (e) {}
        makeOffer(p, true);
      }
      emitState();
    };
    return p;
  }

  function attachRemote(p, ms) {
    // Chrome only feeds a remote WebRTC stream into Web Audio while a media element plays it.
    if (typeof Audio !== 'undefined') {
      try {
        p.audio = new Audio();
        p.audio.muted = true;
        p.audio.srcObject = ms;
        var pr = p.audio.play();
        if (pr && pr.catch) pr.catch(function () {});
      } catch (e) {}
    }
    if (ctx && p.gain) {
      try {
        if (p.source) p.source.disconnect();
        p.source = ctx.createMediaStreamSource(ms);
        p.source.connect(p.gain);
        p.meter = ctx.createAnalyser(); p.meter.fftSize = 256; // level only, never to the speakers
        p.meterBuf = new Float32Array(p.meter.fftSize || 256);
        p.source.connect(p.meter);
      } catch (e) {}
    }
    applyGain(p);
  }

  function makeOffer(p, restart) {
    var pc = p.pc;
    pc.createOffer(restart ? { iceRestart: true } : undefined).then(function (offer) {
      return pc.setLocalDescription(offer);
    }).then(function () {
      send(p.id, 'offer', { type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    }).catch(function (e) { st.error = 'offer_failed'; });
  }

  function flushIce(p) {
    var q = p.pendingIce; p.pendingIce = [];
    q.forEach(function (c) { p.pc.addIceCandidate(c).catch(function () {}); });
  }

  function closePeer(id) {
    var p = peers[id];
    if (!p) return;
    delete peers[id];
    try { p.pc.onicecandidate = null; p.pc.ontrack = null; p.pc.onconnectionstatechange = null; p.pc.close(); } catch (e) {}
    try { if (p.source) p.source.disconnect(); } catch (e) {}
    ['gain', 'dry', 'wet', 'hp', 'lp', 'panner'].forEach(function (k) { try { if (p[k]) p[k].disconnect(); } catch (e) {} });
    if (p.audio) { try { p.audio.pause(); p.audio.srcObject = null; } catch (e) {} }
  }

  function parse(json, fallback) {
    if (typeof json !== 'string') return json == null ? fallback : json;
    try { return JSON.parse(json); } catch (e) { return fallback; }
  }

  var api = {
    version: 1,
    init: function (onSignal, onSpeaking, onState) {
      cb.signal = onSignal; cb.speaking = onSpeaking; cb.state = onState;
      return true;
    },
    supported: function () {
      return typeof RTCPeerConnection !== 'undefined' && !!(global.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    },
    enable: function () {
      ensureCtx();
      if (st.enabled) { emitState(); return Promise.resolve(true); }
      if (typeof RTCPeerConnection === 'undefined') { st.error = 'webrtc_unsupported'; emitState(); return Promise.resolve(false); }
      var md = global.navigator && navigator.mediaDevices;
      var finish = function () { st.enabled = true; applyTrack(); startDetector(); emitState(); return true; };
      if (!md || !md.getUserMedia) { st.mic = false; st.error = 'mic_unsupported'; return Promise.resolve(finish()); }
      return md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
        .then(function (s) {
          stream = s; track = s.getAudioTracks()[0] || null; st.mic = !!track; st.error = '';
          return finish();
        }).catch(function (e) {
          st.mic = false; st.error = (e && e.name) ? ('mic_' + e.name) : 'mic_denied';
          return finish(); // listen-only
        });
    },
    disable: function () {
      Object.keys(peers).forEach(function (k) { closePeer(Number(k)); });
      stopDetector();
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null; track = null; st.mic = false; st.enabled = false; st.talking = false;
      emitState();
    },
    setConfig: function (json) {
      var cfg = parse(json, {});
      var list = [];
      (cfg.ice_servers || []).forEach(function (s) {
        if (!s || !s.urls) return;
        var e = { urls: s.urls };
        if (s.username) e.username = s.username;
        if (s.credential) e.credential = s.credential;
        list.push(e);
      });
      if (list.length) st.iceServers = list;
      Object.keys(peers).forEach(function (k) {
        try { peers[k].pc.setConfiguration({ iceServers: st.iceServers }); } catch (e) {}
      });
    },
    setPeers: function (json, localId) {
      if (!st.enabled) return;
      st.localId = Number(localId) || st.localId;
      var list = parse(json, []);
      var want = {};
      list.slice(0, MAX_PEERS).forEach(function (row) {
        var id = Number(row.peer);
        if (!id || id === st.localId) return;
        want[id] = true;
        var p = peers[id];
        if (!p) {
          p = createPeer(id, String(row.name || ''));
          if (!p) return;
          if (p.offerer) makeOffer(p, false);
        }
        p.name = String(row.name || p.name);
        p.target = Number(row.gain) || 0;
        p.party = !!row.party;
        p.radio = Number(row.radio) || 0;
        p.pan = Number(row.pan) || 0;
        applyGain(p);
        applyMix(p);
      });
      Object.keys(peers).forEach(function (k) { if (!want[k]) closePeer(Number(k)); });
    },
    handleSignal: function (from, kind, data) {
      if (!st.enabled) return;
      from = Number(from);
      var msg = parse(data, null);
      if (!msg) return;
      var p = peers[from];
      if (kind === 'offer') {
        if (!p) p = createPeer(from, '');
        if (!p) return;
        p.pc.setRemoteDescription(msg).then(function () {
          flushIce(p);
          return p.pc.createAnswer();
        }).then(function (answer) {
          return p.pc.setLocalDescription(answer);
        }).then(function () {
          send(from, 'answer', { type: p.pc.localDescription.type, sdp: p.pc.localDescription.sdp });
        }).catch(function () { st.error = 'answer_failed'; });
      } else if (kind === 'answer') {
        if (!p || p.pc.signalingState !== 'have-local-offer') return;
        p.pc.setRemoteDescription(msg).then(function () { flushIce(p); }).catch(function () {});
      } else if (kind === 'ice') {
        if (!p) return;
        if (p.pc.remoteDescription) p.pc.addIceCandidate(msg).catch(function () {});
        else if (p.pendingIce.length < 64) p.pendingIce.push(msg);
      }
    },
    hangup: function (peer) { closePeer(Number(peer)); },
    setPtt: function (on) { st.ptt = !!on; applyTrack(); emitState(); },
    setTalking: function (on) { st.talking = !!on; applyTrack(); },
    setSelfMuted: function (on) { st.selfMuted = !!on; applyTrack(); emitState(); },
    mutePeer: function (peer, on) {
      var p = peers[Number(peer)];
      if (p) { p.muted = !!on; applyGain(p); }
    },
    setMasterVolume: function (v) {
      st.master = Math.max(0, Math.min(2, Number(v) || 0));
      Object.keys(peers).forEach(function (k) { applyGain(peers[k]); });
    },
    getState: function () { return JSON.stringify(stateObject()); },
    levels: function () {
      var out = { self: transmitting() ? selfLevel : 0, peers: {} };
      Object.keys(peers).forEach(function (k) {
        var p = peers[k];
        out.peers[k] = (p.muted || effectiveGain(p) <= 0) ? 0 : toLevel(rmsOf(p.meter, p.meterBuf));
      });
      return JSON.stringify(out);
    },
    _peers: peers // tests only
  };
  global.SableVoice = api;
})(typeof window !== 'undefined' ? window : globalThis);
