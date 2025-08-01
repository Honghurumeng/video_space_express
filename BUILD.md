# Tauri Build Instructions

## 本地开发环境设置

### 系统要求

#### Windows
- Windows 10 或更高版本
- Visual Studio 2019 或更高版本 (包含 "C++ build tools")
- Node.js 18+ 
- Rust 1.70+

#### macOS
- macOS 10.15+ (Catalina 或更高版本)
- Xcode Command Line Tools
- Node.js 18+
- Rust 1.70+

### 安装步骤

#### 1. 安装 Rust
```bash
# Windows (使用 rustup)
curl --proto '=https' --tlsv1.2 -sSf https://win.rustup.rs/ | powershell

# macOS (使用 rustup)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs/ | sh
```

#### 2. 安装 Tauri CLI
```bash
cargo install tauri-cli --version "^2.0"
```

#### 3. 安装项目依赖
```bash
npm install
```

### 本地开发

#### 启动开发环境
```bash
# 启动前端开发服务器
npm run dev

# 在另一个终端中启动 Tauri 开发模式
npm run tauri:dev
```

#### 构建应用
```bash
# 构建生产版本
npm run tauri:build
```

## GitHub Actions 自动构建

项目已配置 GitHub Actions 在以下情况下自动构建：

### 触发条件
- 推送到 `main` 或 `develop` 分支
- 创建/更新 Pull Request
- 创建版本标签 (`v*`)
- 手动触发

### 构建产物

#### Windows
- **MSI 安装包**: `src-tauri/target/release/bundle/msi/*.msi`
- **可执行文件**: `src-tauri/target/release/video-space.exe`

#### macOS
- **DMG 安装包**: `src-tauri/target/release/bundle/dmg/*.dmg`
- **应用程序包**: `src-tauri/target/release/bundle/macos/*.app`

### 自动发布

当创建版本标签时（如 `v1.2.0`），GitHub Actions 会：
1. 构建 Windows 和 macOS 版本
2. 自动创建 GitHub Release
3. 上传构建产物到 Release

## 构建配置说明

### Tauri 配置文件
- `tauri.conf.json`: 主配置文件，包含窗口设置、权限配置等
- `src-tauri/Cargo.toml`: Rust 依赖配置
- `src-tauri/src/main.rs`: 主应用程序代码

### 重要配置

#### 窗口配置
- 默认尺寸: 1200x800
- 最小尺寸: 800x600
- 支持系统主题切换
- 可调整大小和最大化

#### 安全配置
- CSP 策略已配置，允许必要的资源加载
- 文件系统访问权限已启用
- 外部协议处理已配置

#### 应用功能
- 系统托盘支持
- 深度链接处理 (`video-space://`)
- 系统通知
- 文件系统操作

## 故障排除

### Windows 构建问题
```bash
# 清理构建缓存
npm run tauri:clean
cargo clean

# 重新安装依赖
npm install
```

### macOS 构建问题
```bash
# 更新 Xcode Command Line Tools
xcode-select --install

# 清理构建缓存
npm run tauri:clean
cargo clean
```

### 常见问题
1. **Rust 编译失败**: 确保安装了正确版本的 Rust 和 Visual Studio C++ 工具
2. **前端资源未找到**: 确保在 `tauri.conf.json` 中正确配置了 `frontendDist`
3. **权限问题**: 确保在 Tauri 配置中正确设置了所需的权限

## 开发提示

### 调试模式
```bash
# 启用开发者工具
npm run tauri:dev
# 然后按 F12 或右键选择 "检查"
```

### 日志查看
```bash
# Windows 日志位置
src-tauri/target/debug/video-space.log

# macOS 日志位置
~/Library/Logs/video-space.log
```

### 热重载
开发模式下，前端代码支持热重载，但 Rust 代码修改需要重启应用。