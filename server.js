const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3010;

// 性能优化配置
const PERFORMANCE_CONFIG = {
    // 并发连接数限制
    MAX_CONCURRENT_CONNECTIONS: 20,
    // 连接超时时间（毫秒）
    CONNECTION_TIMEOUT: 10000,
    // 请求超时时间（毫秒）
    REQUEST_TIMEOUT: 30000,
    // 缓存大小限制（MB）
    CACHE_SIZE_LIMIT: 100,
    // 启用HTTP/2支持
    ENABLE_HTTP2: true,
    // 启用连接复用
    ENABLE_KEEP_ALIVE: true,
    // 并发预加载片段数
    PREFETCH_SEGMENTS: 6
};

// 简单的内存缓存系统
const cache = new Map();
const cacheStats = {
    hits: 0,
    misses: 0,
    size: 0
};

// 连接池管理器
class ConnectionPool {
    constructor() {
        this.pools = new Map();
        this.activeConnections = 0;
        this.queue = [];
    }

    async getConnection(origin) {
        if (this.activeConnections >= PERFORMANCE_CONFIG.MAX_CONCURRENT_CONNECTIONS) {
            await new Promise(resolve => this.queue.push(resolve));
        }

        this.activeConnections++;
        // console.log(`🔗 连接池状态: ${this.activeConnections}/${PERFORMANCE_CONFIG.MAX_CONCURRENT_CONNECTIONS}`);

        return {
            origin,
            release: () => {
                this.activeConnections--;
                if (this.queue.length > 0) {
                    const next = this.queue.shift();
                    next();
                }
            }
        };
    }
}

const connectionPool = new ConnectionPool();

// 缓存管理器
class CacheManager {
    constructor() {
        this.cache = new Map();
        this.stats = { hits: 0, misses: 0, size: 0 };
        this.maxSize = PERFORMANCE_CONFIG.CACHE_SIZE_LIMIT * 1024 * 1024; // 转换为字节
    }

    get(key) {
        const item = this.cache.get(key);
        if (item && Date.now() - item.timestamp < 300000) { // 5分钟缓存
            this.stats.hits++;
            return item.data;
        }
        this.stats.misses++;
        return null;
    }

    set(key, data) {
        const size = Buffer.byteLength(JSON.stringify(data), 'utf8');
        if (this.stats.size + size > this.maxSize) {
            this.evictLRU();
        }
        
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            size,
            accessCount: 0
        });
        this.stats.size += size;
    }

    evictLRU() {
        let oldestKey = null;
        let oldestTime = Date.now();
        
        for (const [key, item] of this.cache) {
            if (item.timestamp < oldestTime) {
                oldestTime = item.timestamp;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            const item = this.cache.get(oldestKey);
            this.cache.delete(oldestKey);
            this.stats.size -= item.size;
        }
    }

    getStats() {
        return {
            ...this.stats,
            items: this.cache.size,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) * 100
        };
    }
}

const cacheManager = new CacheManager();

// 增强的HTTP客户端（支持并发和连接复用）
class EnhancedHTTPClient {
    constructor() {
        this.agent = new http.Agent({
            keepAlive: PERFORMANCE_CONFIG.ENABLE_KEEP_ALIVE,
            keepAliveMsecs: 30000,
            maxSockets: PERFORMANCE_CONFIG.MAX_CONCURRENT_CONNECTIONS,
            maxFreeSockets: 10,
            timeout: PERFORMANCE_CONFIG.CONNECTION_TIMEOUT
        });

        this.httpsAgent = new https.Agent({
            keepAlive: PERFORMANCE_CONFIG.ENABLE_KEEP_ALIVE,
            keepAliveMsecs: 30000,
            maxSockets: PERFORMANCE_CONFIG.MAX_CONCURRENT_CONNECTIONS,
            maxFreeSockets: 10,
            timeout: PERFORMANCE_CONFIG.CONNECTION_TIMEOUT,
            rejectUnauthorized: false
        });
    }

