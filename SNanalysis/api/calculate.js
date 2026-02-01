const math = require('mathjs');

export default function handler(req, res) {
    // --- 新增這段：處理 CORS ---
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); // 測試時先設為 *，之後可改為您的網頁網址
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // 處理預檢請求 (Preflight)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    // -----------------------

    if (req.method === 'POST') {
        try {
            const params = req.body;
            // 這裡放原本的 runSimulation 邏輯
            const result = runSimulation(params); 
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    } else {
        res.status(405).send('Method Not Allowed');
    }
}

function runSimulation(p) {
    const {S0, KO, koStep, AKI, K, V, COR, N, D, R, r, totalMonths, symbols, kiType, gMonths, koFreq, koMode} = p;
    const dim = symbols.length;
    const dt = 1/252;
    const L = dynamicCholesky(COR);
    const rng = new SeededRandom(42);
    let payoffs = [], periods = [];
    let scCounts = new Array(totalMonths + 2).fill(0); 
    let worstCounts = new Array(dim).fill(0);
    const minKoDays = gMonths * 21;
    
    // 獲取配息模式 (從 UI 讀取，若無此 UI 則預設為 Fixed)
    const couponType = document.getElementById('couponType') ? document.getElementById('couponType').value : "Fixed";

    for (let n = 0; n < N; n++) {
        let St = [...S0];
        let kiTouched = (kiType === "NA"); 
        let ended = false;
        let koReachedEver = new Array(dim).fill(false);
        
        // 累計利息計數
        let accruedCouponDays = 0;
        
        for (let d = 1; d <= D; d++) {
            let rawZ = Array.from({length: dim}, () => seededRandn(rng));
            let dz = new Array(dim).fill(0);
            for (let i = 0; i < dim; i++) {
                for (let j = 0; j <= i; j++) { dz[i] += L[i][j] * rawZ[j]; }
            }
            for (let i = 0; i < dim; i++) {
                St[i] *= Math.exp((r - 0.5 * V[i]**2) * dt + V[i] * Math.sqrt(dt) * dz[i]);
                if (kiType === "AKI" && St[i] < AKI[i]) kiTouched = true;
            }

            // --- 浮動配息計算邏輯 ---
            let isGuaranteed = d <= minKoDays;
            let allAboveStrike = St.every((s, i) => s >= K[i]);
            
            if (couponType === "Fixed" || isGuaranteed || allAboveStrike) {
                accruedCouponDays++;
            }
            // -----------------------

            // KO 邏輯
            let currentStepIdx = Math.floor((d - 1) / 21);
            let currentStepShift = 1 + (currentStepIdx * koStep); 
            let currentKO = KO.map(baseKO => baseKO * currentStepShift);

            if (d >= minKoDays) {
                for (let i = 0; i < dim; i++) {
                    if (St[i] >= currentKO[i]) koReachedEver[i] = true;
                }

                let isObservationDay = (koFreq === "Daily") ? true : (d % 21 === 0);
                if (isObservationDay) {
                    let isKoTriggered = (koMode === "Memory") ? 
                        koReachedEver.every(v => v === true) : 
                        St.every((s, i) => s >= currentKO[i]);

                    if (isKoTriggered) {
                        // 票息計算：使用實際累計的天數
                        let payoff = 100 * (1 + (accruedCouponDays / 252) * R) * Math.exp(-r * (d / 252));
                        payoffs.push(payoff);
                        periods.push(d);
                        let mIdx = Math.min(Math.floor((d - 1) / 21), totalMonths - 1);
                        scCounts[mIdx]++;
                        ended = true;
                        break;
                    }
                }
            }

            // 到期處理
            if (d === D && !ended) {
                if (kiType === "EKI" && St.some((s, i) => s < AKI[i])) kiTouched = true;
                let disc = Math.exp(-r * (D / 252));
                let totalCoupon = (accruedCouponDays / 252) * R;
                
                if (!kiTouched || St.every((s, i) => s >= K[i])) {
                    payoffs.push(100 * (1 + totalCoupon) * disc);
                    scCounts[totalMonths]++;
                } else {
                    let perf = St.map((s, i) => s / S0[i]);
                    let mP = Math.min(...perf);
                    let worstAssetIdx = perf.indexOf(mP);
                    worstCounts[worstAssetIdx]++;
                    // 實物交割：累計利息 + 最差資產價值
                    payoffs.push((100 * totalCoupon + 100 * (St[worstAssetIdx] / K[worstAssetIdx])) * disc);
                    scCounts[totalMonths + 1]++;
                }
                periods.push(D);
            }
        }
    }

    // 計算風險指標 VaR / CVaR
    const sortedPayoffs = [...payoffs].sort((a, b) => a - b);
    const riskData = {};
    [0.01, 0.03, 0.05, 0.10, 0.15].forEach(alpha => {
        const index = Math.max(0, Math.floor(N * alpha));
        const label = Math.round((1 - alpha) * 100);
        const varVal = sortedPayoffs[index] - 100;
        riskData[`VaR${label}`] = varVal;
        const worstPaths = sortedPayoffs.slice(0, index + 1);
        const avgPayoff = worstPaths.reduce((a, b) => a + b, 0) / (worstPaths.length || 1);
        riskData[`CVaR${label}`] = avgPayoff - 100;
    });

    return {
        avgReturn: (math.mean(payoffs) - 100), 
        avgDay: math.mean(periods),
        scenarioProbs: scCounts.map(c => (c / N) * 100),
        worstAssetProbs: worstCounts.map(c => (c / N) * 100),
        riskResults: riskData
    };
}

