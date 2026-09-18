@echo off
setlocal
for %%I in ("%~dp0..") do set "CGPT_PROJECT_DIR=%%~fI"
chcp 65001 >nul
title 安装 / 更新 ChatGPT 侧边栏扩展
echo.
echo ============================================================
echo   ChatGPT 侧边栏 —— 安装 / 更新
echo ============================================================
echo.
echo  接下来会打开 Edge 或 Chrome 的扩展管理页。请完成以下三步：
echo.
echo    1) 找到「ChatGPT 侧边栏」这一项，点它的【重新加载】按钮
echo       （如果没看到这一项，点【加载解压缩的扩展】并选择：）
echo       "%CGPT_PROJECT_DIR%"
echo.
echo    2) 回到侧边栏：先关掉侧边栏，再重新打开
echo       （默认是内嵌 ChatGPT；顶部设置菜单底部应显示 v0.4.0）
echo.
echo    3) 刷新来源网页和已有 ChatGPT 标签页，使新脚本生效
echo.
echo ------------------------------------------------------------
pause

set "EDGE_EXE="
set "CHROME_EXE="
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

if defined EDGE_EXE if defined CHROME_EXE goto choose_browser
if defined EDGE_EXE goto open_edge
if defined CHROME_EXE goto open_chrome
goto browser_missing

:choose_browser
choice /C EC /N /M "请选择浏览器：[E] Edge  [C] Chrome："
if errorlevel 2 goto open_chrome
goto open_edge

:open_edge
start "" "%EDGE_EXE%" "edge://extensions/"
goto browser_opened

:open_chrome
start "" "%CHROME_EXE%" "chrome://extensions/"
goto browser_opened

:browser_missing
echo.
echo 未找到 Edge 或 Chrome。请手动打开浏览器扩展管理页：
echo Edge: edge://extensions/
echo Chrome: chrome://extensions/
goto done

:browser_opened

echo.
echo 已打开扩展管理页。完成三步后，选中文字并点击“问 ChatGPT”测试。
echo.
:done
pause
