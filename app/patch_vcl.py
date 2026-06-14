import sys
import re

content = open('c:/Users/User/Desktop/ENAPP/vcl.html', 'r', encoding='utf-8').read()

offline_code = """
        // PWA & Offline Sync Logic
        const dbName = "VocabProDB";
        let db;
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = event => {
            db = event.target.result;
            if (!db.objectStoreNames.contains("syncQueue")) {
                db.createObjectStore("syncQueue", { autoIncrement: true });
            }
        };
        request.onsuccess = event => { db = event.target.result; };

        async function queueSyncRequest(payload) {
            if (!db) return;
            const tx = db.transaction("syncQueue", "readwrite");
            tx.objectStore("syncQueue").add(payload);
            return new Promise(resolve => {
                tx.oncomplete = () => {
                    showToast("離線狀態，操作已加入背景佇列", "warning");
                    resolve();
                };
            });
        }

        async function processSyncQueue() {
            if (!db || !navigator.onLine) return;
            const tx = db.transaction("syncQueue", "readonly");
            const store = tx.objectStore("syncQueue");
            const req = store.getAll();
            
            req.onsuccess = async () => {
                const queue = req.result;
                if (queue.length === 0) return;
                showToast("網路恢復，正在同步背景佇列...", "success");
                for (let i = 0; i < queue.length; i++) {
                    try {
                        await fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(queue[i]) });
                    } catch(e) {
                        return; // stop on first error
                    }
                }
                const clearTx = db.transaction("syncQueue", "readwrite");
                clearTx.objectStore("syncQueue").clear();
                showToast("背景同步完成！");
            };
        }
        window.addEventListener('online', processSyncQueue);

        async function safeGASFetch(payload) {
            if (!navigator.onLine) {
                if (payload.action === "getData" || payload.action === "login") throw new Error("Offline");
                await queueSyncRequest(payload);
                return { status: "success", offline: true };
            }
            try {
                const response = await fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(payload) });
                return await response.json();
            } catch (e) {
                if (payload.action === "getData" || payload.action === "login") throw e;
                await queueSyncRequest(payload);
                return { status: "success", offline: true };
            }
        }

        async function saveWord() {"""

content = content.replace('        async function saveWord() {', offline_code)

content = re.sub(
    r'const response = await fetch\(GAS_URL,\s*\{\s*method:\s*"POST",\s*headers:\s*\{\s*"Content-Type":\s*"text/plain"\s*\},\s*body:\s*JSON\.stringify\((.*?)\)\s*\}\);(\s*)const result = await response\.json\(\);',
    r'const result = await safeGASFetch(\1);',
    content
)

content = re.sub(
    r'fetch\(GAS_URL,\s*\{\s*method:\s*"POST",\s*headers:\s*\{\s*"Content-Type":\s*"text/plain"\s*\},\s*body:\s*JSON\.stringify\((.*?)\)\s*\}\)\.catch\(e => console\.error\(e\)\);',
    r'safeGASFetch(\1).catch(e => console.error(e));',
    content
)

open('c:/Users/User/Desktop/ENAPP/vcl.html', 'w', encoding='utf-8').write(content)
print('vcl.html updated successfully.')