    async request(url, options = {}) {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const agent = isHttps ? this.httpsAgent : this.agent;
        
        // 获取连接池连接
        const connection = await connectionPool.getConnection(urlObj.origin);
        
        try {
            // console.log(`🚀 开始并发请求: ${url}`);
            
            // 检查缓存
            const cacheKey = `url_${url}`;
            const cachedData = cacheManager.get(cacheKey);
            if (cachedData) {
                console.log(`🎯 使用缓存数据: ${url}`);
                return cachedData;
            }

            // 创建基础配置
            const config = {
                method: options.method || 'GET',
                url: url,
                headers: options.headers || {},
                timeout: PERFORMANCE_CONFIG.REQUEST_TIMEOUT,
                responseType: 'stream',
                httpAgent: agent,
                httpsAgent: agent,
                maxRedirects: 5,
                validateStatus: function (status) {
                    return status >= 200 && status < 300;
                }
            };

            // 执行请求
            const response = await axios(config);
            
            // 对于小文件，可以缓存响应数据
            if (response.headers['content-length'] && 
                parseInt(response.headers['content-length']) < 1024 * 1024) { // 小于1MB
                // console.log(`📦 响应较小，将缓存: ${url}`);
                // 这里需要在实际使用时缓存处理后的数据
            }

            return response;
        } catch (error) {
            console.error(`❌ 请求失败: ${url}`, error.message);
            throw error;
        } finally {
            connection.release();
        }
    }

    // 并发请求多个URL
    async concurrentRequests(urls, options = {}) {
        const promises = urls.map(url => 
            this.request(url, options).catch(error => {
                console.error(`❌ 并发请求失败: ${url}`, error.message);
                return null;
            })
        );

        const results = await Promise.allSettled(promises);
        return results.map((result, index) => ({
            url: urls[index],
            success: result.status === 'fulfilled',
            data: result.status === 'fulfilled' ? result.value : null,
            error: result.status === 'rejected' ? result.reason : null
        }));
    }
}

