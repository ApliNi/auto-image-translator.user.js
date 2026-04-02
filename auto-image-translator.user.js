// ==UserScript==
// @name         Lightweight Auto Image Translator
// @name:zh-CN   轻量自动图片翻译器
// @namespace    https://cotrans.touhou.ai/userscript/#lightweight-auto
// @version      0.1.0
// @description  Automatically translate matched images on configured websites
// @description:zh-CN  在配置的网站上自动翻译匹配选择器内的所有图片
// @author       OpenCode
// @license      GPL-3.0
// @match        *://*/*
// @connect      api.cotrans.touhou.ai
// @connect      *
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

/* ==UserConfig==
basic:
  apiBaseUrl:
    title: API 地址
    description: Cotrans API 基础地址
    type: text
    default: https://api.cotrans.touhou.ai
  pollInterval:
    title: 轮询间隔
    description: 查询翻译任务状态的轮询间隔
    type: number
    default: 1000
    min: 200
    max: 10000
    unit: ms
  pollTimeout:
    title: 轮询超时
    description: 单个翻译任务最长等待时间
    type: number
    default: 300000
    min: 10000
    max: 1800000
    unit: ms
  maxImageSize:
    title: 最大图片边长
    description: 上传前缩放到不超过该边长
    type: number
    default: 4096
    min: 512
    max: 8192
    unit: px
  requestTimeout:
    title: 请求超时
    description: 单次网络请求超时时间
    type: number
    default: 120000
    min: 5000
    max: 600000
    unit: ms
translation:
  targetLanguage:
    title: 目标语言
    description: 翻译目标语言代码，例如 CHS、CHT、JPN、ENG
    type: text
    default: CHS
  translator:
    title: 翻译器
    description: 发送给 Cotrans API 的 translator 参数
    type: text
    default: gpt3.5
  textDetector:
    title: 文本检测器
    description: 发送给 Cotrans API 的 detector 参数
    type: text
    default: default
  renderTextOrientation:
    title: 文本方向
    description: 发送给 Cotrans API 的 direction 参数
    type: select
    default: auto
    values: [auto, horizontal, vertical]
  detectionResolution:
    title: 检测分辨率
    description: 发送给 Cotrans API 的 size 参数
    type: select
    default: M
    values: [S, M, L, X]
  forceRetry:
    title: 强制重试
    description: 是否忽略服务端缓存重新翻译
    type: checkbox
    default: false
site:
  rulesText:
    title: 站点规则
    description: 每行一条规则，格式为 hostname|selector，例如 www.pixiv.net|img
    type: textarea
    default: example.com|img
 ==/UserConfig== */

/* eslint-disable no-undef */

const GMX = (() => {
  const xmlHttpRequest = typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function'
    ? GM.xmlHttpRequest.bind(GM)
    : typeof GM_xmlhttpRequest === 'function'
      ? GM_xmlhttpRequest
      : null

  if (!xmlHttpRequest) {
    throw new Error('[Auto Image Translator] GM.xmlHttpRequest is required')
  }

  return (options) => new Promise((resolve, reject) => {
    xmlHttpRequest({
      ...options,
      onload(response) {
        options.onload?.(response)
        resolve(response)
      },
      onerror(error) {
        options.onerror?.(error)
        reject(error)
      },
    })
  })
})()

const DEFAULT_CONFIG = {
  apiBaseUrl: 'https://api.cotrans.touhou.ai',
  pollInterval: 1000,
  pollTimeout: 300000,
  maxImageSize: 4096,
  requestTimeout: 120000,
  targetLanguage: 'CHS',
  translator: 'gpt3.5',
  textDetector: 'default',
  renderTextOrientation: 'auto',
  detectionResolution: 'M',
  forceRetry: false,
  observeAttributeFilter: ['src', 'srcset'],
  rulesText: 'example.com|img',
}

function getGMValueAccessor() {
  if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') {
    return (key, defaultValue) => GM.getValue(key, defaultValue)
  }
  if (typeof GM_getValue === 'function') {
    return (key, defaultValue) => Promise.resolve(GM_getValue(key, defaultValue))
  }
  return (key, defaultValue) => Promise.resolve(defaultValue)
}

const getGMValue = getGMValueAccessor()

function toNumber(value, fallback) {
  const nextValue = Number(value)
  return Number.isFinite(nextValue) ? nextValue : fallback
}

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function parseSiteRules(rulesText) {
  return String(rulesText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf('|')
      if (separatorIndex === -1) return null
      const hostname = line.slice(0, separatorIndex).trim()
      const selector = line.slice(separatorIndex + 1).trim()
      if (!hostname || !selector) return null
      return { hostname, selector }
    })
    .filter(Boolean)
}

