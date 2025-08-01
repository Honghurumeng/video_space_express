#!/bin/bash

# Video Space 本地构建脚本
# 支持 Windows 和 macOS 本地构建

set -e

echo "🚀 Video Space 本地构建脚本"
echo "=============================="

# 检查操作系统
OS="$(uname -s)"
case "${OS}" in
  Linux*)     OS_LINUX=1 ;;
  Darwin*)    OS_MAC=1 ;;
  CYGWIN*)    OS_WINDOWS=1 ;;
  MINGW*)     OS_WINDOWS=1 ;;
  MSYS_NT*)   OS_WINDOWS=1 ;;
  *)          echo "不支持的操作系统: ${OS}"; exit 1 ;;
esac

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请先安装 Node.js 18+"
    exit 1
fi

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm 未安装，请先安装 npm"
    exit 1
fi

# 检查 Rust
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust 未安装，请先安装 Rust"
    echo "   访问 https://rustup.rs/ 获取安装说明"
    exit 1
fi

# 检查 Tauri CLI
if ! cargo tauri --version &> /dev/null; then
    echo "❌ Tauri CLI 未安装，正在安装..."
    cargo install tauri-cli --version "^2.0"
fi

echo "✅ 环境检查通过"
echo "   Node.js 版本: $(node --version)"
echo "   npm 版本: $(npm --version)"
echo "   Rust 版本: $(rustc --version)"

# 安装前端依赖
echo "📦 安装前端依赖..."
npm install

# macOS 特殊依赖
if [ "${OS_MAC}" ]; then
    echo "🍎 检查 macOS 特殊依赖..."
    if ! command -v xcodebuild &> /dev/null; then
        echo "⚠️  Xcode Command Line Tools 未安装，某些功能可能受限"
    fi
fi

# Windows 特殊检查
if [ "${OS_WINDOWS}" ]; then
    echo "🪟 检查 Windows 特殊依赖..."
    if ! command -v cl &> /dev/null; then
        echo "⚠️  Visual Studio C++ 工具未找到，可能需要安装 Visual Studio Build Tools"
    fi
fi

# 构建类型选择
BUILD_TYPE=${1:-dev}

case "${BUILD_TYPE}" in
  "dev")
    echo "🔧 启动开发环境..."
    echo "   请在另一个终端中运行: npm run dev"
    echo "   然后运行: npm run tauri:dev"
    echo "   或者直接运行: npm run tauri:dev (会自动启动前端)"
    ;;
  "build")
    echo "🏗️  开始构建生产版本..."
    npm run tauri:build
    ;;
  "clean")
    echo "🧹 清理构建缓存..."
    cargo clean
    npm run tauri:clean
    ;;
  "info")
    echo "ℹ️  显示项目信息..."
    npm run tauri info
    ;;
  *)
    echo "❌ 无效的构建类型: ${BUILD_TYPE}"
    echo "用法: $0 [dev|build|clean|info]"
    echo ""
    echo "  dev   - 启动开发环境"
    echo "  build - 构建生产版本"
    echo "  clean - 清理构建缓存"
    echo "  info  - 显示项目信息"
    exit 1
    ;;
esac

echo "✅ 完成!"