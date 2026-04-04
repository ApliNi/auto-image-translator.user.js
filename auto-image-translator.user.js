// ==UserScript==
// @name         Lightweight Auto Image Translator
// @name:zh-CN   轻量自动图片翻译器
// @namespace    https://github.com/ApliNi/auto-image-translator.user.js
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
// @grant        GM.setValue
// @grant        GM_setValue
// @grant        GM.registerMenuCommand
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

/* ==UserConfig==
basic:
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
  recentImageCacheSize:
    title: 最近图片缓存数
    description: 缓存最近翻译结果的图片数量，0 表示禁用
    type: number
    default: 100
    min: 0
translation:
  apiBaseUrl:
    title: API 地址
    description: Cotrans API 基础地址
    type: text
    default: https://api.cotrans.touhou.ai
  requestTimeout:
    title: 请求超时
    description: 单次网络请求超时时间
    type: number
    default: 120000
    min: 5000
    max: 600000
    unit: ms
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
    let settled = false
    const resolveOnce = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    xmlHttpRequest({
      ...options,
      onload(response) {
        options.onload?.(response)
        resolveOnce(response)
      },
      onerror(error) {
        options.onerror?.(error)
        rejectOnce(error)
      },
      ontimeout(error) {
        options.ontimeout?.(error)
        rejectOnce(error || new Error('[Auto Image Translator] request timed out'))
      },
      onabort(error) {
        options.onabort?.(error)
        rejectOnce(error || new Error('[Auto Image Translator] request aborted'))
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
  recentImageCacheSize: 100,
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

function getGMSetValueAccessor() {
  if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') {
    return (key, value) => GM.setValue(key, value)
  }
  if (typeof GM_setValue === 'function') {
    return (key, value) => Promise.resolve(GM_setValue(key, value))
  }
  return () => Promise.resolve()
}

const setGMValue = getGMSetValueAccessor()

function getGMRegisterMenuCommandAccessor() {
  if (typeof GM !== 'undefined' && typeof GM.registerMenuCommand === 'function') {
    return GM.registerMenuCommand.bind(GM)
  }
  if (typeof GM_registerMenuCommand === 'function') {
    return GM_registerMenuCommand
  }
  return null
}

const registerMenuCommand = getGMRegisterMenuCommandAccessor()

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
  const apiBaseUrl = await getGMValue('translation.apiBaseUrl', await getGMValue('basic.apiBaseUrl', DEFAULT_CONFIG.apiBaseUrl))
  const requestTimeout = await getGMValue('translation.requestTimeout', await getGMValue('basic.requestTimeout', DEFAULT_CONFIG.requestTimeout))
  const [
    pollInterval,
    pollTimeout,
    maxImageSize,
    recentImageCacheSize,
    targetLanguage,
    translator,
    textDetector,
    renderTextOrientation,
    detectionResolution,
    forceRetry,
    rulesText,
  ] = await Promise.all([
    getGMValue('basic.pollInterval', DEFAULT_CONFIG.pollInterval),
    getGMValue('basic.pollTimeout', DEFAULT_CONFIG.pollTimeout),
    getGMValue('basic.maxImageSize', DEFAULT_CONFIG.maxImageSize),
    getGMValue('basic.recentImageCacheSize', DEFAULT_CONFIG.recentImageCacheSize),
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
    recentImageCacheSize: Math.max(0, Math.floor(toNumber(recentImageCacheSize, DEFAULT_CONFIG.recentImageCacheSize))),
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

const PERSISTENT_CACHE_DB_NAME = 'auto-image-translator-cache'
const PERSISTENT_CACHE_STORE_NAME = 'translated-images'
const PERSISTENT_CACHE_DB_VERSION = 2

const translationTaskCache = new Map()
const translatedImageCache = new Map()
const elementSourceCache = new WeakMap()
const processingElements = new WeakSet()
let persistentCacheDbPromise
let lastRequestedAtPromise
let cacheGeneration = 0
let currentRule = null
let siteTranslationEnabled = true
let progressPanel
let hintStyleInstalled = false
let translationProgress = {
  total: 0,
  done: 0,
}
const SCAN_TIME_BUDGET_MS = 12
const SCAN_ROOT_BATCH_SIZE = 16
const TRANSLATION_QUEUE_TIMEOUT_MS = 120
const PROGRESS_RENDER_DEBOUNCE_MS = 120
const PERSISTENT_CACHE_PRUNE_DELAY_MS = 3000
const VISIBILITY_ROOT_MARGIN = '400px 0px'
const DEFAULT_TRANSLATION_CONCURRENCY = Math.max(4, Math.min(10, Number(globalThis.navigator?.hardwareConcurrency) || 6))
const CPU_STAGE_CONCURRENCY = 1
const APPLY_BATCH_SIZE = 1
const SCROLL_IDLE_WINDOW_MS = 180
const SCROLL_CPU_MAX_WAIT_MS = 800
const SCROLL_APPLY_MAX_WAIT_MS = 1200
const SCROLL_POLL_INTERVAL_MS = 50
const pendingScanRoots = new Set()
const pendingTranslationElements = new Set()
const pendingApplyEntries = []
let scanFlushScheduled = false
let translationFlushScheduled = false
let applyFlushScheduled = false
let activeTranslationCount = 0
let progressRenderTimer = 0
let persistentCachePruneTimer = 0
let persistentCachePrunePromise = null
let persistentCachePruneRequested = false
let visibilityObserver = null
let translationSessionGeneration = 0
let lastScrollAt = 0
let scrollTrackingStarted = false
let imageWorker = null
let imageWorkerPromise = null
let imageWorkerAvailable = true
let imageWorkerTaskId = 0
const imageWorkerTasks = new Map()
const cpuStageGate = {
  activeCount: 0,
  waiters: [],
}

function buildImageWorkerSource() {
  return String.raw`
    let offscreenCanvasSupported = typeof OffscreenCanvas !== 'undefined'
      && typeof OffscreenCanvas.prototype?.getContext === 'function'
      && typeof OffscreenCanvas.prototype?.convertToBlob === 'function'
    let imageBitmapSupported = typeof createImageBitmap === 'function'
    let subtleSupported = !!globalThis.crypto?.subtle

    async function sha256Hex(blob) {
      if (!subtleSupported) {
        const error = new Error('crypto.subtle is unavailable in worker')
        error.code = 'UNSUPPORTED'
        throw error
      }
      const buffer = await blob.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', buffer)
      const bytes = new Uint8Array(digest)
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    }

    async function decodeImage(blob) {
      if (!imageBitmapSupported) {
        const error = new Error('createImageBitmap is unavailable in worker')
        error.code = 'UNSUPPORTED'
        throw error
      }
      return createImageBitmap(blob)
    }

    function createCanvas(width, height) {
      if (!offscreenCanvasSupported) {
        const error = new Error('OffscreenCanvas is unavailable in worker')
        error.code = 'UNSUPPORTED'
        throw error
      }
      return new OffscreenCanvas(width, height)
    }

    async function resizeImage(blob, suffix, maxImageSize) {
      const image = await decodeImage(blob)
      try {
        const width = image.width
        const height = image.height
        if (width <= maxImageSize && height <= maxImageSize) {
          return { blob, suffix }
        }
        const scale = Math.min(maxImageSize / width, maxImageSize / height)
        const resizedWidth = Math.floor(width * scale)
        const resizedHeight = Math.floor(height * scale)
        const canvas = createCanvas(resizedWidth, resizedHeight)
        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('Canvas 2D context is unavailable in worker')
        }
        context.imageSmoothingQuality = 'high'
        context.drawImage(image, 0, 0, resizedWidth, resizedHeight)
        const resizedBlob = await canvas.convertToBlob({ type: 'image/png' })
        return {
          blob: resizedBlob,
          suffix: 'png',
        }
      } finally {
        image.close?.()
      }
    }

    async function mergeImages(baseBlob, maskBlob) {
      const [baseImage, maskImage] = await Promise.all([
        decodeImage(baseBlob),
        decodeImage(maskBlob),
      ])
      try {
        const canvas = createCanvas(baseImage.width, baseImage.height)
        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('Canvas 2D context is unavailable in worker')
        }
        context.drawImage(baseImage, 0, 0)
        context.drawImage(maskImage, 0, 0)
        return canvas.convertToBlob({ type: 'image/png' })
      } finally {
        baseImage.close?.()
        maskImage.close?.()
      }
    }

    self.onmessage = async (event) => {
      const { id, type, payload } = event.data || {}
      try {
        let result
        if (type === 'sha256') {
          result = { imageHash: await sha256Hex(payload.blob) }
        } else if (type === 'resize') {
          result = await resizeImage(payload.blob, payload.suffix, payload.maxImageSize)
        } else if (type === 'merge') {
          result = { blob: await mergeImages(payload.baseBlob, payload.maskBlob) }
        } else {
          throw new Error('Unknown worker task type')
        }
        self.postMessage({ id, result })
      } catch (error) {
        self.postMessage({
          id,
          error: {
            message: error?.message || String(error),
            code: error?.code || '',
          },
        })
      }
    }
  `
}

function log(...args) {
  console.log('[Auto Image Translator]', ...args)
}

function notify(message) {
  log(message)
}

function getSiteTranslationDisabledKey() {
  return `site.disabled.${location.hostname}`
}

async function loadSiteTranslationEnabled() {
  const disabled = await getGMValue(getSiteTranslationDisabledKey(), false)
  return !parseBoolean(disabled, false)
}

async function setSiteTranslationEnabled(enabled) {
  siteTranslationEnabled = enabled
  await setGMValue(getSiteTranslationDisabledKey(), !enabled)
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

function scheduleProgressRender() {
  if (progressRenderTimer) return
  progressRenderTimer = window.setTimeout(() => {
    progressRenderTimer = 0
    renderProgressPanel()
  }, PROGRESS_RENDER_DEBOUNCE_MS)
}

function beginTranslationFor(img) {
  if (processingElements.has(img)) return false
  translationProgress.total += 1
  scheduleProgressRender()
  return true
}

function finishTranslationFor(img) {
  translationProgress.done += 1
  scheduleProgressRender()
}

function resetProgressIfIdle() {
  if (translationProgress.total === 0) return
  if (translationProgress.done < translationProgress.total) return
  window.setTimeout(() => {
    if (translationProgress.done < translationProgress.total) return
    translationProgress = { total: 0, done: 0 }
    scheduleProgressRender()
  }, 1200)
}

function runWhenMainThreadAvailable(callback, timeout = TRANSLATION_QUEUE_TIMEOUT_MS) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(callback, { timeout })
    return
  }
  window.setTimeout(() => {
    callback({
      didTimeout: true,
      timeRemaining: () => 0,
    })
  }, 0)
}

function nextAnimationFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
      return
    }
    window.setTimeout(resolve, 16)
  })
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function noteUserScrollActivity() {
  lastScrollAt = Date.now()
}

function isWithinScrollWindow() {
  return Date.now() - lastScrollAt < SCROLL_IDLE_WINDOW_MS
}

async function waitForScrollIdle(maxWaitMs) {
  if (!isWithinScrollWindow()) return
  const startedAt = Date.now()
  while (isWithinScrollWindow()) {
    if (Date.now() - startedAt >= maxWaitMs) {
      return
    }
    await delay(SCROLL_POLL_INTERVAL_MS)
  }
}

function startScrollTracking() {
  if (scrollTrackingStarted) return
  const listenerOptions = { passive: true, capture: true }
  window.addEventListener('scroll', noteUserScrollActivity, listenerOptions)
  window.addEventListener('wheel', noteUserScrollActivity, listenerOptions)
  window.addEventListener('touchmove', noteUserScrollActivity, listenerOptions)
  scrollTrackingStarted = true
}

function acquireConcurrencySlot(gate, limit) {
  if (gate.activeCount < limit) {
    gate.activeCount += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    gate.waiters.push(resolve)
  }).then(() => {
    gate.activeCount += 1
  })
}

function releaseConcurrencySlot(gate) {
  gate.activeCount = Math.max(0, gate.activeCount - 1)
  const nextResolve = gate.waiters.shift()
  if (nextResolve) {
    nextResolve()
  }
}

async function ensureImageWorker() {
  if (!imageWorkerAvailable) return null
  if (imageWorker) return imageWorker
  if (imageWorkerPromise) return imageWorkerPromise
  imageWorkerPromise = Promise.resolve().then(() => {
    if (typeof Worker === 'undefined' || typeof URL?.createObjectURL !== 'function') {
      imageWorkerAvailable = false
      return null
    }
    const source = buildImageWorkerSource()
    const blob = new Blob([source], { type: 'text/javascript' })
    const workerUrl = URL.createObjectURL(blob)
    try {
      const worker = new Worker(workerUrl)
      worker.onmessage = (event) => {
        const { id, result, error } = event.data || {}
        const task = imageWorkerTasks.get(id)
        if (!task) return
        imageWorkerTasks.delete(id)
        if (error) {
          const workerError = new Error(error.message || 'Worker task failed')
          workerError.code = error.code || ''
          task.reject(workerError)
          return
        }
        task.resolve(result)
      }
      worker.onmessageerror = (event) => {
        imageWorkerAvailable = false
        const error = new Error(event?.message || '[Auto Image Translator] image worker message error')
        for (const [, task] of imageWorkerTasks) {
          task.reject(error)
        }
        imageWorkerTasks.clear()
        try {
          worker.terminate()
        } catch (terminateError) {
          log('terminate image worker failed', terminateError)
        }
        imageWorker = null
      }
      worker.onerror = (event) => {
        imageWorkerAvailable = false
        const error = event?.error || new Error(event?.message || '[Auto Image Translator] image worker crashed')
        for (const [, task] of imageWorkerTasks) {
          task.reject(error)
        }
        imageWorkerTasks.clear()
        try {
          worker.terminate()
        } catch (terminateError) {
          log('terminate image worker failed', terminateError)
        }
        imageWorker = null
      }
      imageWorker = worker
      return worker
    } catch (error) {
      imageWorkerAvailable = false
      return null
    } finally {
      URL.revokeObjectURL(workerUrl)
    }
  }).finally(() => {
    imageWorkerPromise = null
  })
  return imageWorkerPromise
}

async function runImageWorkerTask(type, payload, transfer = []) {
  const worker = await ensureImageWorker()
  if (!worker) {
    return null
  }
  return new Promise((resolve, reject) => {
    const id = `image-worker-${++imageWorkerTaskId}`
    imageWorkerTasks.set(id, { resolve, reject })
    try {
      worker.postMessage({ id, type, payload }, transfer)
    } catch (error) {
      imageWorkerTasks.delete(id)
      reject(error)
    }
  })
}

function shouldReleaseTranslatedUrl(imageUrl, translatedUrl) {
  if (!translatedUrl || !translatedUrl.startsWith('blob:')) return false
  return translatedImageCache.get(imageUrl) !== translatedUrl
}

function releaseTranslatedUrlIfOwned(imageUrl, translatedUrl) {
  if (!shouldReleaseTranslatedUrl(imageUrl, translatedUrl)) return
  URL.revokeObjectURL(translatedUrl)
}

async function runCpuStage(task) {
  await acquireConcurrencySlot(cpuStageGate, CPU_STAGE_CONCURRENCY)
  try {
    await waitForScrollIdle(SCROLL_CPU_MAX_WAIT_MS)
    await nextAnimationFrame()
    return await task()
  } finally {
    releaseConcurrencySlot(cpuStageGate)
  }
}

async function yieldAfterHeavyStage() {
  await nextAnimationFrame()
}

function shouldYieldToMainThread(deadline, startedAt, processedCount, batchSize = SCAN_ROOT_BATCH_SIZE) {
  if (processedCount >= batchSize) return true
  if (deadline?.didTimeout) return false
  if (typeof deadline?.timeRemaining === 'function' && deadline.timeRemaining() <= 1) {
    return true
  }
  return performance.now() - startedAt >= SCAN_TIME_BUDGET_MS
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

function requestToPromise(request, label) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error(`[Auto Image Translator] ${label} failed`))
  })
}

function transactionToPromise(transaction, label) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error(`[Auto Image Translator] ${label} failed`))
    transaction.onabort = () => reject(transaction.error || new Error(`[Auto Image Translator] ${label} aborted`))
  })
}

function openPersistentCacheDb() {
  if (persistentCacheDbPromise) return persistentCacheDbPromise
  if (typeof indexedDB === 'undefined') {
    persistentCacheDbPromise = Promise.resolve(null)
    return persistentCacheDbPromise
  }
  persistentCacheDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(PERSISTENT_CACHE_DB_NAME, PERSISTENT_CACHE_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.objectStoreNames.contains(PERSISTENT_CACHE_STORE_NAME)
        ? request.transaction.objectStore(PERSISTENT_CACHE_STORE_NAME)
        : db.createObjectStore(PERSISTENT_CACHE_STORE_NAME, { keyPath: 'cacheKey' })
      if (!store.indexNames.contains('lastAccessedAt')) {
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false })
      }
      if (!store.indexNames.contains('requestedAt')) {
        store.createIndex('requestedAt', 'requestedAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('[Auto Image Translator] open persistent cache failed'))
  })
  return persistentCacheDbPromise.catch((error) => {
    persistentCacheDbPromise = null
    throw error
  })
}

async function sha256Hex(blob) {
  const workerResult = await runImageWorkerTask('sha256', { blob })
    .catch((error) => {
      imageWorkerAvailable = false
      log('image worker sha256 failed, fallback to main thread', error)
      return null
    })
  if (workerResult?.imageHash) {
    return workerResult.imageHash
  }
  return runCpuStage(async () => {
    if (!crypto?.subtle) {
      throw new Error('[Auto Image Translator] crypto.subtle is unavailable')
    }
    const buffer = await blob.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    const bytes = new Uint8Array(digest)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  })
}

function getPersistentCacheKey(imageHash) {
  return [
    imageHash,
    CONFIG.targetLanguage,
    CONFIG.translator,
    CONFIG.textDetector,
    CONFIG.renderTextOrientation,
    CONFIG.detectionResolution,
  ].join('|')
}

async function listPersistentCacheEntries() {
  const db = await openPersistentCacheDb()
  if (!db) return []
  const transaction = db.transaction(PERSISTENT_CACHE_STORE_NAME, 'readonly')
  const store = transaction.objectStore(PERSISTENT_CACHE_STORE_NAME)
  const entries = await requestToPromise(store.getAll(), 'list persistent cache')
  await transactionToPromise(transaction, 'list persistent cache')
  return Array.isArray(entries) ? entries : []
}

async function getLatestRequestedAt() {
  const db = await openPersistentCacheDb()
  if (!db) return 0
  const transaction = db.transaction(PERSISTENT_CACHE_STORE_NAME, 'readonly')
  const store = transaction.objectStore(PERSISTENT_CACHE_STORE_NAME)
  const index = store.index('requestedAt')
  const latestRequestedAt = await new Promise((resolve, reject) => {
    const request = index.openCursor(null, 'prev')
    request.onsuccess = () => resolve(request.result?.value?.requestedAt || 0)
    request.onerror = () => reject(request.error || new Error('[Auto Image Translator] read latest requestedAt failed'))
  })
  await transactionToPromise(transaction, 'read latest requestedAt')
  return Number(latestRequestedAt) || 0
}

async function allocateRequestedAt() {
  if (!lastRequestedAtPromise) {
    lastRequestedAtPromise = getLatestRequestedAt()
  }
  const nextPromise = lastRequestedAtPromise.then((lastRequestedAt) => {
    const now = Date.now()
    const baseRequestedAt = Number(`${now}.001`)
    if (baseRequestedAt > lastRequestedAt) {
      return baseRequestedAt
    }
    return Number((lastRequestedAt + 0.001).toFixed(3))
  })
  lastRequestedAtPromise = nextPromise.catch(async () => getLatestRequestedAt())
  return nextPromise
}

async function readPersistentCacheEntry(cacheKey) {
  if (CONFIG.recentImageCacheSize <= 0) return null
  const db = await openPersistentCacheDb()
  if (!db) return null
  const transaction = db.transaction(PERSISTENT_CACHE_STORE_NAME, 'readonly')
  const store = transaction.objectStore(PERSISTENT_CACHE_STORE_NAME)
  const entry = await requestToPromise(store.get(cacheKey), `read persistent cache ${cacheKey}`)
  await transactionToPromise(transaction, `read persistent cache ${cacheKey}`)
  return entry || null
}

async function touchPersistentCacheEntry(entry) {
  if (!entry || CONFIG.recentImageCacheSize <= 0) return
  const db = await openPersistentCacheDb()
  if (!db) return
  const transaction = db.transaction(PERSISTENT_CACHE_STORE_NAME, 'readwrite')
  const store = transaction.objectStore(PERSISTENT_CACHE_STORE_NAME)
  store.put({
    ...entry,
    lastAccessedAt: Date.now(),
  })
  await transactionToPromise(transaction, `touch persistent cache ${entry.cacheKey}`)
}

async function prunePersistentCache() {
  if (CONFIG.recentImageCacheSize < 0) return
  const db = await openPersistentCacheDb()
  if (!db) return
  const maxEntries = CONFIG.recentImageCacheSize
  const transaction = db.transaction(PERSISTENT_CACHE_STORE_NAME, 'readwrite')
  const store = transaction.objectStore(PERSISTENT_CACHE_STORE_NAME)
  if (maxEntries === 0) {
    store.clear()
    await transactionToPromise(transaction, 'clear persistent cache')
    return
  }
  const entryCount = await requestToPromise(store.count(), 'count persistent cache')
  let excess = entryCount - maxEntries
  if (excess <= 0) {
    await transactionToPromise(transaction, 'prune persistent cache')
    return
  }
  const index = store.index('lastAccessedAt')
  await new Promise((resolve, reject) => {
    const request = index.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || excess <= 0) {
        resolve()
        return
      }
      cursor.delete()
      excess -= 1
      cursor.continue()
    }
    request.onerror = () => reject(request.error || new Error('[Auto Image Translator] prune persistent cache failed'))
  })
  await transactionToPromise(transaction, 'prune persistent cache')
}

function schedulePersistentCachePrune() {
  persistentCachePruneRequested = true
  if (persistentCachePruneTimer || persistentCachePrunePromise) return
  persistentCachePruneTimer = window.setTimeout(() => {
    persistentCachePruneTimer = 0
    persistentCachePruneRequested = false
    persistentCachePrunePromise = prunePersistentCache()
      .catch((error) => {
        log('persistent cache prune failed', error)
      })
      .finally(() => {
        persistentCachePrunePromise = null
        if (persistentCachePruneRequested) {
          schedulePersistentCachePrune()
        }
      })
  }, PERSISTENT_CACHE_PRUNE_DELAY_MS)
}

async function getPersistentTranslatedBlob(cacheKey) {
  const entry = await readPersistentCacheEntry(cacheKey)
  if (!entry?.blob) return null
  await touchPersistentCacheEntry(entry)
  return entry.blob
}

async function setPersistentTranslatedBlob(cacheKey, imageHash, translatedBlob) {
  if (CONFIG.recentImageCacheSize <= 0) return
  const db = await openPersistentCacheDb()
  if (!db) return
  const now = Date.now()
  const requestedAt = await allocateRequestedAt()
  const transaction = db.transaction(PERSISTENT_CACHE_STORE_NAME, 'readwrite')
  const store = transaction.objectStore(PERSISTENT_CACHE_STORE_NAME)
  store.put({
    cacheKey,
    imageHash,
    blob: translatedBlob,
    requestedAt,
    createdAt: now,
    lastAccessedAt: now,
  })
  await transactionToPromise(transaction, `write persistent cache ${cacheKey}`)
  schedulePersistentCachePrune()
}

function clearTranslatedImageCache() {
  for (const translatedUrl of translatedImageCache.values()) {
    URL.revokeObjectURL(translatedUrl)
  }
  translatedImageCache.clear()
}

function clearTranslationTaskCache() {
  translationTaskCache.clear()
}

async function clearPersistentCache() {
  if (persistentCachePruneTimer) {
    window.clearTimeout(persistentCachePruneTimer)
    persistentCachePruneTimer = 0
  }
  persistentCachePruneRequested = false
  const db = await openPersistentCacheDb()
  if (!db) return
  const transaction = db.transaction(PERSISTENT_CACHE_STORE_NAME, 'readwrite')
  transaction.objectStore(PERSISTENT_CACHE_STORE_NAME).clear()
  await transactionToPromise(transaction, 'clear persistent cache')
  lastRequestedAtPromise = Promise.resolve(0)
}

function getBlobExtension(blob) {
  const mimeType = blob?.type || 'image/png'
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/gif') return 'gif'
  return 'png'
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('[Auto Image Translator] blob to data url failed'))
    reader.readAsDataURL(blob)
  })
}

function downloadDataUrlWithAnchor(dataUrl, filename) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function downloadBlobFile(blob, filename) {
  const dataUrl = await blobToDataUrl(blob)
  downloadDataUrlWithAnchor(dataUrl, filename)
}

function formatRequestedAt(requestedAt) {
  return Number(requestedAt).toFixed(3)
}

function getDownloadRequestedAt(entry, index) {
  if (Number.isFinite(Number(entry?.requestedAt))) {
    return Number(entry.requestedAt)
  }
  if (Number.isFinite(Number(entry?.createdAt))) {
    return Number(`${Math.floor(Number(entry.createdAt))}.${String(index + 1).padStart(3, '0')}`)
  }
  return Number(`0.${String(index + 1).padStart(3, '0')}`)
}

async function downloadCachedTranslatedImages() {
  const entries = await listPersistentCacheEntries()
  const downloadableEntries = entries
    .filter((entry) => entry?.blob instanceof Blob)
    .map((entry, index) => ({
      ...entry,
      downloadRequestedAt: getDownloadRequestedAt(entry, index),
    }))
    .sort((left, right) => left.downloadRequestedAt - right.downloadRequestedAt)
  if (!downloadableEntries.length) {
    notify('[Auto Image Translator] 当前没有可下载的已翻译图片缓存')
    return
  }
  for (const entry of downloadableEntries) {
    const requestedAtText = formatRequestedAt(entry.downloadRequestedAt).replace('.', '_')
    const extension = getBlobExtension(entry.blob)
    const imageHash = typeof entry.imageHash === 'string' && entry.imageHash
      ? entry.imageHash
      : 'unknown'
    await downloadBlobFile(entry.blob, `${requestedAtText}_${imageHash}.${extension}`)
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  notify(`[Auto Image Translator] 已开始下载 ${downloadableEntries.length} 张已翻译图片`)
}

async function clearAllCaches() {
  cacheGeneration += 1
  translationSessionGeneration += 1
  clearScheduledWork()
  translationProgress = { total: 0, done: 0 }
  scheduleProgressRender()
  restoreOriginalImages()
  clearTranslationTaskCache()
  clearTranslatedImageCache()
  await clearPersistentCache()
  notify('[Auto Image Translator] 已清空翻译缓存')
}

function restoreOriginalImageElement(img) {
  const originalUrl = elementSourceCache.get(img)
  if (!originalUrl) return
  img.src = originalUrl
  img.removeAttribute('srcset')
  elementSourceCache.delete(img)
}

function restoreOriginalImages(rule = currentRule, root = document) {
  if (!rule) return
  for (const img of collectMatchedImages(rule, root)) {
    if (img instanceof HTMLImageElement) {
      restoreOriginalImageElement(img)
    }
  }
}

async function toggleSiteTranslation() {
  const nextEnabled = !siteTranslationEnabled
  await setSiteTranslationEnabled(nextEnabled)
  if (!nextEnabled) {
    translationSessionGeneration += 1
    clearScheduledWork()
    translationProgress = { total: 0, done: 0 }
    scheduleProgressRender()
    restoreOriginalImages()
    log('site translation disabled', { hostname: location.hostname })
    return
  }
  translationSessionGeneration += 1
  log('site translation enabled', { hostname: location.hostname })
  if (currentRule) {
    enqueueInitialScan(currentRule)
  }
}

function registerMenuCommands() {
  if (!registerMenuCommand) return
  registerMenuCommand('切换本站翻译', () => {
    toggleSiteTranslation().catch((error) => log('toggle site translation failed', error))
  })
  registerMenuCommand('清空翻译缓存', () => {
    clearAllCaches().catch((error) => log('clear cache failed', error))
  })
  registerMenuCommand('下载翻译图片', () => {
    downloadCachedTranslatedImages().catch((error) => log('download translated images failed', error))
  })
}

function getCachedTranslatedImageUrl(imageUrl) {
  const cachedUrl = translatedImageCache.get(imageUrl)
  if (!cachedUrl) return ''
  translatedImageCache.delete(imageUrl)
  translatedImageCache.set(imageUrl, cachedUrl)
  return cachedUrl
}

function pruneTranslatedImageCache() {
  while (translatedImageCache.size > CONFIG.recentImageCacheSize) {
    const oldestEntry = translatedImageCache.entries().next()
    if (oldestEntry.done) return
    const [, cachedUrl] = oldestEntry.value
    translatedImageCache.delete(oldestEntry.value[0])
    URL.revokeObjectURL(cachedUrl)
  }
}

function cacheTranslatedImageUrl(imageUrl, translatedUrl) {
  if (CONFIG.recentImageCacheSize <= 0) {
    return translatedUrl
  }
  const previousUrl = translatedImageCache.get(imageUrl)
  if (previousUrl) {
    translatedImageCache.delete(imageUrl)
    URL.revokeObjectURL(previousUrl)
  }
  translatedImageCache.set(imageUrl, translatedUrl)
  pruneTranslatedImageCache()
  return translatedUrl
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

async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch (error) {
      log('createImageBitmap failed, fallback to Image()', error)
    }
  }
  return blobToImage(blob)
}

function releaseDecodedImage(image) {
  image?.close?.()
}

function createCanvasSurface(width, height) {
  if (
    typeof OffscreenCanvas !== 'undefined'
    && typeof OffscreenCanvas.prototype?.getContext === 'function'
    && typeof OffscreenCanvas.prototype?.convertToBlob === 'function'
  ) {
    return new OffscreenCanvas(width, height)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function getCanvasContext(canvas) {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('[Auto Image Translator] Canvas 2D context is unavailable')
  }
  return context
}

async function canvasToBlob(canvas, type = 'image/png') {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      reject(new Error('[Auto Image Translator] Canvas toBlob failed'))
    }, type)
  })
}

async function resizeToSubmit(blob, suffix) {
  const workerResult = await runImageWorkerTask('resize', {
    blob,
    suffix,
    maxImageSize: CONFIG.maxImageSize,
  }).catch((error) => {
    imageWorkerAvailable = false
    log('image worker resize failed, fallback to main thread', error)
    return null
  })
  if (workerResult?.blob instanceof Blob) {
    return workerResult
  }
  return runCpuStage(async () => {
    const img = await decodeImage(blob)
    const width = img.width
    const height = img.height
    if (width <= CONFIG.maxImageSize && height <= CONFIG.maxImageSize) {
      releaseDecodedImage(img)
      return { blob, suffix }
    }
    const scale = Math.min(CONFIG.maxImageSize / width, CONFIG.maxImageSize / height)
    const resizedWidth = Math.floor(width * scale)
    const resizedHeight = Math.floor(height * scale)
    const canvas = createCanvasSurface(resizedWidth, resizedHeight)
    try {
      const context = getCanvasContext(canvas)
      context.imageSmoothingQuality = 'high'
      context.drawImage(img, 0, 0, resizedWidth, resizedHeight)
      const resizedBlob = await canvasToBlob(canvas, 'image/png')
      return {
        blob: resizedBlob,
        suffix: 'png',
      }
    } finally {
      releaseDecodedImage(img)
    }
  })
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
  const workerResult = await runImageWorkerTask('merge', {
    baseBlob,
    maskBlob,
  }).catch((error) => {
    imageWorkerAvailable = false
    log('image worker merge failed, fallback to main thread', error)
    return null
  })
  if (workerResult?.blob instanceof Blob) {
    return workerResult.blob
  }
  return runCpuStage(async () => {
    const [baseImage, maskImage] = await Promise.all([
      decodeImage(baseBlob),
      decodeImage(maskBlob),
    ])
    const canvas = createCanvasSurface(baseImage.width, baseImage.height)
    try {
      const context = getCanvasContext(canvas)
      context.drawImage(baseImage, 0, 0)
      context.drawImage(maskImage, 0, 0)
      return await canvasToBlob(canvas, 'image/png')
    } finally {
      releaseDecodedImage(baseImage)
      releaseDecodedImage(maskImage)
    }
  })
}

async function translateImageUrl(imageUrl) {
  const cachedTask = translationTaskCache.get(imageUrl)
  if (cachedTask?.generation === cacheGeneration) {
    return cachedTask.promise
  }
  const taskGeneration = cacheGeneration
  const task = (async () => {
    if (!CONFIG.forceRetry && taskGeneration === cacheGeneration) {
      const cachedTranslatedUrl = getCachedTranslatedImageUrl(imageUrl)
      if (cachedTranslatedUrl) {
        return cachedTranslatedUrl
      }
    }
    let originalBlob
    try {
      originalBlob = await downloadBlob(imageUrl)
    } catch (error) {
      const refererUrl = `${location.origin}/`
      originalBlob = await downloadBlob(imageUrl, { referer: refererUrl })
    }
    const imageHash = await sha256Hex(originalBlob)
    await yieldAfterHeavyStage()
    const persistentCacheKey = getPersistentCacheKey(imageHash)
    if (!CONFIG.forceRetry && taskGeneration === cacheGeneration) {
      try {
        const cachedBlob = await getPersistentTranslatedBlob(persistentCacheKey)
        if (cachedBlob) {
          const translatedUrl = URL.createObjectURL(cachedBlob)
          return cacheTranslatedImageUrl(imageUrl, translatedUrl)
        }
      } catch (error) {
        log('persistent cache read failed', imageUrl, error)
      }
    }
    const originalSuffix = getFileSuffix(imageUrl)
    const resized = await resizeToSubmit(originalBlob, originalSuffix)
    await yieldAfterHeavyStage()
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
    await yieldAfterHeavyStage()
    const translatedUrl = URL.createObjectURL(translatedBlob)
    if (taskGeneration === cacheGeneration) {
      try {
        await setPersistentTranslatedBlob(persistentCacheKey, imageHash, translatedBlob)
      } catch (error) {
        log('persistent cache write failed', imageUrl, error)
      }
      return cacheTranslatedImageUrl(imageUrl, translatedUrl)
    }
    URL.revokeObjectURL(translatedUrl)
    return ''
  })()
  translationTaskCache.set(imageUrl, {
    generation: taskGeneration,
    promise: task,
  })
  try {
    return await task
  } finally {
    const latestTask = translationTaskCache.get(imageUrl)
    if (latestTask?.generation === taskGeneration && latestTask.promise === task) {
      translationTaskCache.delete(imageUrl)
    }
  }
}

function scheduleApplyFlush() {
  if (applyFlushScheduled) return
  applyFlushScheduled = true
  void nextAnimationFrame().then(async () => {
    applyFlushScheduled = false
    await waitForScrollIdle(SCROLL_APPLY_MAX_WAIT_MS)
    let appliedCount = 0
    while (pendingApplyEntries.length > 0 && appliedCount < APPLY_BATCH_SIZE) {
      const entry = pendingApplyEntries.shift()
      if (!entry) break
      const {
        img,
        imageUrl,
        translatedUrl,
        sessionGeneration,
        resolve,
      } = entry
      try {
        if (!siteTranslationEnabled) {
          releaseTranslatedUrlIfOwned(imageUrl, translatedUrl)
          resolve(false)
          continue
        }
        if (sessionGeneration !== translationSessionGeneration) {
          releaseTranslatedUrlIfOwned(imageUrl, translatedUrl)
          resolve(false)
          continue
        }
        if (!(img instanceof HTMLImageElement) || !img.isConnected) {
          releaseTranslatedUrlIfOwned(imageUrl, translatedUrl)
          resolve(false)
          continue
        }
        if (getImageUrl(img) !== imageUrl) {
          releaseTranslatedUrlIfOwned(imageUrl, translatedUrl)
          resolve(false)
          continue
        }
        img.src = translatedUrl
        img.removeAttribute('srcset')
        elementSourceCache.set(img, imageUrl)
        resolve(true)
        appliedCount += 1
      } catch (error) {
        releaseTranslatedUrlIfOwned(imageUrl, translatedUrl)
        resolve(false)
      }
    }
    if (pendingApplyEntries.length > 0) {
      scheduleApplyFlush()
    }
  })
}

function enqueueApplyResult(img, imageUrl, translatedUrl, sessionGeneration) {
  return new Promise((resolve) => {
    pendingApplyEntries.push({
      img,
      imageUrl,
      translatedUrl,
      sessionGeneration,
      resolve,
    })
    scheduleApplyFlush()
  })
}

async function translateImageElement(img) {
  if (!siteTranslationEnabled) return
  const sessionGeneration = translationSessionGeneration
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
    if (!translatedUrl) return
    await enqueueApplyResult(img, imageUrl, translatedUrl, sessionGeneration)
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

function isMatchedImage(rule, img) {
  if (!(img instanceof HTMLImageElement)) return false
  return img.matches(rule.selector)
}

function ensureVisibilityObserver() {
  if (visibilityObserver || typeof IntersectionObserver === 'undefined') {
    return visibilityObserver
  }
  visibilityObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!(entry.target instanceof HTMLImageElement)) continue
      if (entry.isIntersecting || entry.intersectionRatio > 0) {
        enqueueTranslation(entry.target)
      }
    }
  }, {
    root: null,
    rootMargin: VISIBILITY_ROOT_MARGIN,
    threshold: 0.01,
  })
  return visibilityObserver
}

function observeImageVisibility(img) {
  if (!(img instanceof HTMLImageElement)) return
  const observer = ensureVisibilityObserver()
  if (!observer) {
    enqueueTranslation(img)
    return
  }
  observer.observe(img)
}

function scheduleTranslationFlush() {
  if (translationFlushScheduled) return
  translationFlushScheduled = true
  runWhenMainThreadAvailable(() => {
    translationFlushScheduled = false
    while (activeTranslationCount < DEFAULT_TRANSLATION_CONCURRENCY && pendingTranslationElements.size > 0) {
      const img = pendingTranslationElements.values().next().value
      pendingTranslationElements.delete(img)
      if (!(img instanceof HTMLImageElement)) continue
      if (!siteTranslationEnabled || !shouldTranslate(img)) continue
      activeTranslationCount += 1
      void translateImageElement(img).finally(() => {
        activeTranslationCount = Math.max(0, activeTranslationCount - 1)
        scheduleTranslationFlush()
      })
    }
  })
}

function enqueueTranslation(img) {
  if (!(img instanceof HTMLImageElement)) return
  if (!siteTranslationEnabled) return
  visibilityObserver?.unobserve(img)
  pendingTranslationElements.add(img)
  scheduleTranslationFlush()
}

function registerMatchedImage(img, options = {}) {
  if (!(img instanceof HTMLImageElement)) return
  if (!siteTranslationEnabled) return
  if (options.immediate) {
    enqueueTranslation(img)
    return
  }
  observeImageVisibility(img)
}

function scheduleScanFlush() {
  if (scanFlushScheduled) return
  scanFlushScheduled = true
  runWhenMainThreadAvailable((deadline) => {
    scanFlushScheduled = false
    const startedAt = performance.now()
    let processedCount = 0
    while (pendingScanRoots.size > 0) {
      const root = pendingScanRoots.values().next().value
      pendingScanRoots.delete(root)
      for (const img of collectMatchedImages(currentRule, root)) {
        registerMatchedImage(img)
      }
      processedCount += 1
      if (shouldYieldToMainThread(deadline, startedAt, processedCount)) {
        break
      }
    }
    if (pendingScanRoots.size > 0) {
      scheduleScanFlush()
    }
  })
}

function enqueueInitialScan(rule) {
  const roots = document.body?.children?.length
    ? Array.from(document.body.children)
    : [document]
  for (const root of roots) {
    pendingScanRoots.add(root)
  }
  if (document.body && document.body.matches(rule.selector)) {
    pendingScanRoots.add(document.body)
  }
  scheduleScanFlush()
}

function scheduleTranslate(rule, root = document) {
  if (!siteTranslationEnabled) return
  const scope = root instanceof Element || root instanceof Document ? root : document
  pendingScanRoots.add(scope)
  scheduleScanFlush()
}

function clearScheduledWork() {
  pendingScanRoots.clear()
  pendingTranslationElements.clear()
  while (pendingApplyEntries.length > 0) {
    const entry = pendingApplyEntries.shift()
    if (!entry) break
    releaseTranslatedUrlIfOwned(entry.imageUrl, entry.translatedUrl)
    entry.resolve(false)
  }
  if (visibilityObserver) {
    visibilityObserver.disconnect()
    visibilityObserver = null
  }
}

function startObserver(rule) {
  const observer = new MutationObserver((mutations) => {
    if (!siteTranslationEnabled) return
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLImageElement) {
        if (isMatchedImage(rule, mutation.target)) {
          registerMatchedImage(mutation.target, { immediate: true })
        }
        continue
      }
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLImageElement) {
          if (isMatchedImage(rule, node)) {
            registerMatchedImage(node)
          }
          continue
        }
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
  siteTranslationEnabled = await loadSiteTranslationEnabled()
  startScrollTracking()
  registerMenuCommands()
  currentRule = getMatchedRule()
  if (!currentRule) {
    log('no site rule matched')
    return
  }
  if (siteTranslationEnabled) {
    enqueueInitialScan(currentRule)
  }
  startObserver(currentRule)
  log('started', {
    hostname: location.hostname,
    selector: currentRule.selector,
    enabled: siteTranslationEnabled,
  })
}

main().catch((error) => {
  log('startup failed', error)
})