async function loadConfig() {
  const [
    apiBaseUrl,
    pollInterval,
    pollTimeout,
    maxImageSize,
    requestTimeout,
    targetLanguage,
    translator,
    textDetector,
    renderTextOrientation,
    detectionResolution,
    forceRetry,
    rulesText,
  ] = await Promise.all([
    getGMValue('basic.apiBaseUrl', DEFAULT_CONFIG.apiBaseUrl),
    getGMValue('basic.pollInterval', DEFAULT_CONFIG.pollInterval),
    getGMValue('basic.pollTimeout', DEFAULT_CONFIG.pollTimeout),
    getGMValue('basic.maxImageSize', DEFAULT_CONFIG.maxImageSize),
    getGMValue('basic.requestTimeout', DEFAULT_CONFIG.requestTimeout),
    getGMValue('translation.targetLanguage', DEFAULT_CONFIG.targetLanguage),
    getGMValue('translation.translator', DEFAULT_CONFIG.translator),
    getGMValue('translation.textDetector', DEFAULT_CONFIG.textDetector),
    getGMValue('translation.renderTextOrientation', DEFAULT_CONFIG.renderTextOrientation),
    getGMValue('translation.detectionResolution', DEFAULT_CONFIG.detectionResolution),
    getGMValue('translation.forceRetry', DEFAULT_CONFIG.forceRetry),
    getGMValue('site.rulesText', DEFAULT_CONFIG.rulesText),
  ])

  const siteRules = parseSiteRules(rulesText)

  return {
    apiBaseUrl: String(apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl),
    pollInterval: toNumber(pollInterval, DEFAULT_CONFIG.pollInterval),
    pollTimeout: toNumber(pollTimeout, DEFAULT_CONFIG.pollTimeout),
    maxImageSize: toNumber(maxImageSize, DEFAULT_CONFIG.maxImageSize),
    requestTimeout: toNumber(requestTimeout, DEFAULT_CONFIG.requestTimeout),
    targetLanguage: String(targetLanguage || DEFAULT_CONFIG.targetLanguage),
    translator: String(translator || DEFAULT_CONFIG.translator),
    textDetector: String(textDetector || DEFAULT_CONFIG.textDetector),
    renderTextOrientation: String(renderTextOrientation || DEFAULT_CONFIG.renderTextOrientation),
    detectionResolution: String(detectionResolution || DEFAULT_CONFIG.detectionResolution),
    forceRetry: parseBoolean(forceRetry, DEFAULT_CONFIG.forceRetry),
    observeAttributeFilter: [...DEFAULT_CONFIG.observeAttributeFilter],
    siteRules: siteRules.length ? siteRules : parseSiteRules(DEFAULT_CONFIG.rulesText),
  }
}

let CONFIG

const translationTaskCache = new Map()
const elementSourceCache = new WeakMap()
const processingElements = new WeakSet()
const translatedElements = new WeakSet()
let progressPanel
let hintStyleInstalled = false
let translationProgress = {
  total: 0,
  done: 0,
}

function log(...args) {
  console.log('[Auto Image Translator]', ...args)
}

function ensureHintStyle() {
  if (hintStyleInstalled) return
  const style = document.createElement('style')
  style.textContent = `
    .auto-image-translator-progress {
      position: fixed;
      right: 16px;
      bottom: 16px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      max-width: min(280px, calc(100vw - 32px));
      padding: 8px 12px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      pointer-events: none;
      color: #fff;
      background: rgba(15, 23, 42, 0.72);
      backdrop-filter: blur(4px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 0;
      transition: opacity 0.18s ease;
      z-index: 2147483647;
    }
    .auto-image-translator-progress[data-visible="true"] {
      opacity: 1;
    }
    .auto-image-translator-progress-dot {
      width: 8px;
      height: 8px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: #60a5fa;
    }
    .auto-image-translator-progress[data-state="done"] .auto-image-translator-progress-dot {
      background: #22c55e;
    }
  `
  document.head.appendChild(style)
  hintStyleInstalled = true
}

function ensureProgressPanel() {
  ensureHintStyle()
  if (progressPanel?.isConnected) return progressPanel
  progressPanel = document.createElement('div')
  progressPanel.className = 'auto-image-translator-progress'
  progressPanel.dataset.visible = 'false'
  progressPanel.innerHTML = '<span class="auto-image-translator-progress-dot"></span><span class="auto-image-translator-progress-text"></span>'
  document.documentElement.appendChild(progressPanel)
  return progressPanel
}

