const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 启用CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
    credentials: true
}));

// 解析JSON请求体
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 提供静态文件服务
app.use(express.static(path.join(__dirname)));

// 视频代理端点（保持向后兼容）- 需要在通用代理之前定义
app.get('/proxy/video', async (req, res) => {
    await handleProxyRequest(req.query.url, req, res);
});

// 通用代理端点（处理HLS片段和子清单）
app.get('/proxy/*', async (req, res) => {
    // 从路径中提取实际的URL
    let targetUrl = req.params[0];
    
    // 确保不是video端点（应该已经被上面的路由处理了）
    if (targetUrl === 'video') {
        return res.status(400).json({ 
            error: '此请求应该由 /proxy/video 端点处理',
            suggestion: '请检查路由配置'
        });
    }
    
    console.log(`处理HLS片段请求: ${targetUrl}`);
    console.log(`Query参数:`, req.query);
    console.log(`User-Agent:`, req.headers['user-agent']);
    
    // 对于HLS片段，需要重构完整URL
    const baseUrl = req.query.base;
    if (baseUrl) {
        try {
            // 从base URL中提取基础路径
            const decodedBaseUrl = decodeURIComponent(baseUrl);
            const decodedTargetUrl = decodeURIComponent(targetUrl);
            console.log(`解码后的base URL: ${decodedBaseUrl}`);
            console.log(`解码后的目标文件: ${decodedTargetUrl}`);
            
            // 构造完整的目标URL
            targetUrl = decodedBaseUrl + decodedTargetUrl;
            
            console.log(`重构后的目标URL: ${targetUrl}`);
        } catch (e) {
            console.error('URL重构失败:', e);
            return res.status(400).json({ 
                error: 'URL格式错误',
                details: e.message,
                baseUrl: req.query.base,
                targetUrl: targetUrl
            });
        }
    } else {
        console.error('缺少base URL参数');
        return res.status(400).json({ 
            error: '缺少base URL参数',
            receivedPath: targetUrl,
            queryParams: req.query,
            suggestion: '请确保在m3u8处理时正确设置base参数'
        });
    }
    
    // 验证重构后的URL格式
    try {
        new URL(targetUrl);
    } catch (e) {
        console.error('重构后的URL格式无效:', targetUrl);
        return res.status(400).json({
            error: '重构后的URL格式无效',
            url: targetUrl,
            details: e.message
        });
    }
    
    await handleProxyRequest(targetUrl, req, res);
});

// 处理m3u8文件内容，将相对URL转换为代理URL
function processM3U8Content(content, baseUrl) {
    console.log('原始m3u8内容:', content);
    
    // 获取基础URL（去掉文件名）
    const urlObj = new URL(baseUrl);
    const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
    const baseUrlWithoutFile = urlObj.origin + basePath;
    
    console.log('基础URL:', baseUrlWithoutFile);
    
    // 处理每一行
    const lines = content.split('\n');
    const processedLines = lines.map(line => {
        const trimmedLine = line.trim();
        
        // 跳过注释行和空行
        if (!trimmedLine || trimmedLine.startsWith('#')) {
            return line;
        }
        
        // 如果是相对URL（不以http开头）
        if (!trimmedLine.startsWith('http')) {
            // 构造完整的原始URL
            const fullUrl = baseUrlWithoutFile + trimmedLine;
            
            // 根据文件类型选择不同的代理路径
            if (trimmedLine.includes('.m3u8')) {
                // 子清单文件仍然使用 /proxy/video
                const proxyUrl = `/proxy/video?url=${encodeURIComponent(fullUrl)}`;
                console.log(`转换子清单URL: ${trimmedLine} -> ${proxyUrl}`);
                return proxyUrl;
            } else {
                // 片段文件(.ts等)使用新的路径，传递base参数用于URL重构
                const proxyUrl = `/proxy/${encodeURIComponent(trimmedLine)}?base=${encodeURIComponent(baseUrlWithoutFile)}`;
                console.log(`转换片段URL: ${trimmedLine} -> ${proxyUrl}`);
                return proxyUrl;
            }
        }
        
        // 如果是绝对URL，也通过代理
        if (trimmedLine.startsWith('http')) {
            if (trimmedLine.includes('.m3u8')) {
                // 子清单文件
                const proxyUrl = `/proxy/video?url=${encodeURIComponent(trimmedLine)}`;
                console.log(`代理绝对子清单URL: ${trimmedLine} -> ${proxyUrl}`);
                return proxyUrl;
            } else {
                // 片段文件 - 从URL中提取文件名和基础路径
                try {
                    const segmentUrlObj = new URL(trimmedLine);
                    const segmentBasePath = segmentUrlObj.pathname.substring(0, segmentUrlObj.pathname.lastIndexOf('/') + 1);
                    const segmentBaseUrl = segmentUrlObj.origin + segmentBasePath;
                    const segmentFileName = segmentUrlObj.pathname.substring(segmentUrlObj.pathname.lastIndexOf('/') + 1);
                    
                    const proxyUrl = `/proxy/${encodeURIComponent(segmentFileName)}?base=${encodeURIComponent(segmentBaseUrl)}`;
                    console.log(`代理绝对片段URL: ${trimmedLine} -> ${proxyUrl}`);
                    return proxyUrl;
                } catch (e) {
                    console.error('解析绝对URL失败:', e);
                    const proxyUrl = `/proxy/video?url=${encodeURIComponent(trimmedLine)}`;
                    return proxyUrl;
                }
            }
        }
        
        return line;
    });
    
    const processedContent = processedLines.join('\n');
    console.log('处理后m3u8内容:', processedContent);
    
    return processedContent;
}