const httpClient = new EnhancedHTTPClient();

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
    
    // console.log(`处理HLS片段请求: ${targetUrl}`);
    // console.log(`Query参数:`, req.query);
    // console.log(`User-Agent:`, req.headers['user-agent']);
    
    // 对于HLS片段，需要重构完整URL
    const baseUrl = req.query.base;
    if (baseUrl) {
        try {
            // 从base URL中提取基础路径
            const decodedBaseUrl = decodeURIComponent(baseUrl);
            const decodedTargetUrl = decodeURIComponent(targetUrl);
            // console.log(`解码后的base URL: ${decodedBaseUrl}`);
            // console.log(`解码后的目标文件: ${decodedTargetUrl}`);
            
            // 构造完整的目标URL，确保路径正确连接
            // 确保base URL以斜杠结尾，目标URL不以斜杠开头
            const normalizedBaseUrl = decodedBaseUrl.endsWith('/') ? decodedBaseUrl : decodedBaseUrl + '/';
            const normalizedTargetUrl = decodedTargetUrl.startsWith('/') ? decodedTargetUrl.substring(1) : decodedTargetUrl;
            
            targetUrl = normalizedBaseUrl + normalizedTargetUrl;
            
            // console.log(`重构后的目标URL: ${targetUrl}`);
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
        // 如果没有base参数，尝试直接使用路径作为相对URL
        // 这种情况可能发生在某些HLS流中
        console.warn('缺少base URL参数，尝试直接处理路径');
        // 在这种情况下，我们无法构建完整URL，直接返回错误
        return res.status(400).json({ 
            error: '缺少base URL参数',
            receivedPath: targetUrl,
            queryParams: req.query,
            suggestion: 'HLS片段需要base参数来构建完整URL'
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
function processM3U8Content(content, baseUrl, req) {
    console.log('=== 开始处理M3U8内容 ===');
    console.log('原始m3u8内容长度:', content.length);
    console.log('基础URL:', baseUrl);
    
    try {
        // 获取基础URL（去掉文件名）
        const urlObj = new URL(baseUrl);
        const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
        const baseUrlWithoutFile = urlObj.origin + basePath;
        
        // 获取当前服务器地址
        const serverUrl = `${req.protocol}://${req.get('host')}`;
        console.log('服务器地址:', serverUrl);
        console.log('处理后的基础URL:', baseUrlWithoutFile);
        
        // 处理每一行
        const lines = content.split('\n');
        let processedCount = 0;
        const processedLines = lines.map((line, index) => {
            const trimmedLine = line.trim();
            
            // 跳过注释行和空行
            if (!trimmedLine || trimmedLine.startsWith('#')) {
                return line;
            }
            
            // 如果是相对URL（不以http开头）
            if (!trimmedLine.startsWith('http')) {
                processedCount++;
                // 构造完整的原始URL
                const fullUrl = baseUrlWithoutFile + trimmedLine;
                
                // 根据文件类型选择不同的代理路径
                if (trimmedLine.includes('.m3u8')) {
                    // 子清单文件仍然使用 /proxy/video
                    const proxyUrl = `${serverUrl}/proxy/video?url=${encodeURIComponent(fullUrl)}`;
                    console.log(`[${index}] 转换子清单URL: ${trimmedLine} -> ${proxyUrl}`);
                    return proxyUrl;
                } else {
                    // 片段文件(.ts等)使用新的路径，传递base参数用于URL重构
                    // 优化：确保URL编码正确
                    const encodedSegmentName = encodeURIComponent(trimmedLine);
                    const encodedBaseUrl = encodeURIComponent(baseUrlWithoutFile);
                    const proxyUrl = `${serverUrl}/proxy/${encodedSegmentName}?base=${encodedBaseUrl}`;
                    // console.log(`[${index}] 转换片段URL: ${trimmedLine} -> ${proxyUrl}`);
                    return proxyUrl;
                }
            }
            
            // 如果是绝对URL，也通过代理
            if (trimmedLine.startsWith('http')) {
                processedCount++;
                if (trimmedLine.includes('.m3u8')) {
                    // 子清单文件
                    const proxyUrl = `${serverUrl}/proxy/video?url=${encodeURIComponent(trimmedLine)}`;
                    console.log(`[${index}] 代理绝对子清单URL: ${trimmedLine} -> ${proxyUrl}`);
                    return proxyUrl;
                } else {
                    // 片段文件 - 从URL中提取文件名和基础路径
                    try {
                        const segmentUrlObj = new URL(trimmedLine);
                        const segmentBasePath = segmentUrlObj.pathname.substring(0, segmentUrlObj.pathname.lastIndexOf('/') + 1);
                        const segmentBaseUrl = segmentUrlObj.origin + segmentBasePath;
                        const segmentFileName = segmentUrlObj.pathname.substring(segmentUrlObj.pathname.lastIndexOf('/') + 1);
                        
                        // 优化：确保URL编码正确
                        const encodedSegmentName = encodeURIComponent(segmentFileName);
                        const encodedBaseUrl = encodeURIComponent(segmentBaseUrl);
                        const proxyUrl = `${serverUrl}/proxy/${encodedSegmentName}?base=${encodedBaseUrl}`;
                        console.log(`[${index}] 代理绝对片段URL: ${trimmedLine} -> ${proxyUrl}`);
                        return proxyUrl;
                    } catch (e) {
                        console.error(`[${index}] 解析绝对URL失败:`, e, 'URL:', trimmedLine);
                        // 降级到通用代理
                        const proxyUrl = `${serverUrl}/proxy/video?url=${encodeURIComponent(trimmedLine)}`;
                        return proxyUrl;
                    }
                }
            }
            
            return line;
        });
        
        const processedContent = processedLines.join('\n');
        console.log(`=== M3U8处理完成 ===`);
        console.log(`处理了 ${processedCount} 个URL`);
        console.log('处理后内容长度:', processedContent.length);
        
        return processedContent;
    } catch (error) {
        console.error('M3U8处理过程中发生错误:', error);
        console.error('错误详情:', {
            message: error.message,
            stack: error.stack,
            baseUrl: baseUrl
        });
        // 如果处理失败，返回原始内容
        return content;
    }
}

// 通用代理处理函数
async function handleProxyRequest(targetUrl, req, res) {
    if (!targetUrl) {
        return res.status(400).json({ error: '缺少目标URL参数' });
    }

    // console.log('=== 开始处理代理请求 ===');
    // console.log('目标URL:', targetUrl);
    // console.log('请求方法:', req.method);
    // console.log('请求头:', JSON.stringify(req.headers, null, 2));

    try {
        // 初步检查是否为HLS流（URL包含 .m3u8）
        let isHLS = targetUrl.toLowerCase().includes('.m3u8');
        const isTS = targetUrl.toLowerCase().includes('.ts');
        
        // console.log('文件类型判断:', { isHLS, isTS });
        
        // 设置更完整的请求头以模拟真实浏览器
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'identity, gzip, deflate, br',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        };

        // 添加Origin和Referer头
        try {
            const urlObj = new URL(targetUrl);
            const referer = urlObj.origin + '/';
            headers['Referer'] = referer;
            headers['Origin'] = urlObj.origin;
            // console.log('设置Referer:', referer);
            // console.log('设置Origin:', urlObj.origin);
        } catch (e) {
            console.warn('无法解析URL:', targetUrl, '错误:', e.message);
        }

        // 根据文件类型设置特定的Accept头
        if (isHLS) {
            headers['Accept'] = 'application/vnd.apple.mpegurl, application/x-mpegurl, text/vnd.apple.mpegurl, */*';
            console.log('设置HLS Accept头');
        } else if (isTS) {
            headers['Accept'] = 'video/mp2t, video/MP2T, */*';
        } else {
            headers['Accept'] = 'video/mp4, video/webm, video/ogg, */*';
            console.log('设置视频Accept头');
        }

        // 如果客户端发送了Range头且不是HLS，转发它
        if (req.headers.range && !isHLS) {
            headers.Range = req.headers.range;
            console.log('转发Range头:', req.headers.range);
        }

        // 设置不同的超时时间
        const timeout = isTS ? 20000 : (isHLS ? 30000 : 45000); // 根据文件类型调整超时
        
        // console.log(`🚀 发起${isHLS ? 'HLS' : '视频'}请求, 使用并发客户端`);
        // console.log('最终请求头:', JSON.stringify(headers, null, 2));

        // 使用增强的HTTP客户端发起请求
        const response = await httpClient.request(targetUrl, {
            method: 'GET',
            headers: headers,
            timeout: timeout
        });

        // 有些HLS地址不包含 .m3u8，但响应头会标识类型
        if (!isHLS) {
            const ct = response.headers['content-type'] || '';
            if (ct.toLowerCase().includes('mpegurl')) {
                console.log('通过响应头判断为 HLS 流');
                isHLS = true;
            }
        }

        // console.log('✅ 请求成功');
        // console.log('响应状态:', response.status);
        // console.log('响应头:', JSON.stringify(response.headers, null, 2));
        
        // 检查响应状态
        if (response.status >= 400) {
            console.error('❌ 目标服务器返回错误状态:', response.status);
            return res.status(response.status).json({
                error: `目标服务器错误: ${response.status}`,
                url: targetUrl,
                statusText: response.statusText
            });
        }

        // 设置基础响应头
        const responseHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, Accept, Origin',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
            'X-Proxy-By': 'Video-Space-Proxy'
        };

        // 根据更新后的 isHLS 值设置不同的响应头
        if (isHLS) {
            // HLS流的特殊处理 - 需要修改内容中的相对URL
            responseHeaders['Content-Type'] = 'application/vnd.apple.mpegurl; charset=utf-8';
            responseHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
            responseHeaders['Pragma'] = 'no-cache';
            responseHeaders['Expires'] = '0';
            
            console.log('📋 开始处理HLS流内容...');
            
            // 对于m3u8文件，需要处理内容
            let m3u8Content = '';
            let chunkCount = 0;
            let hasError = false;
            
            response.data.on('data', (chunk) => {
                chunkCount++;
                m3u8Content += chunk.toString();
                console.log(`📦 接收到第${chunkCount}个数据块，当前内容长度: ${m3u8Content.length}`);
            });
            
            response.data.on('error', (error) => {
                console.error('❌ M3U8数据流错误:', error);
                hasError = true;
                if (!res.headersSent) {
                    res.status(500).json({ 
                        error: 'M3U8数据流错误', 
                        details: error.message,
                        url: targetUrl
                    });
                }
            });
            
            response.data.on('end', () => {
                if (hasError) {
                    console.log('⚠️ 由于数据流错误，跳过处理');
                    return;
                }
                
                try {
                    console.log(`📋 M3U8内容接收完成，总长度: ${m3u8Content.length} 字符，共${chunkCount}个数据块`);
                    
                    // 检查内容是否为空
                    if (!m3u8Content || m3u8Content.trim().length === 0) {
                        console.error('❌ M3U8内容为空');
                        if (!res.headersSent) {
                            res.status(500).json({ error: 'M3U8内容为空', url: targetUrl });
                        }
                        return;
                    }
                    
                    // 修改m3u8内容，将相对URL转换为代理URL
                    console.log('🔄 开始处理M3U8内容...');
                    const modifiedContent = processM3U8Content(m3u8Content, targetUrl, req);
                    
                    // 检查处理后的内容
                    if (!modifiedContent || modifiedContent.trim().length === 0) {
                        console.error('❌ 处理后的M3U8内容为空');
                        if (!res.headersSent) {
                            res.status(500).json({ error: 'M3U8内容处理失败', url: targetUrl });
                        }
                        return;
                    }
                    
                    // 设置正确的Content-Length
                    const contentLength = Buffer.byteLength(modifiedContent, 'utf8');
                    responseHeaders['Content-Length'] = contentLength;
                    
                    console.log(`✅ M3U8内容处理完成，处理后长度: ${contentLength} 字节`);
                    
                    // 设置响应头并发送内容
                    res.set(responseHeaders);
                    res.send(modifiedContent);
                    
                    console.log('✅ M3U8内容成功发送给客户端');
                    
                } catch (error) {
                    console.error('❌ 处理m3u8内容失败:', error);
                    console.error('错误堆栈:', error.stack);
                    if (!res.headersSent) {
                        res.status(500).json({ 
                            error: 'm3u8内容处理失败', 
                            details: error.message,
                            url: targetUrl
                        });
                    }
                }
            });
            
            return; // 早期返回，不执行下面的pipe
            
        } else if (isTS) {
            // TS片段 - 使用流式传输避免内存缓冲问题
            responseHeaders['Content-Type'] = response.headers['content-type'] || 'video/mp2t';
            responseHeaders['Accept-Ranges'] = 'bytes';
            responseHeaders['Cache-Control'] = 'public, max-age=86400';
            
            // 设置响应头
            res.set(responseHeaders);
            
            // 直接将数据流管道传输到响应，避免内存缓冲
            response.data.pipe(res);
            
            // 监听错误
            response.data.on('error', (error) => {
                console.error('TS片段流传输错误:', error);
                if (!res.headersSent) {
                    res.status(500).json({ 
                        error: 'TS片段传输错误', 
                        details: error.message,
                        url: targetUrl
                    });
                }
            });
            
            // 监听客户端连接关闭 - 静默处理
            res.on('close', () => {
                // 静默处理连接关闭，不输出日志
                if (response.data && !response.data.destroyed) {
                    response.data.destroy();
                }
            });

            // 监听客户端连接错误 - 静默处理
            res.on('error', (error) => {
                // 静默处理连接错误，不输出日志
                if (response.data && !response.data.destroyed) {
                    response.data.destroy();
                }
            });
            
            return; // 早期返回，不执行下面的pipe
            
        } else {
            // 普通视频文件
            responseHeaders['Content-Type'] = response.headers['content-type'] || 'video/mp4';
            responseHeaders['Accept-Ranges'] = 'bytes';
            responseHeaders['Cache-Control'] = 'public, max-age=3600';
            console.log('🎥 处理普通视频文件请求');
        }

        // 设置响应头
        res.set(responseHeaders);
        console.log('📤 设置响应头完成');

        // 如果服务器支持Range请求且不是HLS，转发相关头部
        if (response.headers['content-range'] && !isHLS) {
            res.set('Content-Range', response.headers['content-range']);
            res.status(206); // Partial Content
            console.log('📄 返回部分内容 (206)');
        } else if (response.headers['content-length']) {
            res.set('Content-Length', response.headers['content-length']);
            console.log(`📏 设置Content-Length: ${response.headers['content-length']}`);
        }

        // 将流管道传输给客户端
        console.log('🔄 开始传输数据流...');
        response.data.pipe(res);

        // 处理错误
        response.data.on('error', (error) => {
            console.error('❌ 数据流传输错误:', error);
            if (!res.headersSent) {
                res.status(500).json({ 
                    error: '数据流传输错误', 
                    details: error.message,
                    url: targetUrl
                });
            }
        });

        // 监听响应完成
        response.data.on('end', () => {
            console.log(`✅ ${isHLS ? 'HLS清单' : '视频文件'}传输完成`);
        });

        // 监听客户端连接关闭 - 静默处理
        res.on('close', () => {
            // 静默处理连接关闭，不输出日志
            if (response.data && !response.data.destroyed) {
                response.data.destroy();
            }
        });

        // 监听客户端连接错误 - 静默处理
        res.on('error', (error) => {
            // 静默处理连接错误，不输出日志
            if (response.data && !response.data.destroyed) {
                response.data.destroy();
            }
        });

    } catch (error) {
        console.error('❌ 代理请求失败:', error.message);
        console.error('错误详情:', {
            code: error.code,
            message: error.message,
            stack: error.stack,
            response: error.response ? {
                status: error.response.status,
                statusText: error.response.statusText,
                headers: error.response.headers
            } : null,
            config: {
                url: error.config?.url,
                timeout: error.config?.timeout,
                method: error.config?.method
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
                res.status(504).json({ 
                    error: '请求超时', 
                    url: targetUrl,
                    timeout: error.config?.timeout
                });
            } else if (error.code === 'ENOTFOUND') {
                res.status(502).json({ 
                    error: '无法解析域名', 
                    url: targetUrl,
                    code: error.code
                });
            } else {
                res.status(504).json({ 
                    error: '目标服务器无响应', 
                    code: error.code,
                    message: error.message
                });
            }
        } else {
            // 其他错误
            res.status(500).json({ 
                error: '服务器内部错误', 
                details: error.message,
                stack: error.stack
            });
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
        
        const contentType = (response.headers['content-type'] || '').toLowerCase();

        // 定义可播放的 Content-Type 关键字
        const playableKeywords = [
            'mpegurl',      // m3u8
            'video/',       // video/*
            'application/x-mpegurl',
            'application/octet-stream'
        ];

        // 判断是否包含任一可播放关键字
        const isPlayable = playableKeywords.some(k => contentType.includes(k));

        res.json({
            accessible: isPlayable,
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
    console.error('=== 服务器错误处理 ===');
    console.error('错误时间:', new Date().toISOString());
    console.error('请求路径:', req.path);
    console.error('请求方法:', req.method);
    console.error('错误名称:', error.name);
    console.error('错误消息:', error.message);
    console.error('错误堆栈:', error.stack);
    
    // 根据错误类型返回不同的响应
    let statusCode = 500;
    let errorMessage = '服务器内部错误';
    let errorDetails = {};
    
    switch (error.name) {
        case 'ValidationError':
            statusCode = 400;
            errorMessage = '请求参数验证失败';
            errorDetails = {
                field: error.path,
                value: error.value,
                message: error.message
            };
            break;
            
        case 'CastError':
            statusCode = 400;
            errorMessage = '数据类型转换失败';
            errorDetails = {
                field: error.path,
                value: error.value,
                type: error.kind
            };
            break;
            
        case 'SyntaxError':
            if (error.message.includes('JSON')) {
                statusCode = 400;
                errorMessage = 'JSON格式错误';
                errorDetails = {
                    position: error.message.match(/position (\d+)/)?.[1],
                    message: error.message
                };
            }
            break;
            
        case 'TypeError':
            statusCode = 400;
            errorMessage = '类型错误';
            errorDetails = {
                message: error.message
            };
            break;
            
        case 'RangeError':
            statusCode = 400;
            errorMessage = '数值超出范围';
            errorDetails = {
                message: error.message
            };
            break;
            
        case 'URIError':
            statusCode = 400;
            errorMessage = 'URI格式错误';
            errorDetails = {
                message: error.message
            };
            break;
            
        default:
            // 处理HTTP错误
            if (error.statusCode) {
                statusCode = error.statusCode;
                errorMessage = error.message || 'HTTP错误';
                errorDetails = {
                    code: error.code,
                    status: error.status
                };
            }
            break;
    }
    
    // 构造错误响应对象
    const errorResponse = {
        error: errorMessage,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method
    };
    
    // 在开发环境中添加更多错误详情
    if (process.env.NODE_ENV === 'development') {
        errorResponse.details = errorDetails;
        errorResponse.stack = error.stack;
    }
    
    // 记录错误到日志（在实际生产环境中应该使用日志系统）
    const logEntry = {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: errorMessage,
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        error: {
            name: error.name,
            message: error.message,
            stack: error.stack
        }
    };
    
    console.error('错误日志:', JSON.stringify(logEntry, null, 2));
    
    // 发送错误响应
    res.status(statusCode).json(errorResponse);
});

// 404处理
app.use((req, res) => {
    console.warn('=== 404 Not Found ===');
    console.warn('请求路径:', req.path);
    console.warn('请求方法:', req.method);
    console.warn('请求时间:', new Date().toISOString());
    console.warn('客户端IP:', req.ip);
    console.warn('User-Agent:', req.get('User-Agent'));
    
    const notFoundResponse = {
        error: '页面未找到',
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
        suggestion: '请检查URL是否正确'
    };
    
    // 在开发环境中添加更多信息
    if (process.env.NODE_ENV === 'development') {
        notFoundResponse.availableRoutes = [
            'GET /',
            'GET /health',
            'GET /proxy/video?url=<videoUrl>',
            'GET /proxy/<segmentPath>?base=<baseUrl>',
            'POST /check-video'
        ];
    }
    
    res.status(404).json(notFoundResponse);
});

// 性能监控端点
app.get('/performance/stats', (req, res) => {
    const cacheStats = cacheManager.getStats();
    const connectionStats = {
        activeConnections: connectionPool.activeConnections,
        maxConnections: PERFORMANCE_CONFIG.MAX_CONCURRENT_CONNECTIONS,
        queueLength: connectionPool.queue.length,
        utilizationRate: (connectionPool.activeConnections / PERFORMANCE_CONFIG.MAX_CONCURRENT_CONNECTIONS * 100).toFixed(2) + '%'
    };

    res.json({
        timestamp: new Date().toISOString(),
        cache: cacheStats,
        connections: connectionStats,
        config: {
            maxConcurrentConnections: PERFORMANCE_CONFIG.MAX_CONCURRENT_CONNECTIONS,
            requestTimeout: PERFORMANCE_CONFIG.REQUEST_TIMEOUT,
            cacheSizeLimit: PERFORMANCE_CONFIG.CACHE_SIZE_LIMIT,
            prefetchSegments: PERFORMANCE_CONFIG.PREFETCH_SEGMENTS
        },
        system: {
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime(),
            nodeVersion: process.version
        }
    });
});

// 并发预加载HLS片段端点
app.post('/performance/prefetch', async (req, res) => {
    const { segments, baseUrl } = req.body;
    
    if (!segments || !Array.isArray(segments) || !baseUrl) {
        return res.status(400).json({ error: '缺少必要的参数' });
    }
    
    try {
        // 构建完整的片段URL列表
        const segmentUrls = segments.map(segment => {
            if (segment.startsWith('http')) {
                return segment;
            } else {
                return new URL(segment, baseUrl).href;
            }
        });

        // 使用并发请求处理
        const results = await httpClient.concurrentRequests(segmentUrls.slice(0, PERFORMANCE_CONFIG.PREFETCH_SEGMENTS));
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        res.json({
            success: true,
            totalRequested: results.length,
            successful,
            failed,
            results: results.map(r => ({
                url: r.url,
                success: r.success,
                error: r.error?.message
            }))
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: '预加载失败',
            details: error.message
        });
    }
});

// 缓存清理端点
app.post('/performance/cache/clear', (req, res) => {
    const { type } = req.body;
    
    if (type === 'all') {
        cacheManager.cache.clear();
        cacheManager.stats.size = 0;
        cacheManager.stats.hits = 0;
        cacheManager.stats.misses = 0;
    } else if (type === 'expired') {
        const now = Date.now();
        let clearedCount = 0;
        
        for (const [key, item] of cacheManager.cache) {
            if (now - item.timestamp > 300000) { // 5分钟
                cacheManager.cache.delete(key);
                cacheManager.stats.size -= item.size;
                clearedCount++;
            }
        }
    }
    
    res.json({
        success: true,
        message: type === 'all' ? '所有缓存已清理' : '过期缓存已清理',
        cacheStats: cacheManager.getStats()
    });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 Video Space 服务器已启动!`);
    console.log(`📱 本地访问: http://localhost:${PORT}`);
    console.log(`🔗 代理端点: http://localhost:${PORT}/proxy/video?url=<视频URL>`);
    console.log(`⚡ 环境: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔧 性能优化已启用:`);
    console.log(`   • 最大并发连接数: ${PERFORMANCE_CONFIG.MAX_CONCURRENT_CONNECTIONS}`);
    console.log(`   • 连接池和复用: ${PERFORMANCE_CONFIG.ENABLE_KEEP_ALIVE ? '已启用' : '已禁用'}`);
    console.log(`   • 内存缓存: ${PERFORMANCE_CONFIG.CACHE_SIZE_LIMIT}MB`);
    console.log(`   • 并发预加载: ${PERFORMANCE_CONFIG.PREFETCH_SEGMENTS} 个片段`);
    console.log(`📊 性能监控: http://localhost:${PORT}/performance/stats`);
    console.log(`🚀 预加载API: POST http://localhost:${PORT}/performance/prefetch`);
});
