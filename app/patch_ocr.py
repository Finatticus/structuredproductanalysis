import sys
import re

content = open('c:/Users/User/Desktop/ENAPP/vcl.html', 'r', encoding='utf-8').read()

tesseract_script = '<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>'
if tesseract_script not in content:
    content = content.replace('</head>', tesseract_script + '\n</head>')

ocr_style = '''
<style>
.ocr-chip {
    padding: 8px 16px;
    border-radius: 20px;
    background: var(--bg-color);
    border: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    font-weight: 600;
    font-size: 14px;
    transition: all 0.2s ease;
    user-select: none;
}
.ocr-chip.selected {
    background: var(--primary);
    color: white;
    border-color: var(--primary);
}
</style>
'''
if 'ocr-chip' not in content:
    content = content.replace('</head>', ocr_style + '\n</head>')

ocr_script = '''
        // OCR Logic
        let selectedOCRWords = new Set();

        function showOCRModalLoading() {
            document.getElementById('ocr-modal').style.display = 'flex';
            document.getElementById('ocr-loading').style.display = 'block';
            document.getElementById('ocr-results').style.display = 'none';
            document.getElementById('ocr-actions').style.display = 'none';
            document.getElementById('ocr-modal-title').innerText = "智慧鏡頭辨識中...";
            document.getElementById('ocr-modal-desc').innerText = "請稍候，正在解析圖片中的單字";
        }

        function closeOCRModal() {
            document.getElementById('ocr-modal').style.display = 'none';
            document.getElementById('ocr-upload').value = "";
        }

        async function handleOCR(event) {
            const file = event.target.files[0];
            if (!file) return;
            showOCRModalLoading();
            
            try {
                const worker = await Tesseract.createWorker('eng');
                const ret = await worker.recognize(file);
                await worker.terminate();
                
                const text = ret.data.text;
                const words = text.match(/[A-Za-z]{2,}/g) || [];
                const uniqueWords = [...new Set(words.map(w => w.toLowerCase()))];
                renderOCRSelectionModal(uniqueWords);
            } catch (err) {
                console.error(err);
                showToast("圖片辨識失敗", "error");
                closeOCRModal();
            }
        }

        function renderOCRSelectionModal(words) {
            document.getElementById('ocr-loading').style.display = 'none';
            if(words.length === 0) {
                document.getElementById('ocr-modal-desc').innerText = "找不到任何英文單字";
                document.getElementById('ocr-actions').style.display = 'flex';
                return;
            }
            
            document.getElementById('ocr-modal-title').innerText = "請選擇要匯入的單字";
            document.getElementById('ocr-modal-desc').innerText = `共辨識出 ${words.length} 個單字，點選即可選取。`;
            
            const container = document.getElementById('ocr-results');
            container.style.display = 'flex';
            container.innerHTML = '';
            selectedOCRWords.clear();
            updateOCRSelectedCount();
            
            words.forEach(word => {
                const chip = document.createElement('div');
                chip.className = 'ocr-chip';
                chip.innerText = word;
                chip.onclick = () => {
                    if (selectedOCRWords.has(word)) {
                        selectedOCRWords.delete(word);
                        chip.classList.remove('selected');
                    } else {
                        selectedOCRWords.add(word);
                        chip.classList.add('selected');
                    }
                    updateOCRSelectedCount();
                };
                container.appendChild(chip);
            });
            document.getElementById('ocr-actions').style.display = 'flex';
        }

        function updateOCRSelectedCount() {
            document.getElementById('ocr-selected-count').innerText = selectedOCRWords.size;
        }

        async function processBatchAddOCR() {
            if (selectedOCRWords.size === 0) {
                showToast("請至少選擇一個單字", "error");
                return;
            }
            const wordsArray = Array.from(selectedOCRWords);
            const book = document.getElementById("active-book-select").value || "預設單字本";
            
            document.getElementById('ocr-modal-title').innerText = "正在批次翻譯與匯入...";
            document.getElementById('ocr-modal-desc').innerText = "這可能需要一些時間，請勿關閉視窗";
            document.getElementById('ocr-results').style.display = 'none';
            document.getElementById('ocr-actions').style.display = 'none';
            document.getElementById('ocr-loading').style.display = 'block';
            
            try {
                // Batch translate
                const batchPromises = wordsArray.map(async (en) => {
                    try {
                        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=${encodeURIComponent(en)}`);
                        const data = await res.json();
                        const zh = data[0][0][0];
                        return { book, english: en, chinese: zh, notes: "來自相機辨識", pos: "" };
                    } catch(e) { return null; }
                });
                
                const payloads = (await Promise.all(batchPromises)).filter(p => p !== null);
                
                if (payloads.length > 0) {
                    const result = await safeGASFetch({ action: "batchAddWords", username: currentUser, words: payloads });
                    if (result.status === "success") {
                        payloads.forEach(p => {
                            p.timestamp = new Date().toString();
                            allWords.push(p);
                        });
                        updateDueCount();
                        showToast(`成功匯入 ${payloads.length} 個單字！`);
                    } else {
                        throw new Error(result.message);
                    }
                }
            } catch (err) {
                console.error(err);
                showToast("批次匯入失敗，請確認網路或 GAS 後端已更新", "error");
            }
            closeOCRModal();
        }
'''
if 'let selectedOCRWords = new Set();' not in content:
    content = content.replace('        async function saveWord() {', ocr_script + '\n        async function saveWord() {')

open('c:/Users/User/Desktop/ENAPP/vcl.html', 'w', encoding='utf-8').write(content)
print('OCR Logic Injected Successfully')
