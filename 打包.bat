@echo off
setlocal enabledelayedexpansion

rem ===========================================================================
rem  打包.bat —— 一键把 DSH-PET-AGENT 打成安装版 exe
rem
rem  用法：
rem    双击                    跑前置闸 + 打包
rem    打包.bat fast           跳过前置闸直接打包（快，但风险自负）
rem    打包.bat clean          只清理中间产物（packaging\staging，约 300 MB），不打包
rem    打包.bat fast clean     跳闸 + 打包 + 打包完自动清理
rem
rem  等价于手动跑这三条：
rem    .\scripts\check-assets.ps1     素材齐备 + 640x360/alpha + 锚点契约
rem    pnpm verify:shell              外壳 11 道闸
rem    .\scripts\pack-exe.ps1         tsc -> staging -> electron-builder
rem
rem  产物（dist\）：
rem    DSH-PET-<版本>-setup.exe   NSIS 安装版（装到 %LOCALAPPDATA%\Programs，免管理员）
rem    win-unpacked\DSH-PET.exe   免解包直跑，适合绿色部署
rem    SHA256SUMS.txt             两个产物的 sha256
rem
rem  ---------------------------------------------------------------------------
rem  为什么要先跑那两道闸：
rem    * check-assets.ps1 —— 素材缺了照样能打包成功，装出来才发现宠物是空白；
rem    * verify:shell      —— 里面的 build-desktop-core --check 会比对 shell\ 产物，
rem      改了 shell\ 却忘了 pnpm build:desktop-core 时，包里就是**旧外壳**。
rem  两道闸任一失败都会中止；确实要跳过就加 fast 参数。
rem
rem  ---------------------------------------------------------------------------
rem  编码：本文件必须存成 GBK（cp936，无 BOM），且【不要】在里面写 chcp。
rem     * 存成 UTF-8 会让 cmd 按 GBK 误读多字节，把后面的行切错；
rem     * 写 chcp 65001 更糟：中途换代码页会让批处理字节偏移错位，整份文件解析乱。
rem ===========================================================================

set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"

rem 仓库位置：默认就是本文件所在目录（打包.bat 应放在仓库根）；可用环境变量覆盖
set "REPO=%HERE%"
if defined DSH_PET_REPO set "REPO=%DSH_PET_REPO%"

rem 第 1 个参数 fast / --skip-gates 跳过前置闸
set "SKIP="
set "CLEAN="
set "ONLYCLEAN="
if /i "%~1"=="fast" set "SKIP=1"
if /i "%~1"=="--skip-gates" set "SKIP=1"
if /i "%~1"=="clean" set "ONLYCLEAN=1"
if /i "%~2"=="clean" set "CLEAN=1"

echo.
echo ============================================================
echo   打包 DSH-PET-AGENT
echo ============================================================
echo   仓库：%REPO%
if defined SKIP echo   模式：fast（跳过前置闸）
echo.

rem --- 0. 前置检查 ---
if not exist "%REPO%\scripts\pack-exe.ps1" (
  echo [错误] 找不到 %REPO%\scripts\pack-exe.ps1
  echo        本文件要放在仓库根目录；放在别处时先设环境变量 DSH_PET_REPO。
  echo.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] PATH 里找不到 node（需要 Node.js ^>= 22.19）。
  echo.
  pause
  exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [错误] PATH 里找不到 pnpm（需要 pnpm ^>= 10）。
  echo.
  pause
  exit /b 1
)

if not exist "%REPO%\node_modules\.bin\electron-builder.cmd" (
  echo [错误] 依赖没装全：缺 node_modules\.bin\electron-builder.cmd
  echo        先在仓库根跑一次 pnpm install。
  echo.
  pause
  exit /b 1
)

rem --- 只清理模式：打包.bat clean ---
if defined ONLYCLEAN (
  echo ------------------------------------------------------------
  echo 清理中间产物
  echo ------------------------------------------------------------
  if exist "%REPO%\packaging\staging" rmdir /s /q "%REPO%\packaging\staging"
  if exist "%REPO%\packaging\staging-install" rmdir /s /q "%REPO%\packaging\staging-install"
  echo   已清理 packaging\staging 与 packaging\staging-install（不存在的自动跳过）
  echo.
  echo 完成。dist\ 里的产物没动。
  echo.
  pause
  exit /b 0
)

if not defined SKIP (
  echo ------------------------------------------------------------
  echo [1/3] 素材验收
  echo ------------------------------------------------------------
  powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO%\scripts\check-assets.ps1"
  if errorlevel 1 (
    echo.
    echo [错误] 素材验收未通过，已中止。
    echo        确实要带着缺口打包，加 fast 参数重跑。
    echo.
    pause
    exit /b 1
  )

  echo.
  echo ------------------------------------------------------------
  echo [2/3] 外壳闸（11 道，防 shell\ 改了没重建产物）
  echo ------------------------------------------------------------
  pushd "%REPO%"
  call pnpm verify:shell
  set "VS=!ERRORLEVEL!"
  popd
  if not "!VS!"=="0" (
    echo.
    echo [错误] verify:shell 未通过，已中止。
    echo        确实要带着缺口打包，加 fast 参数重跑。
    echo.
    pause
    exit /b 1
  )
) else (
  echo [1/3] 已跳过素材验收
  echo [2/3] 已跳过外壳闸
)

rem --- 3. 打包 ---
echo.
echo ------------------------------------------------------------
echo [3/3] 打包（tsc -^> staging -^> electron-builder）
echo ------------------------------------------------------------
echo   首次会从 npmmirror 下打包二进制，并组装约 260 MB 的 app，请耐心等。
echo.
set "PACKARG="
if defined CLEAN set "PACKARG=-Clean"
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO%\scripts\pack-exe.ps1" %PACKARG%
set "RC=!ERRORLEVEL!"

echo.
if "!RC!"=="0" (
  echo ============================================================
  echo   打包完成。产物在 %REPO%\dist\
  echo ============================================================
  dir /b "%REPO%\dist\*.exe" 2>nul
  echo   win-unpacked\        （免解包直跑）
  echo   SHA256SUMS.txt
) else (
  echo ============================================================
  echo   打包失败（exit !RC!）—— 看上面的报错。
  echo ============================================================
)
echo.
pause
exit /b !RC!
