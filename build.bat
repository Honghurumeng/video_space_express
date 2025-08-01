@echo off
REM Video Space 本地构建脚本 (Windows)
REM 支持 Windows 本地构建

echo 🚀 Video Space 本地构建脚本
echo ==============================

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js 未安装，请先安装 Node.js 18+
    pause
    exit /b 1
)

REM 检查 npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm 未安装，请先安装 npm
    pause
    exit /b 1
)

REM 检查 Rust
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Rust 未安装，请先安装 Rust
    echo    访问 https://rustup.rs/ 获取安装说明
    pause
    exit /b 1
)

REM 检查 Tauri CLI
cargo tauri --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Tauri CLI 未安装，正在安装...
    cargo install tauri-cli --version "^2.0"
)

echo ✅ 环境检查通过
echo    Node.js 版本: 
node --version
echo    npm 版本: 
npm --version
echo    Rust 版本: 
rustc --version

REM 安装前端依赖
echo 📦 安装前端依赖...
npm install

REM 构建类型选择
set BUILD_TYPE=%1
if "%BUILD_TYPE%"=="" set BUILD_TYPE=dev

if "%BUILD_TYPE%"=="dev" (
    echo 🔧 启动开发环境...
    echo    请在另一个终端中运行: npm run dev
    echo    然后运行: npm run tauri:dev
    echo    或者直接运行: npm run tauri:dev (会自动启动前端)
    goto end
)

if "%BUILD_TYPE%"=="build" (
    echo 🏗️  开始构建生产版本...
    npm run tauri build
    goto end
)

if "%BUILD_TYPE%"=="clean" (
    echo 🧹 清理构建缓存...
    cargo clean
    npm run tauri clean
    goto end
)

if "%BUILD_TYPE%"=="info" (
    echo ℹ️  显示项目信息...
    npm run tauri info
    goto end
)

echo ❌ 无效的构建类型: %BUILD_TYPE%
echo 用法: %~n0 [dev^|build^|clean^|info]
echo.
echo   dev   - 启动开发环境
echo   build - 构建生产版本
echo   clean - 清理构建缓存
echo   info  - 显示项目信息
pause
exit /b 1

:end
echo ✅ 完成!
pause