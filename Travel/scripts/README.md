# 資料更新腳本

網站平常不需要執行這些腳本。只有想更新內建資料時才用（需要 Python 3）。

| 腳本 | 產生 | 說明 |
| --- | --- | --- |
| `build_countries.py` | `site/js/countries-data.js` | 全球國家清單（國碼、貨幣、首都時區與座標） |
| `scrape_boca.py` | `boca.json` | 外交部領事事務局各國駐館資訊、治安、醫療 |
| `scrape_cn.py` | `cn.json` | 中華人民共和國外交部駐外使領館地址電話 |
| `build_emergency.py` | `site/js/emergency-data.js` | 合併上面兩份資料並定位館處 |

更新緊急資訊（約 15 分鐘，抓取時每秒 1～2 次，請勿調快）：

1. 下載 `https://www.taiwanembassy.org/embassy.json` 放在同一個資料夾。
2. 依序執行 `python scrape_boca.py`、`python scrape_cn.py`、`python build_emergency.py`。
3. `build_emergency.py` 需要 `rc.json`（world-countries 資料）與 `countries_rows.json`（`build_countries.py` 產生），路徑在腳本開頭可以調整。
4. 更新後把 `site/index.html` 裡的版本號（`?v=…`）改一下，各裝置就會讀到新資料。
