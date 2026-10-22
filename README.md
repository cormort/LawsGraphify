# LawsGraphify：法規引用查詢

**線上版：<https://cormort.github.io/LawsGraphify/>**

歲計會計的隨身法典，**手機可離線使用**：用手機瀏覽器打開網址，選「加入主畫面」（iPhone：分享 → 加入主畫面；Android：選單 → 安裝應用程式）。開過一次後，網頁與全部條文都存在手機上，沒有網路也能查；有網路時會在背景更新。

- **法規清單**：首頁依憲法與法律、命令、特種基金、行政規則分組，另有收藏（☆，整部法規或個別條文皆可，依法規分組）與最近查看，存在手機本機；收藏可「匯出」成一段文字保存，換手機或資料被清除時「匯入」貼回。
- **基金收支保管規定專區**：頂端「收支辦法」分頁（與「隨身法典」並列，或首頁「基金收支保管規定專區」、搜尋「基金」）列出全部特種基金規定，專區搜尋框打字即依名稱篩選清單，按「搜尋」則只在基金規定中搜尋條文（「基金 用途 -信託」）；基金簡稱可直接查（「住宅基金」「住宅基金 用途」「醫療藥品基金第3條」），並有來源、用途、賸餘等常用主題。基金規定的全文頁上方有概要（主管機關、跳到來源／用途／保管／預算決算／會計／賸餘／結束），每條標示「本基金特有」或「與 N 個基金相同」，可勾選只看本基金特有的條文；基金條文頁標示這條是通用規定（「另有 N 個基金有相同規定」）還是本基金特有，並列出其他基金最相近的 5 條與相似度。
- **廢止法規專區**：首頁「廢止法規專區」（或搜尋「廢止專區」）收錄已廢止的特種基金收支保管及運用辦法，依廢止日期排列、可在其中搜尋，條文頁標示廢止日期；一般搜尋與「被引用」不含廢止規定。收錄的法規日後被廢止，也會自動移到這裡。
- **關鍵字搜尋**：輸入不是法規名稱就搜全部條文；空格為 AND、`-詞` 排除，「台」「臺」通用；「預算法 流用」只搜一部法規。
- **字體與深色模式**：A−／A＋ 調整字體，◐ 切換深淺色，設定會記住。
- **朗讀**：每條條文旁的「朗讀」用手機或電腦內建的中文語音唸出條文，再按一次（「停止」）停止；在法規全文中會從該條一路往下唸（只唸目前顯示的條文），唸到的條文標底色並自動捲到；標題旁「朗讀全文」從第一條開始唸；頂端 🔊 1× 切換朗讀速度（0.75～2 倍，唸到一半也可以換，下一句起生效），設定會記住。
- **全文瀏覽**：輸入法規名稱看全文，標題下列出發布日與最新修正日；條文裡的「第X條」「前條」「預算法第六十二條」都可以點擊跳轉；每條標示被幾條條文引用，可只看被引用的條文；右側捲動條顯示目前條次與章名，拖曳可快速切換；條文中的附件檔名連到主計總處原文頁；點連結跳到其他條文後，左下角「← 原條文」一鍵回到原本閱讀的位置；網站改版後，開啟時上方會提示「網站已更新」，點「重新載入」即換成新版；搜尋結果、被引用清單與法規全文可「匯出」成 Excel 可開的 CSV（法規、條次、條文、連結）；下載法規更新時會比對出修正的條文，標「新修正」並列在首頁。
- **反向查詢**：加上條號，列出所有引用它的條文，引用處高亮；從搜尋結果點進條文時，關鍵字也會標出；每條條文旁都有「複製」，複製成「預算法第62條之1：條文」的引用格式；用於修法衝擊分析（「預算法第 62 條要修，哪些辦法、要點引用到它？」）與找出失效的引用。

