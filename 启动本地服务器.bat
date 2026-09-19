@echo off
chcp 65001 >nul
title 提瓦特档案 · 本地预览服务器
cd /d "%~dp0"

echo ==========================================================
echo   提瓦特档案 · 原神资料站 —— 本地预览
echo   浏览器访问 http://localhost:8080/index.html
echo   关闭本窗口即可停止服务器
echo ==========================================================
echo.

where python >nul 2>nul
if %errorlevel%==0 (
    echo [信息] 使用 Python 启动静态服务器...
    start "" "http://localhost:8080/index.html"
    python -m http.server 8080
    goto :end
)

where py >nul 2>nul
if %errorlevel%==0 (
    echo [信息] 使用 Python Launcher 启动静态服务器...
    start "" "http://localhost:8080/index.html"
    py -m http.server 8080
    goto :end
)

where npx >nul 2>nul
if %errorlevel%==0 (
    echo [信息] 未检测到 Python，改用 npx serve 启动...
    start "" "http://localhost:3000"
    npx --yes serve . -l 3000
    goto :end
)

echo [提示] 未检测到 Python 或 Node.js。
echo        可以直接双击 index.html 打开本站；
echo        若浏览器在 file:// 下禁用了 localStorage，本地数据将无法持久化保存。
pause

:end
