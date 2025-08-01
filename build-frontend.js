const fs = require('fs');
const path = require('path');

console.log('Building frontend...');
console.log('Current directory:', __dirname);

// 创建 dist 目录
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
    console.log('Created dist directory:', distDir);
}

// 复制前端文件
const sourceFile = path.join(__dirname, 'video_space.html');
const targetFile = path.join(distDir, 'index.html');

console.log('Source file:', sourceFile);
console.log('Target file:', targetFile);

if (fs.existsSync(sourceFile)) {
    fs.copyFileSync(sourceFile, targetFile);
    console.log('✓ Frontend build completed: video_space.html -> dist/index.html');
    
    // 验证文件存在
    if (fs.existsSync(targetFile)) {
        const stats = fs.statSync(targetFile);
        console.log('✓ Target file size:', stats.size, 'bytes');
    } else {
        console.error('✗ Target file was not created');
        process.exit(1);
    }
} else {
    console.error('✗ Source file not found:', sourceFile);
    process.exit(1);
}