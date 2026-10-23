// ===== Dixen Golf 設定 =====
export const CONFIG = {
  // 部署 GAS 網頁應用程式後，把網址貼在這裡（也可以在登入畫面右上角「設定」裡填，存在瀏覽器）
  // 留空 = 本機模式：帳號存在這台裝置的瀏覽器，方便測試，但不能跨裝置連線。
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxzxXZYX9PyKBQ3F9WfirjLST3bYPze8hID5Vu-RWE5Q_F32vlfKryivoBvzIkbARJd/exec',

  // 角色模型：'procedural' = 內建角色；'mixamo' = 使用 assets/character/ 裡的 Mixamo FBX（見 README 的重點提醒）
  CHARACTER: {
    mode: 'procedural',
    mixamo: {
      model: 'assets/character/model.fbx',
      idle: 'assets/character/idle.fbx',
      drive: 'assets/character/drive.fbx',
      putt: 'assets/character/putt.fbx',
      scale: 0.01,            // Mixamo FBX 單位是公分
      topFraction: 0.42,      // 揮桿動作中「上桿頂點」在整段動作的比例
      impactFraction: 0.5,    // 擊球瞬間在整段動作的比例
      ballDistance: 0.9,      // 角色與球的距離（公尺）
      handBone: 'mixamorigRightHand',
      clubRotation: [0, 0, 0],
    },
  },

  // WebRTC 連線用的公開 STUN 伺服器
  ICE: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

export const ADMIN_USER = 'Michael';

export function gasUrl() {
  try { return localStorage.getItem('dixen.gas') || CONFIG.GAS_URL; } catch (e) { return CONFIG.GAS_URL; }
}

export function getSetting(k, d) {
  try { const v = localStorage.getItem('dixen.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
}

export function setSetting(k, v) {
  try { localStorage.setItem('dixen.' + k, JSON.stringify(v)); } catch (e) { /* 私密模式 */ }
}