function renderProgressPanel() {
  const panel = ensureProgressPanel()
  const textNode = panel.querySelector('.auto-image-translator-progress-text')
  if (!(textNode instanceof HTMLElement)) return
  const hasProgress = translationProgress.total > 0
  const isActive = hasProgress && translationProgress.done < translationProgress.total
  panel.dataset.visible = hasProgress ? 'true' : 'false'
  panel.dataset.state = isActive ? 'active' : 'done'
  textNode.textContent = isActive
    ? `翻译中 ${translationProgress.done}/${translationProgress.total}`
    : `翻译完成 ${translationProgress.done}/${translationProgress.total}`
}

function beginTranslationFor(img) {
  if (translatedElements.has(img) || processingElements.has(img)) return false
  translationProgress.total += 1
  renderProgressPanel()
  return true
}

function finishTranslationFor(img) {
  if (translatedElements.has(img)) return
  translatedElements.add(img)
  translationProgress.done += 1
  renderProgressPanel()
}

function resetProgressIfIdle() {
  if (translationProgress.total === 0) return
  if (translationProgress.done < translationProgress.total) return
  window.setTimeout(() => {
    if (translationProgress.done < translationProgress.total) return
    translationProgress = { total: 0, done: 0 }
    renderProgressPanel()
  }, 1200)
}

function assertOkResponse(response, label) {
  if (!response || typeof response.status !== 'number') {
    throw new Error(`[Auto Image Translator] ${label} failed: invalid response`)
  }
  if (response.status < 200 || response.status >= 300) {
    const message = typeof response.responseText === 'string'
      ? response.responseText.slice(0, 200)
      : ''
    throw new Error(`[Auto Image Translator] ${label} failed: HTTP ${response.status}${message ? ` ${message}` : ''}`)
  }
}

function parseJsonResponse(response, label) {
  assertOkResponse(response, label)
  try {
    return JSON.parse(response.responseText)
  } catch (error) {
    throw new Error(`[Auto Image Translator] ${label} returned invalid JSON`)
  }
}

function getMatchedRule(url = location) {
  return CONFIG.siteRules.find((rule) => {
    if (!rule.hostname || !rule.selector) return false
    if (typeof rule.hostname === 'string') {
      return url.hostname === rule.hostname || url.hostname.endsWith(`.${rule.hostname}`)
    }
    if (rule.hostname instanceof RegExp) {
      return rule.hostname.test(url.hostname)
    }
    return false
  })
}

function getImageUrl(img) {
  return img.currentSrc || img.src || img.getAttribute('src') || ''
}

function getFileSuffix(url) {
  try {
    const pathname = new URL(url, location.href).pathname
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/)
    return match?.[1]?.toLowerCase() || 'png'
  } catch (error) {
    return 'png'
  }
}

function shouldTranslate(img) {
  if (!(img instanceof HTMLImageElement)) return false
  if (!img.isConnected) return false
  const src = getImageUrl(img)
  if (!src) return false
  if (src.startsWith('blob:')) return false
  return true
}

async function blobToImage(blob) {
  const blobUrl = URL.createObjectURL(blob)
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = (error) => reject(error)
      img.src = blobUrl
    })
    return image
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

async function resizeToSubmit(blob, suffix) {
  const img = await blobToImage(blob)
  const width = img.width
  const height = img.height
  if (width <= CONFIG.maxImageSize && height <= CONFIG.maxImageSize) {
    return { blob, suffix }
  }
  const scale = Math.min(CONFIG.maxImageSize / width, CONFIG.maxImageSize / height)
  const resizedWidth = Math.floor(width * scale)
  const resizedHeight = Math.floor(height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = resizedWidth
  canvas.height = resizedHeight
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('[Auto Image Translator] Canvas 2D context is unavailable')
  }
  context.imageSmoothingQuality = 'high'
  context.drawImage(img, 0, 0, resizedWidth, resizedHeight)
  const resizedBlob = await new Promise((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) {
        resolve(nextBlob)
        return
      }
      reject(new Error('[Auto Image Translator] Canvas toBlob failed'))
    }, 'image/png')
  })
  return {
    blob: resizedBlob,
    suffix: 'png',
  }
}

async function downloadBlob(url, headers = {}) {
  const response = await GMX({
    method: 'GET',
    url,
    headers,
    responseType: 'blob',
    timeout: CONFIG.requestTimeout,
  })
  assertOkResponse(response, `download ${url}`)
  return response.response
}

async function submitTranslate(blob, suffix) {
  const formData = new FormData()
  formData.append('file', blob, `image.${suffix}`)
  formData.append('target_language', CONFIG.targetLanguage)
  formData.append('detector', CONFIG.textDetector)
  formData.append('direction', CONFIG.renderTextOrientation)
  formData.append('translator', CONFIG.translator)
  formData.append('size', CONFIG.detectionResolution)
  formData.append('retry', CONFIG.forceRetry ? 'true' : 'false')
  const response = await GMX({
    method: 'POST',
    url: `${CONFIG.apiBaseUrl}/task/upload/v1`,
    data: formData,
    timeout: CONFIG.requestTimeout,
  })
  return parseJsonResponse(response, 'submit translate')
}

