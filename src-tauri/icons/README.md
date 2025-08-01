# Video Space 图标占位符

这个目录包含 Video Space 应用的图标文件。

## 需要的图标文件

为了构建应用，需要以下图标文件：

### Windows
- `icon.ico` (16x16, 32x32, 48x48, 64x64, 256x256)
- `32x32.png`
- `128x128.png`

### macOS
- `icon.icns` (包含多种尺寸)
- `128x128@2x.png` (256x256 for Retina)

### 通用
- `icon.png` (1024x1024)

## 图标设计建议

### 设计元素
- **主题**: 视频播放、媒体、流媒体
- **颜色**: 主色调 #3B82F6 (蓝色)、辅助色 #10B981 (绿色)
- **风格**: 现代简约、扁平化设计

### 符号建议
- 播放按钮 (▶)
- 视频摄像机
- 流媒体符号
- 地球/网络图标
- 组合设计 (播放+地球)

### 制作工具推荐
- **在线工具**: Figma, Canva, Iconscout
- **桌面工具**: Adobe Illustrator, Sketch, GIMP
- **图标转换**: CloudConvert, Convertio

### 文件格式要求
- **Windows ICO**: 多尺寸合并在一个文件中
- **macOS ICNS**: 使用 `iconutil` 命令生成
- **PNG**: 透明背景，最佳分辨率

## 生成命令示例

### macOS 生成 ICNS
```bash
# 创建图标集目录
mkdir -p Icon.iconset

# 生成不同尺寸
sips -z 16 16     icon.png --out Icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out Icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out Icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out Icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out Icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out Icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out Icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out Icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out Icon.iconset/icon_512x512.png

# 生成 ICNS 文件
iconutil -c icns Icon.iconset -o icon.icns
```

### Windows 生成 ICO
可以使用在线工具或以下命令：
```bash
# 使用 ImageMagick
convert icon.png -resize 256x256 icon.ico
```

## 注意事项

1. **版权**: 确保使用的图标没有版权问题
2. **一致性**: 所有平台的图标应保持设计一致性
3. **质量**: 使用矢量图形确保在各种尺寸下都清晰
4. **测试**: 在不同背景下测试图标的可见性

## 临时解决方案

在正式图标制作完成前，可以使用简单的占位符图标：
- 使用文本"VS"或"🎬"作为临时图标
- 使用简单的几何形状配合主题色
- 使用开源图标库中的相关图标