收錄範圍是歲計、會計相關法規（約 60 部），加上現行全部特種基金收支保管及運用辦法（82 部；每次更新自動加入新設、移除已廢止的），以及由法律直接規範的軍事教育、國立大學校務、國民年金保險三個基金的法律與管理辦法（6 部）：法律與命令來自[法務部全國法規資料庫](https://law.moj.gov.tw/)開放資料，
要點、注意事項等行政規則來自[行政院主計總處主管法規共用系統](https://law.dgbas.gov.tw/)。
沒有條文可收錄的（主計總處只放附件的日支數額表等，以及行政院、人事總處、立法院發布、列在 `config/law_aliases.yaml` 的 `links` 的），首頁列為「沒有收錄條文，連到原文」。
引用關係由程式自動解析，可能有誤，正式用途請以法規原文為準。

核心是一個純函式的引用解析器：支援全形轉換、中文數字、別名與「以下簡稱」、作用域延續（遇句號、「本法／本要點」重設）、
範圍與並列展開、前條／次條、之N 子條文、「第X點」，以及信心度與需複核旗標。

## 專案結構

```text
LawsGraphify/
├── config/law_aliases.yaml     # 法規名稱 → 代碼；external 清單為只被引用、不抓全文的法規
├── src/
│   ├── citation_resolver.py    # 引用解析器
│   ├── fetch_laws.py           # 抓法規全文（法務部 → 主計總處）
│   └── graph_builder.py        # 解析全部條文，產生 laws_graph.json
├── data/laws_json/             # 各法規條文（fetch_laws.py 產生）
├── web/
│   ├── index.html              # 隨身法典（查詢、全文、搜尋）
│   ├── sw.js, manifest.webmanifest, icon-*.png  # 離線與加入主畫面
│   ├── graph.html, app.js      # 關聯圖
│   └── laws_graph.json         # 圖譜資料
├── tests/test_citation_resolver.py
└── run_server.py               # 本機預覽：python3 run_server.py
```

### 自動更新與部署（GitHub Actions）

[`.github/workflows/update.yml`](.github/workflows/update.yml)：

- **每週一 02:00（台灣時間）**：重新下載法務部資料 → 重建圖譜 → 跑測試 →
  **只有條文真的變動才 commit** → 部署到 GitHub Pages。測試沒過就不部署。
- **部署前測試**：每次部署前先跑全部測試，包括以瀏覽器實測查詢頁的 `tests/test_web.py`（排版不漏字、引用不斷、搜尋、收藏、更新比對、附件連結），沒通過就不部署。本機沒裝 Playwright 時這組測試會略過。
- **主計總處的行政規則由本機更新**：law.dgbas.gov.tw 會以 403 擋掉 GitHub 的主機，所以改由一台 Mac
  每週一 10:00 執行 [`update_local.sh`](update_local.sh)（launchd 排程；錯過時間會在喚醒後補跑）：
  抓兩個來源、重建、測試，條文有變才推送，推送後由 Actions 部署。專案有未提交的修改時會跳過，
  失敗時跳出 macOS 通知，紀錄在 `~/Library/Logs/lawsgraphify-update.log`。

  ```bash
  ./update_local.sh --install    # 安裝每週排程（--uninstall 移除；不帶參數＝立即跑一次）
  ```
- **push 到 main**：直接部署 `web/`。
- 也可以在 GitHub 的 Actions 頁籤按「Run workflow」立即更新。
- 主計總處某部抓不到時沿用舊條文並顯示警告；GitHub 排程失敗時會寄信通知。
- **通知**：Mac mini 的排程透過 Hermes 傳 Telegram（失敗、部分失敗、有更新、跳過；沒變動不通知）。
- **看門狗**（[`watchdog.yml`](.github/workflows/watchdog.yml)，每天 12:00）：每次排程跑完都會強制推送一個
  `heartbeat` 分支（只有一個 commit，不影響 main）；tw-county-map 超過 30 小時、本 repo 超過 8 天沒回報，
  或上次回報是失敗，這個 workflow 就會失敗並由 GitHub 寄信——涵蓋 Mac mini 關機、斷網、排程沒載入。

**年度法規自動換新**：`config/law_aliases.yaml` 裡帶年度的法規把年度寫成「○」（例如「中華民國○年度總決算編製要點」），
抓取時自動取最新年度的版本，舊年度檔案自動移除，代碼不變（收藏照舊）。Mac mini 每月第一次排程會重建主計總處的法規索引，
新年度版本發布後一個月內會被抓到；要立刻更新，在 Mac 上執行 `python3 src/fetch_laws.py --refresh --recrawl` 後照常建置。

---

## 快速開始

### 1. 環境準備

本解析器需要 `PyYAML` 套件來讀取設定檔：

```bash
pip install pyyaml pytest
```

### 2. 使用範例

```python
from src.citation_resolver import parse_citations

# 模擬在《決算法》(SETTLE) 第 10 條的內文中，解析以下參考文獻：
text = "依預算法第六十條及第六十二條規定，並依會計法第二十一條及第六十條辦理"
edges = parse_citations(text, current_law_code="SETTLE", current_article_no="0010")

for edge in edges:
    print(edge)
```

**輸出結果（JSON/Dict 陣列）**：

```python
[
    # "預算法第六十條" -> 跨法規明確命中，信心度 1.0
    {
        'source': 'SETTLE-0010',
        'target': 'BUDGET-0060',
        'kind': 'absolute',
        'is_external': True,
        'external': True,
        'sub_ref': None,
        'confidence': 1.0,
        'needs_review': False
    },
    # "及第六十二條" -> 繼承前者的預算法 (BUDGET)，屬並列展開，信心度 0.9
    {
        'source': 'SETTLE-0010',
        'target': 'BUDGET-0062',
        'kind': 'absolute',
        'is_external': True,
        'external': True,
        'sub_ref': None,
        'confidence': 0.9,
        'needs_review': False
    },
    # "會計法第二十一條" -> 跨法規明確命中，信心度 1.0
    {
        'source': 'SETTLE-0010',
        'target': 'ACCOUNT-0021',
        'kind': 'absolute',
        'is_external': True,
        'external': True,
        'sub_ref': None,
        'confidence': 1.0,
        'needs_review': False
    },
    # "及第六十條" -> 繼承前者的會計法 (ACCOUNT)，屬並列展開，信心度 0.9
    {
        'source': 'SETTLE-0010',
        'target': 'ACCOUNT-0060',
        'kind': 'absolute',
        'is_external': True,
        'external': True,
        'sub_ref': None,
        'confidence': 0.9,
        'needs_review': False
    }
]
```

---

### 3. 更新法規資料與圖譜

```bash
python3 src/fetch_laws.py            # 用本機快取的法務部資料（chlaw.json / chorder.json）
python3 src/fetch_laws.py --refresh  # 重新下載法務部資料
python3 src/fetch_laws.py --recrawl  # 另外重建主計總處的法規索引（有新行政規則時）
python3 src/graph_builder.py         # 重建 data/ 與 web/ 的 laws_graph.json
```

- 主計總處的行政規則每次都重抓；某一部抓不到（網路、機器人驗證）就沿用上次的條文，不會清掉資料。
- 先從法務部全國法規資料庫（法律、命令）找，找不到的行政規則（要點、注意事項…）再到主計總處主管法規共用系統（law.dgbas.gov.tw）的歲計、會計分類抓，每次請求間隔 1 秒。
- `config/law_aliases.yaml` 的 `external` 清單裡的法規只當被引用對象，不抓全文。
- 行政規則以「點」編號，存成 `第 N 點`；「第X點」的引用和「第X條」一樣解析（前面沒緊接法規名稱時，指向本文件）。

## 核心 API 簽名與參數說明

### `parse_citations(text, current_law_code, current_article_no=None, article_order=None)`

#### 參數

*   `text` (str): 要解析的輸入字串，包含法條交叉引用。
*   `current_law_code` (str): 當前法規的標準大寫代碼 (例如 `"BUDGET"`, `"ACCOUNT"`)。
*   `current_article_no` (int | str | None): 當前所在的法條條號 (例如 `62`, `"62-001"`, `"六十二之一"`)，用於計算相對引用（如「前條」）。

#### 回傳值

回傳 `list[dict]`。每個 dictionary 代表一條產生的引用關係邊 (Edge)，包含以下欄位：

| 欄位名稱 | 型態 | 說明 |
| :--- | :--- | :--- |
| `source` | str | 來源節點 ID，格式為 `{當前法規代碼}-{當前條號補零4位}[-{之N補零3位}]`。 |
| `target` | str \| None | 目標節點 ID，格式為 `{目標法規代碼}-{目標條號補零4位}[-{之N補零3位}]`。若無法對應或未命中法規，則為 `None`。 |
| `kind` | str | 引用類型。`"absolute"`（絕對引用，如第十條）或 `"relative"`（相對引用，如前條）。 |
| `is_external` / `external` | bool | 是否為跨法規引用。若目標法規代碼與當前不同，或目標相同但字面上顯式提到了該法規名稱 (例如在會計法中寫「會計法第二十一條」)，則為 `True`；純內部引用 (如「第十條」) 則為 `False`。 |
| `sub_ref` | str \| None | 條級別以下的細部引用內容（如項、款、目，例如 `"第二項"`、`"第一款第一目"`），未指定時為 `None`。 |
| `confidence` | float | 解析信心度（0.0 至 1.0）。 |
| `needs_review` | bool | 是否需要人工複核。 |

---

## 信心度與需複核旗標規則表

解析器依據以下規則計算 `confidence` 及 `needs_review`：

| 引用情境 | 信心度 (`confidence`) | 需複核 (`needs_review`) | 說明 |
| :--- | :--- | :--- | :--- |
| **跨法規明確命中** | `1.0` | `False` | 顯式提及法規名稱，且該名稱存在於 `law_aliases.yaml` 中。 |
| **本法絕對引用** | `0.95` | `False` | 未指定法規名稱的絕對條號引用（如「第十條」）。 |
| **範圍 / 並列展開** | `0.9` | `False` | 範圍（至）或並列清單（及、、）所展開的子引用項目。 |
| **相對引用 (可計算)** | `1.0` | `False` | 可推算出來的相對條次（如「前條」、「次條」、「前二條」）。 |
| **子條文往後的相對引用** | `0.7` | `True` | 如第六十二條之一的「次條」，可能是之二或第六十三條，暫取第六十三條。 |
| **相對引用超出範圍** | `0.3` | `True` | 推算結果小於等於 0，或大於該法規在系統中註記的最大條數。 |
| **疑似法規名但未命中** | `0.0` | `True` | 偵測到疑似法規名稱 (以法/辦法/條例等結尾)，但不在 `law_aliases.yaml` 內。此時 `target` 為 `None`。 |

---

## 如何更新 Law Alias Map

法規名稱與代碼的映射定義在 [config/law_aliases.yaml](config/law_aliases.yaml) 檔案中。

### 格式說明

設定檔支援兩種結構，解析器在載入時會自動進行建立雙向映射：

1.  **鍵值對映射 (單一別名)**：
    ```yaml
    aliases:
      憲法: CONST
      預算法: BUDGET
    ```
2.  **清單對照 (多個別名映射至同一個代碼)**：
    ```yaml
    aliases:
      BUDGET:
        - 預算法
        - 預算規程
    ```

若要新增法規：
1. 開啟 `config/law_aliases.yaml`。
2. 採用**大寫英文縮寫**做為唯一的法規代碼。
3. 將對應的中文全稱或簡稱加入對照。
4. 儲存檔案即可，解析器在下次呼叫時會自動載入最新別名。
