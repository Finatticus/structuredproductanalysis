/* 國家資料：全球約 240 個國家與地區
 * 原始資料在 js/countries-data.js（[iso2, ISO 數字代碼, 貨幣, 首都時區, 首都緯度, 經度, 英文名, 行車 L/R]）
 * 中文名稱用瀏覽器內建的台灣正體譯名，NAME 可覆蓋成習慣用法，ALIAS 是其他常見說法。
 * cityTz：同一國家有多個時區時，依城市挑時區。 */
(function () {
  const NAME = {
    kr: '韓國', kp: '北韓', hk: '香港', mo: '澳門', tw: '台灣', ae: '阿聯', us: '美國', gb: '英國', cz: '捷克', va: '梵蒂岡',
    mm: '緬甸', la: '寮國', ps: '巴勒斯坦', mk: '北馬其頓', cd: '剛果民主共和國', cg: '剛果共和國', fm: '密克羅尼西亞',
  };
  const ALIAS = {
    kr: ['南韓', '大韓民國'], ae: ['杜拜', '阿聯酋', '阿拉伯聯合大公國'], cn: ['中國大陸', '大陸'], us: ['美利堅'], gb: ['英格蘭', '蘇格蘭', '聯合王國'],
    au: ['澳大利亞'], nz: ['新西蘭'], it: ['意大利'], ru: ['俄國', '俄羅斯聯邦'], cz: ['捷克共和國'], tr: ['土耳其共和國', 'Turkey'], th: ['泰王國'],
    vn: ['越南社會主義共和國'], sa: ['沙烏地', '沙特'], nl: ['荷蘭王國'], ph: ['菲國'], mo: ['澳門特別行政區'], hk: ['香港特別行政區'],
  };
  const CITY_TZ = {
    us: { 洛杉磯: 'America/Los_Angeles', 舊金山: 'America/Los_Angeles', 聖地牙哥: 'America/Los_Angeles', 拉斯維加斯: 'America/Los_Angeles', 西雅圖: 'America/Los_Angeles',
      波特蘭: 'America/Los_Angeles', 芝加哥: 'America/Chicago', 休士頓: 'America/Chicago', 達拉斯: 'America/Chicago', 紐奧良: 'America/Chicago',
      丹佛: 'America/Denver', 鹽湖城: 'America/Denver', 鳳凰城: 'America/Phoenix', 夏威夷: 'Pacific/Honolulu', 檀香山: 'Pacific/Honolulu', 阿拉斯加: 'America/Anchorage', 安克拉治: 'America/Anchorage' },
    ca: { 溫哥華: 'America/Vancouver', 卡加利: 'America/Edmonton', 班夫: 'America/Edmonton', 黃刀鎮: 'America/Yellowknife', 多倫多: 'America/Toronto', 蒙特婁: 'America/Toronto' },
    au: { 伯斯: 'Australia/Perth', 布里斯本: 'Australia/Brisbane', 墨爾本: 'Australia/Melbourne', 凱恩斯: 'Australia/Brisbane', 阿德雷德: 'Australia/Adelaide', 達爾文: 'Australia/Darwin', 雪梨: 'Australia/Sydney' },
    mx: { 坎昆: 'America/Cancun' }, id: { 峇里島: 'Asia/Makassar', Bali: 'Asia/Makassar' },
    ru: { 海參崴: 'Asia/Vladivostok', 伊爾庫茨克: 'Asia/Irkutsk', 新西伯利亞: 'Asia/Novosibirsk', 莫曼斯克: 'Europe/Moscow' },
    br: { 瑪瑙斯: 'America/Manaus' },
  };
  const CUR_NAME = { TWD: '新台幣', JPY: '日圓', KRW: '韓元', CNY: '人民幣', HKD: '港幣', MOP: '澳門幣', USD: '美元', EUR: '歐元', GBP: '英鎊', VND: '越南盾', THB: '泰銖' };

  let dn = null, dc = null;
  try { dn = new Intl.DisplayNames(['zh-Hant-TW', 'zh-TW'], { type: 'region' }); dc = new Intl.DisplayNames(['zh-Hant-TW', 'zh-TW'], { type: 'currency' }); } catch { }

  const list = (window.TA_COUNTRY_ROWS || []).map(([iso, num, cur, tz, lat, lon, en, side]) => {
    let zh = NAME[iso];
    if (!zh) { try { zh = dn?.of(iso.toUpperCase()); } catch { } }
    if (!zh || zh === iso.toUpperCase()) zh = en;
    return { iso, num, cur, tz, cap: lat != null ? [lat, lon] : null, en, drive: side === 'L' ? '左' : '右', zh, aliases: ALIAS[iso] || [], cityTz: CITY_TZ[iso] || null };
  }).sort((a, b) => a.zh.localeCompare(b.zh, 'zh-Hant-TW'));

  const byName = {};
  const norm = s => String(s).trim().toLowerCase().replace(/臺/g, '台');
  list.forEach(c => {
    [c.zh, c.en, c.iso, ...c.aliases].forEach(n => (byName[norm(n)] = c));
    try { const full = dn?.of(c.iso.toUpperCase()); if (full) byName[norm(full)] = c; } catch { }
  });

  window.TA = window.TA || {};
  TA.countries = {
    list,
    find(name) { return name ? byName[norm(name)] || null : null; },
    byIso: iso => list.find(c => c.iso === iso) || null,
    flagUrl(c, w = 40) { return c ? `https://flagcdn.com/w${w}/${c.iso}.png` : ''; },
    curName(code) { if (CUR_NAME[code]) return CUR_NAME[code]; try { return dc?.of(code) || code; } catch { return code; } },
    tzFor(c, cities) {
      if (!c) return null;
      if (c.cityTz && cities) for (const city of cities) if (c.cityTz[city]) return c.cityTz[city];
      return c.tz;
    },
  };
})();
