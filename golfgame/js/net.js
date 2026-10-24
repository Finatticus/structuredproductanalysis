// 雙人連線：開房者是主機。WebRTC 資料通道直連，GAS 只負責交換連線資料；
// 直連失敗時自動改用 GAS 轉送訊息（高爾夫是輪流打，慢一點也能玩）。
import { CONFIG } from './config.js';
import { call } from './api.js';

const waitIce = pc => new Promise(res => {
  if (pc.iceGatheringState === 'complete') return res();
  const t = setTimeout(res, 3500);
  pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
});

export class Net {
  constructor() {
    this.handlers = [];
    this.seen = new Set();
    this.counter = 0;
    this.mode = 'connecting';     // 'p2p' | 'relay'
    this.lastSeq = 0;
    this.closed = false;
  }

  on(fn) { this.handlers.push(fn); }
  emit(m) { for (const h of this.handlers) h(m); }

  newPc() {
    const pc = this.pc = new RTCPeerConnection({ iceServers: CONFIG.ICE });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') this.toRelay();
    };
    return pc;
  }

  bindChannel(dc) {
    this.dc = dc;
    dc.onopen = () => { this.mode = 'p2p'; this.emit({ t: '_status', mode: 'p2p' }); };
    dc.onclose = () => { if (!this.closed) this.toRelay(); };
    dc.onmessage = e => this.receive(JSON.parse(e.data));
  }

  async host(config) {
    this.isHost = true;
    const pc = this.newPc();
    this.bindChannel(pc.createDataChannel('golf', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc);
    const room = await call('createRoom', { offer: JSON.stringify(pc.localDescription), config });
    this.code = room.code;
    this.pollRoom();
    this.pollMsgs();
    return room.code;
  }

  // 主機等客人的 answer
  async pollRoom() {
    while (!this.closed && !this.guest) {
      try {
        const r = await call('getRoom', { code: this.code });
        if (r.guest) {
          this.guest = r.guest;
          this.emit({ t: '_guest', user: r.guest });
          if (r.answer) await this.pc.setRemoteDescription(JSON.parse(r.answer)).catch(() => {});
          setTimeout(() => { if (this.mode !== 'p2p') this.toRelay(); }, 12000);
        }
      } catch (e) { this.emit({ t: '_error', error: e.message }); }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // user：自己的帳號。已經在這個遊戲間裡（中途離開又回來）就不再登記、不重新直連，直接用 GAS 轉送
  async join(code, user) {
    this.isHost = false;
    this.code = code;
    const room = await call('getRoom', { code });
    this.hostUser = room.host;
    this.rejoin = !!user && (room.host === user || room.guest === user);
    // 之前留在遊戲間的舊訊息不處理（例如上一次的「開始」），只看加入之後的
    try {
      const old = await call('getMsgs', { code, since: 0 });
      for (const m of old) this.lastSeq = Math.max(this.lastSeq, m.seq);
    } catch (e) { /* 沒有訊息 */ }
    if (this.rejoin) {
      this.mode = 'relay';
      this.emit({ t: '_status', mode: 'relay' });
      this.pollMsgs();
      return room;
    }
    let answer = null;
    if (room.offer) {
      const pc = this.newPc();
      pc.ondatachannel = e => this.bindChannel(e.channel);
      try {
        await pc.setRemoteDescription(JSON.parse(room.offer));
        await pc.setLocalDescription(await pc.createAnswer());
        await waitIce(pc);
        answer = JSON.stringify(pc.localDescription);
      } catch (e) { answer = null; }
    }
    await call('joinRoom', { code, answer });
    this.pollMsgs();
    setTimeout(() => { if (this.mode !== 'p2p') this.toRelay(); }, 12000);
    return room;
  }

  toRelay() {
    if (this.mode === 'relay' || this.closed) return;
    if (this.dc && this.dc.readyState === 'open') return;
    this.mode = 'relay';
    this.emit({ t: '_status', mode: 'relay' });
  }

  // 一直輪詢 GAS 訊息（直連成功後就降低頻率，只當備援）
  async pollMsgs() {
    while (!this.closed) {
      try {
        const list = await call('getMsgs', { code: this.code, since: this.lastSeq });
        for (const m of list) { this.lastSeq = Math.max(this.lastSeq, m.seq); this.receive(m.msg); }
      } catch (e) {
        if (/關閉/.test(e.message)) { this.emit({ t: '_closed' }); return; }
      }
      await new Promise(r => setTimeout(r, this.mode === 'p2p' ? 6000 : 1500));
    }
  }

  receive(m) {
    if (this.closed || !m || !m.id || this.seen.has(m.id)) return;
    this.seen.add(m.id);
    this.emit(m);
  }

  send(m, opts = {}) {
    m.id = (this.isHost ? 'h' : 'g') + (++this.counter) + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (this.dc && this.dc.readyState === 'open') {
      try { this.dc.send(JSON.stringify(m)); return; } catch (e) { /* 改走轉送 */ }
    }
    if (opts.volatile) return;     // 瞄準預覽之類的訊息不走 GAS
    call('sendMsg', { code: this.code, msg: m }).catch(err => this.emit({ t: '_error', error: err.message }));
  }

  // keepRoom：遊戲間留著（對方還在打，自己之後還能用驗證碼回來）。沒指定時：主機關閉遊戲間、客人不關
  close(keepRoom = !this.isHost) {
    this.closed = true;
    this.handlers = [];
    try { this.dc && this.dc.close(); this.pc && this.pc.close(); } catch (e) { /* 已關閉 */ }
    if (!keepRoom && this.code) call('closeRoom', { code: this.code }).catch(() => {});
  }
}
