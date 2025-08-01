# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Video Space 是一个跨域视频播放代理应用，通过服务器端代理技术解决复杂的跨域视频播放问题。主要功能包括 HLS 视频流代理、多集视频管理、播放进度跟踪等。

## 常用命令

### 开发和运行
```bash
npm install          # 安装依赖
npm start           # 生产环境启动服务器
npm run dev         # 开发环境启动（使用 nodemon 自动重启）
```

### 访问应用
启动后访问: `http://localhost:3010`

## 核心架构

### 代理系统架构
项目采用双路由代理系统来处理不同类型的视频请求：

1. **通用代理端点** (`/proxy/*`) - 处理 HLS 片段(.ts 文件)和子清单文件
2. **传统视频代理端点** (`/proxy/video`) - 处理主 m3u8 文件和普通视频文件

### 关键技术实现

#### 1. 动态 M3U8 重写引擎 (server.js:102-202)
- **核心函数**: `processM3U8Content(content, baseUrl, req)`
- **功能**: 实时解析 HLS 清单文件，将相对路径重写为代理路径
- **处理流程**: 解析基础URL → 逐行分析 → URL重写 → 分类处理

#### 2. 流式传输处理 (server.js:330-476)
- **HLS流处理**: 实时内容修改和内存缓冲
- **TS片段处理**: 缓冲传输和连接管理
- **错误恢复**: 处理中断和错误情况

#### 3. 前端状态管理 (video_space.html:275-600)
```javascript
// 全局状态变量
let currentVideo = null;
let currentEpisode = null;
let videoPlayer = null;      // Video.js 实例
let hlsInstance = null;      // HLS.js 实例
let isPlayerActive = false;  // 播放器激活状态
```

#### 4. 本地存储系统
- **视频列表**: `localStorage.getItem('videoPlaylists')`
- **观看进度**: 按视频ID和剧集ID存储
- **自动保存**: 播放时自动更新进度

### 代理工作流程

当播放 HLS 视频时的请求流程：
1. 客户端请求 `/proxy/video?url=...` (主 m3u8 文件)
2. 服务器获取原始 m3u8 文件并重写其中的所有相对路径
3. 客户端接收修改后的 m3u8 文件
4. 客户端请求重写后的片段 URL (`/proxy/segment.ts?base=...`)
5. 服务器通过 `base` 参数重构完整 URL 并获取原始片段
6. 服务器将片段数据返回给客户端

### 多播放器支持
- **HLS.js**: 专业的 HLS 流媒体播放器
- **Video.js**: 通用视频播放器，支持多种格式
- **原生播放**: Safari 等浏览器的原生 HLS 支持
- **自动切换**: 根据浏览器兼容性自动选择播放器

### 重要文件结构
- `server.js`: Express 服务器，包含代理逻辑和 API 端点
- `video_space.html`: 前端界面，包含播放器和管理功能
- `package.json`: 项目配置，包含开发和运行脚本

### API 端点
- `GET /proxy/video?url=<视频URL>` - 传统视频代理端点
- `GET /proxy/*` - 通用代理端点（处理 HLS 片段）
- `POST /check-video` - 视频链接可访问性检查

### 依赖技术栈
- **后端**: Node.js, Express, Axios
- **前端**: HTML5, Tailwind CSS, JavaScript
- **播放器**: HLS.js, Video.js
- **开发工具**: nodemon