// 通用代理处理函数
async function handleProxyRequest(targetUrl, req, res) {
    if (!targetUrl) {
        return res.status(400).json({ error: '缺少目标URL参数' });
    }

    try {
        console.log(`代理请求: ${targetUrl}`);
        
        // 检查是否为HLS流 (.m3u8)
        const isHLS = targetUrl.toLowerCase().includes('.m3u8');
        const isTS = targetUrl.toLowerCase().includes('.ts');
        
        // 设置响应头以支持视频流
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'identity',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Connection': 'keep-alive'
        };

        // 添加Origin和Referer头
        try {
            const urlObj = new URL(targetUrl);
            headers['Referer'] = urlObj.origin + '/';
            headers['Origin'] = urlObj.origin;
        } catch (e) {
            console.warn('无法解析URL:', targetUrl);
        }

        // 如果是HLS流，添加特殊的请求头
        if (isHLS) {
            headers['Accept'] = 'application/vnd.apple.mpegurl, application/x-mpegurl, */*';
        } else if (isTS) {
            headers['Accept'] = 'video/mp2t, */*';
        }

        // 如果客户端发送了Range头且不是HLS，转发它
        if (req.headers.range && !isHLS) {
            headers.Range = req.headers.range;
            console.log(`转发Range头: ${req.headers.range}`);
        }

        // 设置不同的超时时间
        const timeout = isTS ? 15000 : 30000; // TS片段用较短超时
        
        console.log(`发起${isHLS ? 'HLS' : isTS ? 'TS片段' : '视频'}请求, 超时设置: ${timeout}ms`);

        // 发起请求获取资源
        const response = await axios({
            method: 'GET',
            url: targetUrl,
            headers: headers,
            responseType: 'stream',
            timeout: timeout,
            maxRedirects: 5,
            validateStatus: function (status) {
                return status < 500; // 接受所有小于500的状态码
            }
        });

        console.log(`响应状态: ${response.status}, Content-Type: ${response.headers['content-type']}`);
        
        // 检查响应状态
        if (response.status >= 400) {
            console.error(`目标服务器返回错误状态: ${response.status}`);
            return res.status(response.status).json({
                error: `目标服务器错误: ${response.status}`,
                url: targetUrl
            });
        }

        // 设置基础响应头
        const responseHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range'
        };

        // 根据内容类型设置不同的响应头
        if (isHLS) {
            // HLS流的特殊处理 - 需要修改内容中的相对URL
            responseHeaders['Content-Type'] = 'application/vnd.apple.mpegurl';
            responseHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
            responseHeaders['Pragma'] = 'no-cache';
            responseHeaders['Expires'] = '0';
            
            // 对于m3u8文件，需要处理内容
            let m3u8Content = '';
            let hasError = false;
            
            response.data.on('data', (chunk) => {
                m3u8Content += chunk.toString();
            });
            
            response.data.on('error', (error) => {
                console.error('M3U8数据流错误:', error);
                hasError = true;
                if (!res.headersSent) {
                    res.status(500).json({ error: 'M3U8数据流错误' });
                }
            });
            
            response.data.on('end', () => {
                if (hasError) return;
                
                try {
                    console.log(`M3U8内容长度: ${m3u8Content.length} 字符`);
                    
                    // 修改m3u8内容，将相对URL转换为代理URL
                    const modifiedContent = processM3U8Content(m3u8Content, targetUrl);
                    
                    // 设置正确的Content-Length
                    responseHeaders['Content-Length'] = Buffer.byteLength(modifiedContent, 'utf8');
                    res.set(responseHeaders);
                    
                    console.log('成功处理并返回m3u8内容');
                    res.send(modifiedContent);
                } catch (error) {
                    console.error('处理m3u8内容失败:', error);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'm3u8内容处理失败', details: error.message });
                    }
                }
            });
            
            return; // 早期返回，不执行下面的pipe
        } else if (isTS) {
            // TS片段
            responseHeaders['Content-Type'] = response.headers['content-type'] || 'video/mp2t';
            responseHeaders['Accept-Ranges'] = 'bytes';
            responseHeaders['Cache-Control'] = 'public, max-age=86400';
            console.log('处理TS片段请求');
        } else {
            // 普通视频文件
            responseHeaders['Content-Type'] = response.headers['content-type'] || 'video/mp4';
            responseHeaders['Accept-Ranges'] = 'bytes';
            responseHeaders['Cache-Control'] = 'public, max-age=3600';
            console.log('处理普通视频文件请求');
        }

        res.set(responseHeaders);

        // 如果服务器支持Range请求且不是HLS，转发相关头部
        if (response.headers['content-range'] && !isHLS) {
            res.set('Content-Range', response.headers['content-range']);
            res.status(206); // Partial Content
            console.log('返回部分内容 (206)');
        } else if (response.headers['content-length']) {
            res.set('Content-Length', response.headers['content-length']);
            console.log(`设置Content-Length: ${response.headers['content-length']}`);
        }

        // 将流管道传输给客户端
        response.data.pipe(res);

        // 处理错误
        response.data.on('error', (error) => {
            console.error('数据流错误:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: '数据流传输错误' });
            }
        });

        // 监听响应完成
        response.data.on('end', () => {
            console.log(`${isTS ? 'TS片段' : isHLS ? 'HLS清单' : '视频文件'}传输完成`);
        });

    } catch (error) {
        console.error('代理请求失败:', error.message);
        console.error('错误详情:', {
            code: error.code,
            response: error.response ? {
                status: error.response.status,
                statusText: error.response.statusText,
                headers: error.response.headers
            } : null,
            config: {
                url: error.config?.url,
                timeout: error.config?.timeout
            }
        });
        
        if (error.response) {
            // 服务器响应了错误状态码
            res.status(error.response.status).json({ 
                error: '无法获取资源', 
                details: error.response.statusText,
                originalUrl: targetUrl,
                statusCode: error.response.status
            });
        } else if (error.request) {
            // 请求已发出但没有收到响应
            if (error.code === 'ECONNABORTED') {
                res.status(504).json({ error: '请求超时', url: targetUrl });
            } else {
                res.status(504).json({ error: '目标服务器无响应', code: error.code });
            }
        } else {
            // 其他错误
            res.status(500).json({ error: '服务器内部错误', details: error.message });
        }
    }
}



