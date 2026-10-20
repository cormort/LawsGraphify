#!/bin/bash
# Weekly law refresh run on this Mac. law.dgbas.gov.tw answers GitHub's servers
# with 403, so the 行政規則 are fetched here; the GitHub Action keeps covering MOJ.
#
#   ./update_local.sh            # run once now
#   ./update_local.sh --install  # schedule it weekly (Monday 10:00) with launchd
#   ./update_local.sh --uninstall
set -euo pipefail
cd "$(dirname "$0")"

LABEL="com.$(whoami).lawsgraphify-update"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/lawsgraphify-update.log"

if [[ "${1:-}" == "--install" ]]; then
    # A python3 that has PyYAML; launchd gets this directory first on PATH
    for py in $(which -a python3); do
        if "$py" -c "import yaml, pytest" 2>/dev/null; then PYDIR="$(dirname "$py")"; break; fi
    done
    [[ -n "${PYDIR:-}" ]] || { echo "No python3 with pyyaml + pytest found (pip install pyyaml pytest)"; exit 1; }
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key><array><string>$PWD/update_local.sh</string></array>
    <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PYDIR:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
    <!-- Monday 10:00; a run missed while asleep happens on wake -->
    <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
    <key>StandardOutPath</key><string>$LOG</string>
    <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed $PLIST (python: $PYDIR/python3, log: $LOG)"
    exit 0
fi
if [[ "${1:-}" == "--uninstall" ]]; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed $LABEL"
    exit 0
fi

notify() { osascript -e "display notification \"$1\" with title \"隨身法典資料更新\"" 2>/dev/null || true; }
trap 'notify "更新失敗，請看 ~/Library/Logs/lawsgraphify-update.log"' ERR

echo "=== $(date '+%F %T') ==="
# Never touch work in progress
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Working tree has uncommitted changes; skipping this run."
    notify "略過：專案有未提交的修改"
    exit 0
fi

git pull -q --ff-only
python3 src/fetch_laws.py --refresh
python3 src/graph_builder.py
python3 -m pytest -q

git add data/laws_json
if git diff --cached --quiet -- data/laws_json; then
    echo "法規條文沒有變動。"
    git reset -q && git checkout -q -- data web  # drop the rebuilt date-only changes
    exit 0
fi
git diff --cached --stat -- data/laws_json
git add data web/laws_graph.json
git commit -q -m "法規資料自動更新（本機）$(date +%F)"
git push -q
notify "法規有更新，已推送並部署"
echo "Pushed."
