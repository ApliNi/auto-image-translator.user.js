# Lightweight Auto Image Translator

轻量油猴脚本：在指定网站上自动翻译匹配选择器中的图片。

默认配置使用 https://cotrans.touhou.ai/ 图片翻译服务。脚本会下载原图、提交翻译、轮询结果，并在浏览器本地合成最终图片。

## 功能

- 按域名和 CSS 选择器自动翻译图片
- 监听动态内容，适配懒加载和局部刷新
- 上传前自动缩放超大图片
- 显示全局翻译进度
- 缓存最近翻译结果，默认 100 张，支持持久化缓存
- 支持脚本菜单：切换本站翻译、清空缓存、下载缓存中的翻译图片

## 安装

1. 使用脚本管理器导入 `auto-image-translator.user.js`
2. 在脚本配置里填写站点规则

## 站点规则

`site.rulesText` 每行一条，格式：

```text
hostname|selector
```

示例：

```text
www.pixiv.net|img
x.com|article img
```

## 主要配置

### basic

- `pollInterval`：轮询间隔
- `pollTimeout`：轮询超时
- `maxImageSize`：上传前最大边长
- `recentImageCacheSize`：最近图片缓存数，`0` 表示禁用

### translation

- `apiBaseUrl`：Cotrans API 地址
- `requestTimeout`：请求超时
- `targetLanguage`：目标语言，如 `CHS` / `ENG`
- `translator`：翻译器
- `textDetector`：文本检测器
- `renderTextOrientation`：文本方向
- `detectionResolution`：检测分辨率
- `forceRetry`：强制重新翻译

## 菜单

- `切换本站翻译`：临时关闭/恢复当前站点翻译；关闭时恢复原图
- `清空翻译缓存`：清空内存和持久化缓存
- `下载翻译图片`：按缓存中的请求时间顺序下载图片

下载文件名格式：

```text
时间戳_小数_哈希值.后缀名
```

## 说明

- 主要面向普通网页中的 `img` 元素
- 不处理 `background-image` 等非 `img` 场景
- 翻译效果和可用性依赖目标站点、原图质量与 Cotrans 服务

---

友链: https://linux.do/
