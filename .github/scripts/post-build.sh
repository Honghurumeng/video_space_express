#!/bin/bash

# Video Space GitHub Actions 部署后脚本
# 在成功构建后运行的辅助脚本

set -e

echo "📦 Video Space 部署后脚本"
echo "========================="

# 检查是否在 GitHub Actions 环境中
if [ -z "$GITHUB_ACTIONS" ]; then
    echo "⚠️  此脚本应在 GitHub Actions 环境中运行"
    exit 0
fi

# 获取构建信息
echo "🔍 构建信息:"
echo "   仓库: $GITHUB_REPOSITORY"
echo "   分支: $GITHUB_BRANCH"
echo "   提交: $GITHUB_SHA"
echo "   事件: $GITHUB_EVENT_NAME"

# 如果是发布事件，处理额外信息
if [ "$GITHUB_EVENT_NAME" == "release" ]; then
    echo "🎉 检测到发布事件!"
    
    # 获取标签名称
    TAG_NAME="${GITHUB_REF#refs/tags/}"
    echo "   版本标签: $TAG_NAME"
    
    # 创建版本信息文件
    cat > version-info.txt << EOF
Video Space v${TAG_NAME}
===================

构建时间: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
提交哈希: ${GITHUB_SHA:0:7}
构建平台: $(uname -s)
Node.js 版本: $(node --version)
Rust 版本: $(rustc --version)

支持的操作系统:
- Windows 10+ (64位)
- macOS 10.15+ (64位)

构建产物:
- Windows: .msi 安装包
- Windows: 可执行文件 (.exe)
- macOS: .dmg 安装包
- macOS: 应用程序包 (.app)
EOF
    
    echo "✅ 版本信息已创建"
fi

# 检查构建产物是否存在
TARGET_DIR="src-tauri/target/release"

if [ -d "$TARGET_DIR/bundle" ]; then
    echo "📂 检查构建产物..."
    
    # Windows 产物
    if [ -d "$TARGET_DIR/bundle/msi" ]; then
        MSI_COUNT=$(ls -1 "$TARGET_DIR/bundle/msi/*.msi" 2>/dev/null | wc -l)
        echo "   Windows MSI 安装包: $MSI_COUNT 个"
    fi
    
    # macOS 产物
    if [ -d "$TARGET_DIR/bundle/dmg" ]; then
        DMG_COUNT=$(ls -1 "$TARGET_DIR/bundle/dmg/*.dmg" 2>/dev/null | wc -l)
        echo "   macOS DMG 安装包: $DMG_COUNT 个"
    fi
    
    if [ -d "$TARGET_DIR/bundle/macos" ]; then
        APP_COUNT=$(ls -1 "$TARGET_DIR/bundle/macos/*.app" 2>/dev/null | wc -l)
        echo "   macOS 应用程序包: $APP_COUNT 个"
    fi
fi

# 生成构建摘要
echo "📊 生成构建摘要..."
cat > build-summary.txt << EOF
Video Space 构建摘要
==================

状态: 成功 ✅
时间: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
仓库: $GITHUB_REPOSITORY
分支: $GITHUB_BRANCH
提交: $GITHUB_SHA

环境信息:
- 运行器: $RUNNER_OS
- Node.js: $(node --version)
- Rust: $(rustc --version)

构建配置:
- Tauri 版本: $(cargo tauri --version)
- 构建模式: Release
- 平台支持: Windows, macOS

EOF

echo "✅ 构建摘要已生成"

# 如果是 PR 事件，添加 PR 信息
if [ "$GITHUB_EVENT_NAME" == "pull_request" ]; then
    echo "🔀 处理 PR 事件..."
    
    # 这里可以添加 PR 特定的逻辑
    # 例如：添加评论、检查等
    
    echo "   PR 编号: $GITHUB_PR_NUMBER"
    echo "   PR 标题: $GITHUB_PR_TITLE"
fi

echo "🎉 部署后脚本执行完成!"