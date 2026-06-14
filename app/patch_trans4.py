import re

content = open('c:/Users/User/Desktop/ENAPP/vcl.html', 'r', encoding='utf-8').read()

# Restore btn-easy
content = content.replace('簡單<br><small>4 天後</small></div> <!-- Close add-mode-manual -->', '簡單<br><small>4 天後</small></button>\\n            </div>')

# Remove add-mode-trans from sec-flashcard
bad_trans_pattern = r'<!-- 智慧翻譯模式 -->.*?</div>\s*</section>'
content = re.sub(bad_trans_pattern, '</section>', content, flags=re.DOTALL)

add_mode_trans_block = '''</div> <!-- Close add-mode-manual -->
            
            <!-- 智慧翻譯模式 -->
            <div id="add-mode-trans" class="card" style="display:none; border: 2px solid var(--primary-light); box-shadow: 0 8px 24px rgba(0,0,0,0.06);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <h2 style="font-size:18px; margin-bottom:20px; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                        <i class="fas fa-language" style="color:var(--primary);"></i> 翻譯與擷取
                    </h2>
                </div>
                <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px; line-height:1.5;">輸入單字或句子進行雙向翻譯。點擊結果中的英文單字，即可快速加入單字本！</p>
                
                <div style="display:flex; gap:12px; margin-bottom:12px;">
                    <select id="trans-dir" style="flex:1; padding:12px; border-radius:10px; border:1px solid var(--border); background:var(--bg-color); font-size:14px; font-weight:600; color:var(--text-main);">
                        <option value="en2zh">🇬🇧 英文 ➔ 🇹🇼 中文</option>
                        <option value="zh2en">🇹🇼 中文 ➔ 🇬🇧 英文</option>
                        <option value="auto">🤖 自動偵測 ➔ 🇹🇼 中文</option>
                    </select>
                </div>
                
                <textarea id="trans-input" placeholder="請輸入要翻譯的文字..." style="width:100%; height:100px; padding:16px; border-radius:12px; border:1px solid var(--border); background:var(--bg-color); color:var(--text-main); font-size:15px; margin-bottom:12px; resize:vertical; font-family:inherit;"></textarea>
                
                <button class="btn-primary" id="btn-trans" onclick="doTranslation()" style="width:100%; padding:14px; font-size:16px; border-radius:10px; margin-bottom:16px;">
                    <i class="fas fa-exchange-alt"></i> 開始翻譯
                </button>
                
                <div id="trans-result-card" style="display:none; background:var(--bg-color); padding:16px; border-radius:12px; border:1px solid var(--border);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                        <h4 style="font-size:13px; color:var(--text-muted); font-weight:700;">翻譯結果：</h4>
                        <button class="btn-icon-small" id="btn-trans-tts" onclick="playTransTTS()" style="background:var(--primary-light); color:var(--primary); margin:0;" title="朗讀英文">
                            <i class="fas fa-volume-up"></i>
                        </button>
                    </div>
                    <div id="trans-output" style="font-size:16px; color:var(--text-main); line-height:1.6; font-weight:500; white-space:pre-wrap;">
                        <!-- 結果放這裡 -->
                    </div>
                </div>
            </div>
        </section>'''

sec_add_end_pattern = r'(<i class="fas fa-check-circle"></i> 儲存單字\s*</button>\s*</div>\s*)</section>'
if re.search(sec_add_end_pattern, content):
    content = re.sub(sec_add_end_pattern, r'\g<1>' + add_mode_trans_block, content)
    open('c:/Users/User/Desktop/ENAPP/vcl.html', 'w', encoding='utf-8').write(content)
    print('Fixed vcl.html properly!')
else:
    print('Cannot find sec_add_end_pattern!')
