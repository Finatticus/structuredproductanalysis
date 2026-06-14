import re

def main():
    text = open('finance.html', encoding='utf-8').read()
    
    # 1. Insert RWD CSS block
    rwd_css = """
        /* ==========================================
           RWD Mobile Responsiveness (max-width: 768px)
           ========================================== */
        @media (max-width: 768px) {
            /* Header and Navigation */
            .header { flex-direction: column; align-items: flex-start; gap: 12px; }
            .header-left { width: 100%; }
            .logout-btn { align-self: flex-end; margin-top: -35px; }
            .nav-tabs { overflow-x: auto; flex-wrap: nowrap; padding-bottom: 8px; -webkit-overflow-scrolling: touch; scrollbar-width: none; width: 100%; }
            .nav-tabs::-webkit-scrollbar { display: none; }
            .nav-tab { white-space: nowrap; }
            
            /* Grid adjustments */
            .grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
            .card { min-height: 75px; padding: 10px; }
            .card-sparkline { display: none; } /* Hide sparkline on mobile to save space */
            
            /* Add Target Container */
            .add-target-container { max-width: 100%; }
            
            /* Insights specific adjustments */
            div[style*="grid-template-columns: repeat(auto-fit, minmax(400px, 1fr))"] {
                grid-template-columns: 1fr !important;
            }
            
            /* Heatmap adjustments */
            #sector-heatmap {
                grid-template-columns: repeat(2, 1fr) !important;
                grid-auto-rows: minmax(65px, auto) !important;
            }
            #sector-heatmap > div {
                grid-column: span 1 !important;
                grid-row: span 1 !important;
                padding: 8px !important;
            }
            
            /* Crypto On-chain */
            #insights-tab .market-section > div[style*="flex-direction: column"] > div[style*="justify-content: space-between"] {
                flex-direction: column !important;
                align-items: flex-start !important;
                gap: 8px;
            }
            #insights-tab .market-section > div[style*="flex-direction: column"] > div[style*="justify-content: space-between"] > div:last-child {
                text-align: left !important;
            }
            
            /* Yield Curve / FedWatch */
            .market-section > div[style*="justify-content: space-around"] {
                flex-direction: column;
                gap: 10px;
            }
            
            /* Responsive Tables */
            .portfolio-table thead { display: none; }
            .portfolio-table tr { 
                display: block; 
                margin-bottom: 12px; 
                border: 1px solid var(--border-color); 
                border-radius: 8px; 
                padding: 10px; 
                background: var(--panel-bg); 
            }
            .portfolio-table td { 
                display: flex; 
                justify-content: space-between; 
                align-items: center; 
                text-align: right; 
                border-bottom: 1px solid rgba(255,255,255,0.05); 
                padding: 8px 4px; 
                white-space: normal;
                font-size: 13px;
            }
            .portfolio-table td:last-child { border-bottom: none; }
            .portfolio-table td::before { 
                content: attr(data-label); 
                font-weight: 600; 
                color: var(--text-muted); 
                margin-right: 15px; 
                text-align: left;
            }
            
            /* Portfolio specific */
            .portfolio-summary { grid-template-columns: 1fr; gap: 8px; }
            #portfolio-tab .bottom-section[style*="flex-direction: row"], 
            #portfolio-tab > div > div[style*="flex-wrap:wrap"] {
                flex-direction: column !important;
                gap: 20px !important;
            }
            #portfolio-edit-form-section > div[style*="display:flex"] {
                flex-direction: column;
                align-items: stretch !important;
            }
            #portfolio-edit-form-section > div[style*="display:flex"] > input, 
            #portfolio-edit-form-section > div[style*="display:flex"] > select, 
            #portfolio-edit-form-section > div[style*="display:flex"] > button {
                width: 100% !important;
            }
            
            /* Settings specific */
            #settings-tab > div > div > div[style*="display:flex; flex-direction:column; gap:14px;"] > label {
                align-items: flex-start;
            }
            
            /* Chart Modal */
            .modal-container { width: 95vw; height: 90vh; }
            .modal-tabs { margin-left: 10px; overflow-x: auto; flex-wrap: nowrap; white-space: nowrap; }
            .modal-header { flex-wrap: wrap; gap: 10px; }
            .modal-title-group { width: 100%; justify-content: space-between; }
            .modal-close { position: absolute; top: 12px; right: 15px; }
        }
    """
    
    if "RWD Mobile Responsiveness" not in text:
        text = text.replace('    </style>', rwd_css + '\n    </style>')
        
    # 2. Update Taiwan Margin Table with data-labels
    tw_table_start = text.find('📉 集中市場融資餘額 (Margin Long)')
    if tw_table_start != -1:
        # Long
        text = text.replace(
            '<td style="font-weight:bold; color: var(--text-main);">📈 集中市場融資餘額 (Margin Long)</td>\n                                <td style="color:var(--text-main); font-weight:bold;">3,250.45 億元</td>\n                                <td style="color:var(--up-color); font-weight:bold;">+15.20 億元</td>\n                                <td><span style="color:var(--accent-color); font-size: 11px;">高檔過熱區間</span></td>',
            '<td data-label="項目" style="font-weight:bold; color: var(--text-main);">📈 集中市場融資餘額</td>\n                                <td data-label="最新餘額" style="color:var(--text-main); font-weight:bold;">3,250.45 億元</td>\n                                <td data-label="單日增減" style="color:var(--up-color); font-weight:bold;">+15.20 億元</td>\n                                <td data-label="狀態"><span style="color:var(--accent-color); font-size: 11px;">高檔過熱區間</span></td>'
        )
        # Short
        text = text.replace(
            '<td style="font-weight:bold; color: var(--text-main);">📉 集中市場融券餘額 (Margin Short)</td>\n                                <td style="color:var(--text-main); font-weight:bold;">28.5 萬張</td>\n                                <td style="color:var(--down-color); font-weight:bold;">-1.2 萬張</td>\n                                <td><span style="color:var(--text-muted); font-size: 11px;">空頭退潮</span></td>',
            '<td data-label="項目" style="font-weight:bold; color: var(--text-main);">📉 集中市場融券餘額</td>\n                                <td data-label="最新餘額" style="color:var(--text-main); font-weight:bold;">28.5 萬張</td>\n                                <td data-label="單日增減" style="color:var(--down-color); font-weight:bold;">-1.2 萬張</td>\n                                <td data-label="狀態"><span style="color:var(--text-muted); font-size: 11px;">空頭退潮</span></td>'
        )
        # Ratio
        text = text.replace(
            '<td style="font-weight:bold; color: var(--text-main);">📊 大盤整體維持率 (Maintenance Ratio)</td>\n                                <td style="color:var(--text-main); font-weight:bold;">172.5%</td>\n                                <td style="color:var(--up-color); font-weight:bold;">+0.8%</td>\n                                <td><span style="background:var(--up-bg); color:var(--up-color); padding: 4px 8px; border-radius: 4px; font-size: 11px; border: 1px solid rgba(34,197,94,0.2);">✅ 安全健康</span></td>',
            '<td data-label="項目" style="font-weight:bold; color: var(--text-main);">📊 大盤整體維持率</td>\n                                <td data-label="最新餘額" style="color:var(--text-main); font-weight:bold;">172.5%</td>\n                                <td data-label="單日增減" style="color:var(--up-color); font-weight:bold;">+0.8%</td>\n                                <td data-label="狀態"><span style="background:var(--up-bg); color:var(--up-color); padding: 4px 8px; border-radius: 4px; font-size: 11px; border: 1px solid rgba(34,197,94,0.2);">✅ 安全健康</span></td>'
        )
        
    # 3. Update Paper Portfolio Table with data-labels in JS
    old_tr = '''<td style="font-weight:700;">${symbol}</td>
                    <td>$${cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                    <td>${qty}</td>
                    <td>${priceFormatted}</td>
                    <td style="font-weight:600;">${formattedVal}</td>
                    <td class="${plClass}" style="font-weight:600;">${formattedPl} (${formattedRoi})</td>
                    <td>
                        <button class="portfolio-btn" onclick="editPortfolioItem('${symbol}')">✏️</button>
                        <button class="portfolio-btn danger" onclick="clearPortfolioFromTab('${symbol}', '${category}')">🗑️</button>
                    </td>'''
                    
    # Using regex to capture the exact block since the buttons might have different text (edit/delete vs Chinese)
    js_tr_pattern = re.compile(r'<td style="font-weight:700;">\$\{symbol\}</td>.*?</td>', re.DOTALL)
    
    new_tr = '''<td data-label="標的" style="font-weight:700;">${symbol}</td>
                    <td data-label="買入成本">$${cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                    <td data-label="持股數">${qty}</td>
                    <td data-label="當前市價">${priceFormatted}</td>
                    <td data-label="總市值" style="font-weight:600;">${formattedVal}</td>
                    <td data-label="盈虧 / 報酬率" class="${plClass}" style="font-weight:600;">${formattedPl} (${formattedRoi})</td>
                    <td data-label="操作">
                        <button class="portfolio-btn" onclick="editPortfolioItem('${symbol}')">✏️ 編輯</button>
                        <button class="portfolio-btn danger" onclick="clearPortfolioFromTab('${symbol}')">🗑️ 移除</button>
                    </td>'''
                    
    text = js_tr_pattern.sub(new_tr, text)
    
    # 4. Remove empty portfolio message spanning all columns (make it 1 td, no colspan needed if it's block on mobile, but colspan=7 is fine if thead is hidden)
    # Actually just add data-label so it doesn't break
    
    with open('finance.html', 'w', encoding='utf-8') as f:
        f.write(text)
        
    print("CSS and data-label updates applied successfully.")

if __name__ == '__main__':
    main()