// HLS片段代理端点 (处理.ts文件)
app.get('/proxy/hls-segment', async (req, res) => {
    const segmentUrl = req.query.url;
    
    if (!segmentUrl) {
        return res.status(400).json({ error: '缺少片段URL参数' });
    }

    try {
        console.log(`代理HLS片段: ${segmentUrl}`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'identity',
            'Referer': new URL(segmentUrl).origin,
            'Origin': new URL(segmentUrl).origin
        };

        if (req.headers.range) {
            headers.Range = req.headers.range;
        }

        const response = await axios({
            method: 'GET',
            url: segmentUrl,
            headers: headers,
            responseType: 'stream',
            timeout: 30000
        });

        res.set({
            'Content-Type': response.headers['content-type'] || 'video/mp2t',
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
            'Cache-Control': 'public, max-age=86400'
        });

        if (response.headers['content-range']) {
            res.set('Content-Range', response.headers['content-range']);
            res.status(206);
        } else if (response.headers['content-length']) {
            res.set('Content-Length', response.headers['content-length']);
        }

        response.data.pipe(res);

        response.data.on('error', (error) => {
            console.error('HLS片段流错误:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'HLS片段传输错误' });
            }
        });

    } catch (error) {
        console.error('代理HLS片段失败:', error.message);
        res.status(500).json({ error: 'HLS片段获取失败' });
    }
});

// 检查视频URL是否可访问
app.post('/check-video', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: '缺少URL参数' });
    }

    try {
        const response = await axios.head(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        res.json({
            accessible: true,
            contentType: response.headers['content-type'],
            contentLength: response.headers['content-length']
        });
    } catch (error) {
        res.json({
            accessible: false,
            error: error.message
        });
    }
});

// 默认路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'video_space.html'));
});

// 健康检查端点
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 错误处理中间件
app.use((error, req, res, next) => {
    console.error('服务器错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
});

// 404处理
app.use((req, res) => {
    res.status(404).json({ error: '页面未找到' });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 Video Space 服务器已启动!`);
    console.log(`📱 本地访问: http://localhost:${PORT}`);
    console.log(`🔗 代理端点: http://localhost:${PORT}/proxy/video?url=<视频URL>`);
    console.log(`⚡ 环境: ${process.env.NODE_ENV || 'development'}`);
}); 