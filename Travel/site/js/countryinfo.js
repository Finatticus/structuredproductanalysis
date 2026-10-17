/* 各國出發須知（以中華民國護照、從台灣出發為準）
 * ⚠ 入境規定常變動，這裡是整理好的參考資料，出發前務必到官方網站或外交部領事事務局確認。
 * 欄位：visa 簽證、entry 入境手續 [{t, url}]、plug 插頭型式、volt 電壓、drive 行車方向、sos 緊急電話、
 *       tips 其他注意事項、docs 會自動加進行李清單的文件 */
(function () {
  const SCHENGEN = {
    visa: '免申根簽證，任何 180 天內最多停留 90 天（申根區合併計算）',
    entry: [
      { t: '歐盟入出境系統（EES）已上路，首次入境會在邊境登錄指紋與臉部影像，排隊時間可能較長' },
      { t: 'ETIAS 歐洲旅行資訊及授權系統預計於 2026 年第四季後實施，實施後出發前需線上申請', url: 'https://travel-europe.europa.eu/etias_en' },
      { t: '入境時可能被要求出示回程機票、住宿證明、旅遊保險與足夠旅費' },
    ],
    drive: '右', sos: '112',
    docs: [{ name: '旅遊保險英文投保證明', cat: '證件與金錢', bag: 'carry' }],
  };
  const eu = (plug, extra = {}) => ({ ...SCHENGEN, plug, volt: 230, ...extra, tips: [...(extra.tips || []), '多數餐廳已含服務費，小費可給零頭或約 5–10%', '自來水大多可生飲（依當地標示）', '注意扒手，尤其是觀光景點與地鐵'] });

  const I = {
    日本: {
      visa: '免簽，停留 90 天',
      entry: [{ t: 'Visit Japan Web：事先填寫入境審查與海關申報，取得 QR Code', url: 'https://www.vjw.digital.go.jp/' }],
      plug: 'A', volt: 100, drive: '左', sos: '警察 110／救護與消防 119',
      tips: ['不需要給小費', '同一天同一店家購物滿 5,000 日圓（未稅）可退稅，需出示護照', '電車與便利商店可用 IC 卡（Suica、ICOCA）'],
      docs: [{ name: 'Visit Japan Web QR Code（截圖）', cat: '證件與金錢', bag: 'carry' }],
    },
    韓國: {
      visa: '免簽，停留 90 天',
      entry: [
        { t: 'K-ETA 電子旅行許可：台灣曾享暫時免申請，出發前請確認目前是否需要', url: 'https://www.k-eta.go.kr/' },
        { t: '電子入境卡 e-Arrival Card 可事先線上填寫', url: 'https://www.e-arrivalcard.go.kr/' },
      ],
      plug: 'C／F', volt: 220, drive: '右', sos: '警察 112／救護與消防 119',
      tips: ['不需要給小費', '同店購物滿 15,000 韓元可退稅', '交通卡 T-money 可搭地鐵、公車與在便利商店付款'],
    },
    中國: {
      visa: '需持「台胞證」入境',
      entry: [{ t: '確認台胞證效期；部分網路服務（Google、LINE、Facebook）需另行準備' }],
      plug: 'A／C／I', volt: 220, drive: '右', sos: '警察 110／救護 120',
      tips: ['行動支付（支付寶、微信支付）非常普及，建議事先綁定', '自來水不建議生飲'],
      docs: [{ name: '台胞證', cat: '證件與金錢', bag: 'carry' }],
    },
    香港: {
      visa: '持台灣護照需事先網上辦理「預辦入境登記」（免費），可停留 30 天；持台胞證者可直接入境',
      entry: [{ t: '預辦入境登記：效期 2 個月、可入境 2 次', url: 'https://www.immd.gov.hk/' }],
      plug: 'G', volt: 220, drive: '左', sos: '999',
      tips: ['八達通可搭車與在便利商店付款', '餐廳常收 10% 服務費'],
      docs: [{ name: '香港預辦入境登記（列印或截圖）', cat: '證件與金錢', bag: 'carry' }],
    },
    澳門: {
      visa: '持台灣護照免簽，停留 30 天',
      entry: [],
      plug: 'G／D', volt: 220, drive: '左', sos: '999',
      tips: ['港幣可通用，但找零常是澳門幣', '各大酒店有免費接駁車'],
    },
    泰國: {
      visa: '免簽（目前 60 天；曾討論縮短為 30 天，出發前請確認）',
      entry: [{ t: '泰國數位入境卡 TDAC：抵達前 3 天內線上填寫', url: 'https://tdac.immigration.go.th/' }],
      plug: 'A／B／C／O', volt: 220, drive: '左', sos: '觀光警察 1155／救護 1669',
      tips: ['寺廟參觀需遮肩、遮膝', '小費非必要，按摩與服務可給 50–100 泰銖', '自來水不可生飲'],
      docs: [{ name: '泰國 TDAC 入境卡（截圖）', cat: '證件與金錢', bag: 'carry' }],
    },
    寮國: {
      visa: '需簽證：可事先申請電子簽證，或在主要口岸辦理落地簽（需美金現金與照片）',
      entry: [{ t: '寮國電子簽證', url: 'https://laoevisa.gov.la/' }],
      plug: 'A／B／C／E／F', volt: 230, drive: '右', sos: '依當地警察與飯店協助',
      tips: ['準備美金小鈔', '自來水不可生飲'],
      docs: [{ name: '大頭照 2 張（落地簽用）', cat: '證件與金錢', bag: 'carry' }, { name: '美金小鈔', cat: '證件與金錢', bag: 'carry' }],
    },
    越南: {
      visa: '需簽證：申請電子簽證（最長 90 天，可選單次或多次入境）',
      entry: [{ t: '越南官方電子簽證網站（注意避開代辦假網站）', url: 'https://evisa.gov.vn/' }],
      plug: 'A／C／F', volt: 220, drive: '右', sos: '警察 113／救護 115',
      tips: ['過馬路保持穩定速度前進', '小費非必要，按摩與導遊可給', '自來水不可生飲'],
      docs: [{ name: '越南電子簽證（列印）', cat: '證件與金錢', bag: 'carry' }],
    },
    菲律賓: {
      visa: '免簽 14 天（試辦措施，出發前請確認是否延長）',
      entry: [{ t: 'eTravel：抵達前 72 小時內線上登錄，取得 QR Code', url: 'https://etravel.gov.ph/' }],
      plug: 'A／B／C', volt: 220, drive: '右', sos: '911',
      tips: ['小費約 10%（若帳單未含服務費）', '自來水不可生飲'],
      docs: [{ name: '菲律賓 eTravel QR Code（截圖）', cat: '證件與金錢', bag: 'carry' }],
    },
    新加坡: {
      visa: '免簽，停留 30 天',
      entry: [{ t: 'SG Arrival Card：抵達前 3 天內線上填寫', url: 'https://eservices.ica.gov.sg/sgarrivalcard/' }],
      plug: 'G', volt: 230, drive: '左', sos: '警察 999／救護 995',
      tips: ['禁止攜帶口香糖入境販售、禁止電子菸', '餐廳通常已含服務費'],
    },
    馬來西亞: {
      visa: '免簽（停留天數請出發前確認）',
      entry: [{ t: '馬來西亞數位入境卡 MDAC：抵達前 3 天內填寫', url: 'https://imigresen-online.imi.gov.my/mdac/main' }],
      plug: 'G', volt: 240, drive: '左', sos: '999',
      tips: ['參觀清真寺需穿著保守'],
    },
    印尼: {
      visa: '落地簽證 VoA（可事先線上申請 e-VoA），停留 30 天',
      entry: [{ t: '印尼電子落地簽 e-VoA', url: 'https://evisa.imigrasi.go.id/' }, { t: '峇里島另需支付觀光稅' }],
      plug: 'C／F', volt: 230, drive: '左', sos: '112',
      tips: ['自來水不可生飲'],
    },
    柬埔寨: {
      visa: '需簽證：電子簽證或落地簽',
      entry: [{ t: '柬埔寨電子簽證', url: 'https://www.evisa.gov.kh/' }],
      plug: 'A／C／G', volt: 230, drive: '右', sos: '警察 117／救護 119',
      tips: ['美金普遍通用', '吳哥窟參觀需遮肩、遮膝'],
    },
    土耳其: {
      visa: '需電子簽證 e-Visa（單次入境，停留 30 天）',
      entry: [{ t: '土耳其官方電子簽證網站', url: 'https://www.evisa.gov.tr/' }],
      plug: 'C／F', volt: 230, drive: '右', sos: '112',
      tips: ['里拉匯率波動大，可分批換匯', '進清真寺女性需包頭巾、男女需遮膝', '小費約 5–10%', '自駕需國際駕照與台灣駕照正本'],
      docs: [{ name: '土耳其電子簽證（列印）', cat: '證件與金錢', bag: 'carry' }],
    },
    英國: {
      visa: '免簽，停留 6 個月',
      entry: [{ t: '需事先申請電子旅行許可 ETA（效期 2 年）', url: 'https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta' }],
      plug: 'G', volt: 230, drive: '左', sos: '999',
      tips: ['倫敦交通可直接用感應式信用卡', '餐廳常已含 12.5% 服務費'],
      docs: [{ name: '英國 ETA 核准信（截圖）', cat: '證件與金錢', bag: 'carry' }],
    },
    愛爾蘭: { visa: '免簽，停留 90 天（不屬於申根區）', entry: [], plug: 'G', volt: 230, drive: '左', sos: '112／999', tips: [] },
    法國: eu('C／E'), 比利時: eu('C／E'), 荷蘭: eu('C／F'), 盧森堡: eu('C／F'), 德國: eu('C／F'), 奧地利: eu('C／F'),
    捷克: eu('C／E', { tips: ['使用克朗，部分店家收歐元但匯率差'] }),
    匈牙利: eu('C／F', { tips: ['使用福林，部分店家收歐元但匯率差'] }),
    波蘭: eu('C／E', { tips: ['使用茲羅提'] }),
    斯洛伐克: eu('C／F'), 斯洛維尼亞: eu('C／F'), 克羅埃西亞: eu('C／F'),
    義大利: eu('C／F／L'), 西班牙: eu('C／F'), 葡萄牙: eu('C／F'), 希臘: eu('C／F'),
    瑞士: eu('C／J', { tips: ['使用瑞士法郎，插座 J 型與一般歐規不同'] }),
    丹麥: eu('C／E／F／K'), 瑞典: eu('C／F'), 挪威: eu('C／F'), 芬蘭: eu('C／F'), 冰島: eu('C／F'),

    俄羅斯: {
      visa: '需事先申請簽證（部分國家可申請電子簽證，台灣是否適用請確認）',
      entry: [{ t: '出發前請向俄羅斯官方或外交部領事事務局確認最新規定與旅遊警示' }],
      plug: 'C／F', volt: 220, sos: '112',
      tips: ['國際信用卡（Visa、Mastercard）在當地多數無法使用，需準備足夠美元或歐元現金', '部分國際 App 與網路服務受限'],
      docs: [{ name: '俄羅斯簽證', cat: '證件與金錢', bag: 'carry' }, { name: '美元／歐元現金（信用卡多數不能用）', cat: '證件與金錢', bag: 'carry' }],
    },
    蒙古: { visa: '需簽證（可申請電子簽證，請確認）', entry: [], plug: 'C／E', volt: 230, sos: '警察 102／救護 103', tips: ['早晚溫差大', '郊區多為現金交易'] },
    印度: {
      visa: '需電子簽證 e-Visa', entry: [{ t: '印度官方電子簽證網站', url: 'https://indianvisaonline.gov.in/evisa/' }],
      plug: 'C／D／M', volt: 230, sos: '112', tips: ['自來水不可生飲', '參觀宗教場所需脫鞋、穿著保守'],
      docs: [{ name: '印度電子簽證（列印）', cat: '證件與金錢', bag: 'carry' }],
    },
    尼泊爾: { visa: '可辦落地簽證（依停留天數收費，準備美金與照片）', entry: [], plug: 'C／D／M', volt: 230, sos: '警察 100', tips: ['高山健行注意高山症', '自來水不可生飲'], docs: [{ name: '大頭照（落地簽用）', cat: '證件與金錢', bag: 'carry' }] },
    斯里蘭卡: { visa: '需事先線上申請 ETA', entry: [{ t: '斯里蘭卡 ETA', url: 'https://www.eta.gov.lk/' }], plug: 'D／G', volt: 230, sos: '119', tips: ['參觀佛寺需遮肩膝、脫鞋'] },
    馬爾地夫: {
      visa: '免費落地簽證，停留 30 天（需有回程機票與訂房）',
      entry: [{ t: '抵達前 96 小時內填寫 IMUGA 旅客申報單', url: 'https://imuga.immigration.gov.mv/' }],
      plug: 'D／G', volt: 230, sos: '119', tips: ['首都等居民島禁酒、穿著需保守', '度假村多含服務費與稅'],
    },
    阿聯: { visa: '需事先辦理簽證（可透過航空公司或飯店代辦，請確認最新規定）', entry: [], plug: 'G', volt: 230, sos: '警察 999', tips: ['齋戒月白天避免在公共場所飲食', '穿著需保守'] },
    卡達: { visa: '入境規定請出發前確認', entry: [], plug: 'G／D', volt: 240, sos: '999', tips: ['穿著需保守'] },
    約旦: { visa: '可辦落地簽證；購買 Jordan Pass 可免簽證費並含佩特拉門票', entry: [{ t: 'Jordan Pass', url: 'https://www.jordanpass.jo/' }], plug: 'C／D／F／G／J', volt: 230, sos: '911', tips: ['佩特拉需大量步行'] },
    以色列: { visa: '免簽，停留 90 天，需事先申請電子旅行授權 ETA-IL', entry: [{ t: 'ETA-IL', url: 'https://www.gov.il/en/departments/topics/eta-il' }], plug: 'C／H', volt: 230, sos: '警察 100／救護 101', tips: ['安息日（週五日落至週六日落）大眾運輸與商店多休息'] },
    埃及: { visa: '需簽證（電子簽證或落地簽，請確認）', entry: [{ t: '埃及電子簽證', url: 'https://visa2egypt.gov.eg/' }], plug: 'C／F', volt: 220, sos: '警察 122／救護 123', tips: ['小費文化普遍', '自來水不可生飲'] },
    摩洛哥: { visa: '需簽證（請確認是否可申請電子簽證）', entry: [], plug: 'C／E', volt: 220, sos: '警察 19／救護 15', tips: ['市集購物要殺價', '穿著需保守'] },
    喬治亞: { visa: '需簽證（可申請電子簽證，請確認）', entry: [{ t: '喬治亞電子簽證', url: 'https://www.evisa.gov.ge/' }], plug: 'C／F', volt: 220, sos: '112', tips: [] },
    烏茲別克: { visa: '需簽證（可申請電子簽證，請確認）', entry: [{ t: '烏茲別克電子簽證', url: 'https://e-visa.gov.uz/' }], plug: 'C／F', volt: 220, sos: '', tips: ['住宿需登記，保留每晚住宿證明'] },
    墨西哥: { visa: '需簽證；持有效美國、加拿大、英國、日本或申根簽證者可免簽入境（ESTA 不算）', entry: [], plug: 'A／B', volt: 127, sos: '911', tips: ['小費約 10–15%', '自來水不可生飲'] },
    秘魯: { visa: '入境規定請出發前確認', entry: [], plug: 'A／C', volt: 220, sos: '105', tips: ['庫斯科、馬丘比丘海拔高，注意高山症', '馬丘比丘門票需提早預約'] },
    巴西: { visa: '需簽證（可申請電子簽證，請確認）', entry: [], plug: 'C／N', volt: 220, sos: '警察 190／救護 192', tips: ['部分城市電壓為 127V', '注意治安與隨身財物'] },
    阿根廷: { visa: '需簽證；持有效美國簽證可申請電子旅行授權 AVE（請確認）', entry: [], plug: 'C／I', volt: 220, sos: '911', tips: ['匯率差異大，換匯前先了解行情'] },
    智利: { visa: '免簽，停留 90 天', entry: [], plug: 'C／L', volt: 220, sos: '警察 133／救護 131', tips: [] },
    古巴: { visa: '需旅遊卡（Tourist Card），可透過航空公司購買', entry: [{ t: '入境前需線上填寫 D\'Viajeros 申報' }], plug: 'A／B／C', volt: 110, sos: '106', tips: ['美國發行的信用卡無法使用，準備歐元現金', '網路受限'] },
    南非: { visa: '入境規定請出發前確認', entry: [], plug: 'C／M／N', volt: 230, sos: '10111', tips: ['注意治安，夜間避免步行'] },
    肯亞: { visa: '需事先線上申請 eTA', entry: [{ t: '肯亞 eTA', url: 'https://www.etakenya.go.ke/' }], plug: 'G', volt: 240, sos: '999', tips: ['需注意黃熱病疫苗規定'] },
    帛琉: { visa: '免費落地簽證，停留 30 天', entry: [{ t: '入境需簽署「帛琉承諾」保護環境' }], plug: 'A／B', volt: 120, sos: '911', tips: ['使用美元', '需使用環保防曬乳'] },
    關島: { visa: '可申請 ESTA，或適用關島—北馬利安納群島免簽計畫（需台灣身分證，請確認）', entry: [{ t: 'ESTA', url: 'https://esta.cbp.dhs.gov/' }], plug: 'A／B', volt: 110, sos: '911', tips: ['使用美元，需給小費'], docs: [{ name: '國民身分證', cat: '證件與金錢', bag: 'carry' }] },
    汶萊: { visa: '入境規定請出發前確認', entry: [], plug: 'G', volt: 240, sos: '警察 993', tips: ['全國禁酒'] },
    緬甸: { visa: '需電子簽證', entry: [{ t: '緬甸電子簽證', url: 'https://evisa.moip.gov.mm/' }], plug: 'C／D／F／G', volt: 230, sos: '199', tips: ['請先查詢外交部旅遊警示'] },
    美國: {
      visa: '免簽（VWP），停留 90 天，需事先申請 ESTA',
      entry: [{ t: 'ESTA 旅行授權：出發前 72 小時以前申請，效期 2 年（請只用官方網站）', url: 'https://esta.cbp.dhs.gov/' }],
      plug: 'A／B', volt: 120, drive: '右', sos: '911',
      tips: ['小費：餐廳 18–20%、計程車 15–20%、飯店房務每晚約 USD 2–5', '標價未含稅，結帳會另加銷售稅', '肉類與新鮮蔬果不可攜帶入境'],
      docs: [{ name: 'ESTA 核准頁（截圖）', cat: '證件與金錢', bag: 'carry' }],
    },
    加拿大: {
      visa: '免簽，停留 6 個月，搭機入境需事先申請 eTA',
      entry: [{ t: '加拿大電子旅行證 eTA', url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta.html' }],
      plug: 'A／B', volt: 120, drive: '右', sos: '911',
      tips: ['小費約 15–20%', '標價未含稅'],
    },
    澳洲: {
      visa: '需電子旅行授權 ETA（以官方 App 申請）',
      entry: [{ t: 'Australian ETA App 申請' }, { t: '檢疫嚴格：食物、植物、動物製品都要申報' }],
      plug: 'I', volt: 230, drive: '左', sos: '000',
      tips: ['小費非必要'],
    },
    紐西蘭: {
      visa: '免簽，需事先申請 NZeTA 並繳國際旅客保育觀光稅 IVL',
      entry: [{ t: 'NZeTA', url: 'https://www.immigration.govt.nz/nzeta' }],
      plug: 'I', volt: 230, drive: '左', sos: '111',
      tips: ['檢疫嚴格，食物需申報'],
    },
  };

  const BOCA = 'https://www.boca.gov.tw/';

  /** 依插頭型式判斷台灣電器能不能直接用 */
  function adapterNote(info) {
    if (!info?.plug) return null;
    const types = info.plug.split(/[／/]/);
    const plugOk = types.includes('A') || types.includes('B');
    const volt = info.volt || 0;
    return {
      need: !plugOk,
      type: types.filter(t => !['A', 'B'].includes(t)).join('／'),
      text: (plugOk ? '台灣插頭可直接使用' : `需要轉接頭（${types.join('／')} 型）`) +
        (volt >= 200 ? `；電壓 ${volt}V，吹風機、離子夾等請確認支援 100–240V` : volt ? `；電壓 ${volt}V` : ''),
    };
  }

  // 以國碼對應，避免中文譯名不同對不上
  const BY = {};
  for (const [k, v] of Object.entries(I)) { const c = TA.countries.find(k); if (c) BY[c.iso] = v; }
  const get = name => {
    const c = TA.countries.find(name);
    if (!c) return null;
    const v = BY[c.iso];
    return v ? { ...v, drive: v.drive || c.drive } : null;
  };

  window.TA = window.TA || {};
  TA.countryInfo = { get, adapterNote, BOCA, curated: name => !!BY[TA.countries.find(name)?.iso] };
})();
