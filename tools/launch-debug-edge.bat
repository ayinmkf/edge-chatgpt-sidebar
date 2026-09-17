@echo off
rem ============================================================
rem  ChatGPT 侧边栏 —— 以「非管理员 + 调试端口」启动 Edge
rem ============================================================
rem  用法（推荐）：直接双击本文件，或在普通（非管理员）cmd 里运行。
rem  结果会写到同目录的 launch-result.txt，便于反馈。
rem ============================================================
chcp 65001 >nul
setlocal enabledelayedexpansion
set "LOGFILE=%~dp0launch-result.txt"
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
set "PORT=9333"

echo ============================================================ > "%LOGFILE%"
echo 启动时间: %DATE% %TIME% >> "%LOGFILE%"

rem ---- 1. 是否管理员 ----
net session >nul 2>&1
if %errorlevel%==0 (
  echo [警告] 当前是管理员权限运行。Edge 在管理员下会自行降权重启并丢弃调试参数。 >> "%LOGFILE%"
  echo [警告] 请改用「双击」方式运行本文件（不要右键以管理员身份运行）。 >> "%LOGFILE%"
  echo.
  echo  [警告] 检测到管理员权限，可能失败。请关闭本窗口，改为「双击」本文件。
  echo.
) else (
  echo [OK] 非管理员权限运行 >> "%LOGFILE%"
)

rem ---- 2. 关掉现有 Edge（含启动增强预启动的隐藏进程）----
echo 正在关闭所有 Edge 进程... >> "%LOGFILE%"
taskkill /F /IM msedge.exe >nul 2>&1
timeout /t 5 /nobreak >nul

rem ---- 3. 启动（不带 --restore-last-session，减少变量）----
echo 启动 Edge: --remote-debugging-port=%PORT% --profile-directory=Default >> "%LOGFILE%"
start "" "%EDGE%" --remote-debugging-port=%PORT% --profile-directory=Default

rem ---- 4. 轮询端口 ----
echo 等待端口就绪（最多 60 秒）... >> "%LOGFILE%"
set READY=0
for /L %%i in (1,1,60) do (
  if "!READY!"=="0" (
    powershell -NoProfile -Command "try { $r = Invoke-RestMethod 'http://127.0.0.1:%PORT%/json/version' -TimeoutSec 2; if ($r.Browser) { exit 0 } } catch {}; exit 1" >nul 2>&1
    if "!errorlevel!"=="0" (
      set READY=1
      echo [成功] 第 %%i 秒端口就绪 >> "%LOGFILE%"
    ) else (
      timeout /t 1 /nobreak >nul
    )
  )
)

rem ---- 5. 记录现场 ----
if "!READY!"=="1" (
  powershell -NoProfile -Command "try { $r = Invoke-RestMethod 'http://127.0.0.1:%PORT%/json/version' -TimeoutSec 3; '浏览器: ' + $r.Browser | Out-File -Append -Encoding utf8 '%LOGFILE%' } catch {}" >nul 2>&1
  echo. >> "%LOGFILE%"
  echo 结果: 成功，调试端口 %PORT% 已就绪 >> "%LOGFILE%"
) else (
  echo 结果: 失败，60 秒内端口未就绪 >> "%LOGFILE%"
)

powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.CommandLine } | Out-File -Append -Encoding utf8 '%LOGFILE%'" >nul 2>&1

echo.
if "!READY!"=="1" (
  echo   [成功] 调试端口 %PORT% 已就绪。
  echo   结果已写入: %LOGFILE%
  echo   请回到对话里告诉我「好了」，并保持这个 Edge 窗口开着。
) else (
  echo   [失败] 端口没起来。结果已写入: %LOGFILE%
  echo   请把这个文件内容发给我。
)
echo.
echo （本窗口可以关闭，Edge 会继续运行）
pause