async function pullTranslationStatusPolling(id) {
  const startedAt = Date.now()
  while (true) {
    const response = await GMX({
      method: 'GET',
      url: `${CONFIG.apiBaseUrl}/task/${id}/status/v1`,
      timeout: CONFIG.requestTimeout,
    })
    const message = parseJsonResponse(response, `poll task ${id}`)
    if (message.type === 'result') return message.result
    if (message.type === 'error') {
      throw new Error(`[Auto Image Translator] Translation failed: ${message.error_id}`)
    }
    if (Date.now() - startedAt > CONFIG.pollTimeout) {
      throw new Error(`[Auto Image Translator] Polling timed out for task ${id}`)
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIG.pollInterval))
  }
}

async function mergeImages(baseBlob, maskBlob) {
  const [baseImage, maskImage] = await Promise.all([
    blobToImage(baseBlob),
    blobToImage(maskBlob),
  ])
  const canvas = document.createElement('canvas')
  canvas.width = baseImage.width
  canvas.height = baseImage.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('[Auto Image Translator] Canvas 2D context is unavailable')
  }
  context.drawImage(baseImage, 0, 0)
  context.drawImage(maskImage, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      reject(new Error('[Auto Image Translator] Canvas toBlob failed'))
    }, 'image/png')
  })
}

async function translateImageUrl(imageUrl) {
  if (translationTaskCache.has(imageUrl)) {
    return translationTaskCache.get(imageUrl)
  }
  const task = (async () => {
    let originalBlob
    try {
      originalBlob = await downloadBlob(imageUrl)
    } catch (error) {
      const refererUrl = `${location.origin}/`
      originalBlob = await downloadBlob(imageUrl, { referer: refererUrl })
    }
    const originalSuffix = getFileSuffix(imageUrl)
    const resized = await resizeToSubmit(originalBlob, originalSuffix)
    const submission = await submitTranslate(resized.blob, resized.suffix)
    let maskUrl = submission.result?.translation_mask
    if (!maskUrl) {
      const result = await pullTranslationStatusPolling(submission.id)
      maskUrl = result.translation_mask
    }
    if (!maskUrl) {
      throw new Error('[Auto Image Translator] Missing translation mask url')
    }
    const maskBlob = await downloadBlob(maskUrl)
    const translatedBlob = await mergeImages(resized.blob, maskBlob)
    return URL.createObjectURL(translatedBlob)
  })()
  translationTaskCache.set(imageUrl, task)
  try {
    return await task
  } finally {
    translationTaskCache.delete(imageUrl)
  }
}

async function translateImageElement(img) {
  if (!shouldTranslate(img)) return
  const imageUrl = getImageUrl(img)
  if (!imageUrl) return
  const cachedSource = elementSourceCache.get(img)
  if (cachedSource === imageUrl) return
  if (processingElements.has(img)) return
  if (!beginTranslationFor(img)) return
  processingElements.add(img)
  try {
    const translatedUrl = await translateImageUrl(imageUrl)
    if (!img.isConnected) return
    if (getImageUrl(img) !== imageUrl) return
    img.src = translatedUrl
    img.removeAttribute('srcset')
    elementSourceCache.set(img, imageUrl)
  } catch (error) {
    log('translate failed', imageUrl, error)
  } finally {
    processingElements.delete(img)
    finishTranslationFor(img)
    resetProgressIfIdle()
  }
}

function collectMatchedImages(rule, root = document) {
  const scope = root instanceof Element || root instanceof Document ? root : document
  const elements = []
  if (scope instanceof Element && scope.matches(rule.selector)) {
    elements.push(scope)
  }
  return elements.concat(Array.from(scope.querySelectorAll(rule.selector)))
}

function scheduleTranslate(rule, root = document) {
  for (const img of collectMatchedImages(rule, root)) {
    translateImageElement(img)
  }
}

function startObserver(rule) {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLImageElement) {
        translateImageElement(mutation.target)
        continue
      }
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) {
          scheduleTranslate(rule, node)
        }
      }
    }
  })
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: CONFIG.observeAttributeFilter,
  })
}

async function main() {
  CONFIG = await loadConfig()
  const rule = getMatchedRule()
  if (!rule) {
    log('no site rule matched')
    return
  }
  scheduleTranslate(rule)
  startObserver(rule)
  log('started', {
    hostname: location.hostname,
    selector: rule.selector,
  })
}

main().catch((error) => {
  log('startup failed', error)
})
