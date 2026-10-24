// ===== Dixen Golf 設定 =====
export const CONFIG = {
  // 部署 GAS 網頁應用程式後，把網址貼在這裡（也可以在登入畫面右上角「設定」裡填，存在瀏覽器）
  // 留空 = 本機模式：帳號存在這台裝置的瀏覽器，方便測試，但不能跨裝置連線。
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxzxXZYX9PyKBQ3F9WfirjLST3bYPze8hID5Vu-RWE5Q_F32vlfKryivoBvzIkbARJd/exec',

  // WebRTC 連線用的公開 STUN 伺服器
  ICE: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

export const ADMIN_USER = 'Michael';

// ===== 角色 =====
// classic = 程式內建角色（可換顏色）；其他 = Mixamo 寫實角色（assets/character/<資料夾>/model.glb，由轉檔工具從 model.fbx 壓縮而來）
// 新增角色：放好資料夾、用 .claude/convert-characters.html 轉檔後，在這裡加一行。height = 遊戲裡的身高（公尺）
export const CHARACTERS = [
  { id: 'classic', name: '經典（內建，可換顏色）' },
  { id: 'David', name: 'David', file: 'assets/character/David/model.glb', height: 1.80 },
  { id: 'James', name: 'James', file: 'assets/character/James/model.glb', height: 1.83 },
  { id: 'Joe', name: 'Joe', file: 'assets/character/Joe/model.glb', height: 1.78 },
  { id: 'Louise', name: 'Louise', file: 'assets/character/Louise/model.glb', height: 1.68 },
  { id: 'Ninja', name: 'Ninja', file: 'assets/character/Ninja/model.glb', height: 1.76 },
  { id: 'Ross', name: 'Ross', file: 'assets/character/Ross/model.glb', height: 1.78 },
  { id: 'Sophie', name: 'Sophie', file: 'assets/character/Sophie/model.glb', height: 1.68 },
  { id: 'Alien', name: 'Alien', file: 'assets/character/Alien/model.glb', height: 1.80 },
  { id: 'Kachujin', name: 'Kachujin', file: 'assets/character/Kachujin/model.glb', height: 1.70 },
];
export const ANIM_BASE = 'assets/character/anims';   // 所有寫實角色共用的動作檔
export const characterDef = id => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];

export function gasUrl() {
  try {
    const v = localStorage.getItem('dixen.gas');
    if (v === 'local') return '';            // 測試用：強制本機模式，不動到正式試算表
    return v || CONFIG.GAS_URL;
  } catch (e) { return CONFIG.GAS_URL; }
}

export function getSetting(k, d) {
  try { const v = localStorage.getItem('dixen.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
}

export function setSetting(k, v) {
  try { localStorage.setItem('dixen.' + k, JSON.stringify(v)); } catch (e) { /* 私密模式 */ }
}
