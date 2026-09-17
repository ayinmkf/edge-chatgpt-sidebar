@echo off
chcp 65001 >nul
title 安装 / 更新 ChatGPT 侧边栏扩展
echo.
echo ============================================================
echo   ChatGPT 侧边栏 —— 安装 / 更新
echo ============================================================
echo.
echo  接下来会用 Edge 打开扩展管理页。请完成以下三步：
echo.
echo    1) 找到「ChatGPT 侧边栏」这一项，点它的【重新加载】按钮
echo       （如果没看到这一项，点【加载解压缩的扩展】并选择：）
echo       D:\deepseek work\edge-chatgpt-sidebar
echo.
echo    2) 回到侧边栏：先关掉侧边栏，再重新打开
echo       （默认是内嵌 ChatGPT；顶部设置菜单底部应显示 v0.3.2）
echo.
echo    3) 刷新来源网页和已有 ChatGPT 标签页，使新脚本生效
echo.
echo ------------------------------------------------------------
pause

start "" msedge.exe "edge://extensions/"

echo.
echo 已打开扩展管理页。完成三步后，选中文字并点击“问 ChatGPT”测试。
echo.
pause
