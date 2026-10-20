#!/bin/bash

# 切換工作目錄到此 .command 檔案所在的資料夾 (macOS Finder 點擊預設會是 Home 目錄)
cd "$(dirname "$0")"

echo "=========================================================="
echo "    Laws Graphify - 啟動本機法規知識圖譜服務"
echo "=========================================================="
echo ""
echo "[1/2] 正在偵測 Python 環境..."

# 檢查 python3 是否存在
if ! command -v python3 &> /dev/null
then
    echo "錯誤: 偵測不到 python3 指令。請確保系統已安裝 Python 3.12+。"
    echo "按任意鍵關閉此視窗..."
    read -n 1
    exit 1
fi

echo " -> Python 偵測成功: $(python3 --version)"
echo ""
echo "[2/2] 正在啟動本機網頁伺服器並開啟瀏覽器..."
echo "----------------------------------------------------------"

# 執行 Python 伺服器啟動器
python3 run_server.py

# 如果伺服器異常關閉，暫停視窗讓使用者看得到 Log 錯誤
echo "----------------------------------------------------------"
echo "伺服器已停止。"
echo "按任意鍵關閉此視窗..."
read -n 1
