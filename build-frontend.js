const fs = require('fs');
const path = require('path');

// 创建 dist 目录
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// 复制前端文件
const sourceFile = path.join(__dirname, 'video_space.html');
const targetFile = path.join(distDir, 'index.html');

fs.copyFileSync(sourceFile, targetFile);
console.log('Frontend build completed: video_space.html -> dist/index.html');