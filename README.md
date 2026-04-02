# Lightweight Auto Image Translator

一个轻量独立的油猴脚本，用于在指定网站上自动翻译匹配选择器中的图片。

本项目使用了 [Cotrans](https://cotrans.touhou.ai/) 提供的图片翻译服务：
- 提交图片到 `https://api.cotrans.touhou.ai/task/upload/v1`
- 轮询翻译任务状态
- 下载返回的 `translation_mask`
- 在本地浏览器中将原图与翻译结果合成为最终图片

## 特性

- 轻量独立，无需依赖原版大脚本
- 使用 `==UserConfig==` 提供用户可配置项
- 按域名和 CSS 选择器自动匹配需要翻译的图片
- 自动监听动态内容，适配懒加载和局部刷新场景
- 上传前自动缩放超大图片，避免超过接口常见限制
- 采用油猴跨域请求能力下载原图、提交任务、轮询结果
- 在屏幕右下角显示全局翻译进度
- 提示面板鼠标穿透，不影响查看图片或原页面交互

## 工作原理

脚本会在命中的页面里：

1. 找出符合站点规则的 `img` 元素
2. 下载图片原始内容
3. 将图片提交给 Cotrans 服务
4. 轮询翻译进度直到完成
5. 下载翻译结果图层
6. 在本地 Canvas 中与原图合成
7. 用合成后的图片替换页面中的原图片

## 安装方式

1. 安装支持 `GM.xmlHttpRequest` 与 `GM.getValue` 的用户脚本管理器
   - 例如 Tampermonkey、Violentmonkey
2. 导入 `auto-image-translator.user.js`
3. 在脚本管理器中打开脚本配置面板
4. 填写站点规则和必要参数

## 必要配置

这个脚本最关键的配置是站点规则。

### `site.rulesText`

每行一条规则，格式如下：

```text
hostname|selector
```

例如：

```text
www.pixiv.net|img
twitter.com|article img
x.com|article img
```

含义：
- `hostname`：要匹配的域名
- `selector`：在该域名页面中需要自动翻译的图片选择器

如果没有正确配置这个字段，脚本不会找到任何要翻译的图片。

## 主要配置项

### 基础配置

- `basic.apiBaseUrl`
  - Cotrans API 地址
  - 默认值：`https://api.cotrans.touhou.ai`

- `basic.pollInterval`
  - 轮询翻译任务状态的间隔，单位毫秒

- `basic.pollTimeout`
  - 单个翻译任务的最长等待时间，单位毫秒

- `basic.maxImageSize`
  - 上传前允许的最大图片边长，超出时会自动缩放

- `basic.requestTimeout`
  - 单次网络请求超时，单位毫秒

### 翻译配置

- `translation.targetLanguage`
  - 目标语言代码
  - 常见示例：`CHS`、`CHT`、`JPN`、`ENG`

- `translation.translator`
  - 发送给 Cotrans API 的 `translator` 参数
  - 默认值：`gpt3.5`

- `translation.textDetector`
  - 发送给 Cotrans API 的 `detector` 参数
  - 默认值：`default`

- `translation.renderTextOrientation`
  - 发送给 Cotrans API 的 `direction` 参数
  - 可选值：`auto`、`horizontal`、`vertical`

- `translation.detectionResolution`
  - 发送给 Cotrans API 的 `size` 参数
  - 可选值：`S`、`M`、`L`、`X`

- `translation.forceRetry`
  - 是否忽略服务端缓存并强制重新翻译

## 当前实现边界

当前脚本主要面向常规网页中的 `img` 元素，适合以下场景：
- 普通图片列表
- 动态插入的图片节点
- 懒加载后 `src` / `srcset` 变化的图片

当前不保证完美覆盖以下情况：
- 背景图 `background-image`
- 复杂的 `<picture>` / `<source>` 自定义取图逻辑
- 需要专门鉴权或特殊 Referer 策略的站点
- 站点本身对原图链接做了严格保护的场景

## 注意事项

- 本项目依赖 [Cotrans](https://cotrans.touhou.ai/) 的在线服务能力
- 请合理控制调用频率，避免在大量图片页面上无差别翻译
- 若某些站点图片无法下载，通常需要更具体的站点规则或额外适配
- 翻译结果质量与服务端检测器、翻译器、原图清晰度有关

## 项目文件

- `auto-image-translator.user.js`：主脚本
- `用户配置.md`：`==UserConfig==` 用法说明
- `a.user.js`：参考 API 来源脚本
