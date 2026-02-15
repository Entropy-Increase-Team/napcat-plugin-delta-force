/**
 * 渲染服务
 * 通过 HTTP 调用 napcat-plugin-puppeteer 插件的 API
 * 模板与原版 delta-force-plugin-main 完全一致
 */

import { pluginState } from '../core/state';
import { logger } from '../utils/logger';

// ==================== 配置 ====================

/** Puppeteer 插件名 */
const PUPPETEER_PLUGIN_NAME = 'napcat-plugin-puppeteer';

/** Puppeteer 插件 API 地址 */
function getPuppeteerApiUrl (): string {
  return `http://127.0.0.1:6099/plugin/${PUPPETEER_PLUGIN_NAME}/api`;
}

/** 获取本插件静态资源 URL 前缀 */
export function getStaticUrl (): string {
  return `http://127.0.0.1:6099/plugin/${pluginState.pluginName}/files/static`;
}

// ==================== 类型定义 ====================

/** 渲染参数 */
export interface RenderOptions {
  /** HTML 模板内容 */
  template: string;
  /** 截图选择器 */
  selector?: string;
  /** 视口宽度 */
  width?: number;
  /** 视口高度 */
  height?: number;
  /** 是否全页面截图 */
  fullPage?: boolean;
  /** 等待时间(ms) */
  waitForTimeout?: number;
  /** 模板数据（用于兼容） */
  data?: Record<string, any>;
}

/** 渲染结果 */
export interface RenderResult {
  success: boolean;
  /** base64 图片数据 */
  data?: string;
  /** base64 图片数据（别名） */
  base64?: string;
  error?: string;
  /** 渲染耗时(ms) */
  time?: number;
}

/** Puppeteer 状态 */
export interface PuppeteerStatus {
  connected: boolean;
  message: string;
}

// ==================== 核心功能 ====================

/**
 * 检查 Puppeteer 插件状态
 * 与启动日志逻辑一致：能成功请求到 Puppeteer API 即视为已连接
 */
export async function checkPuppeteerStatus (): Promise<PuppeteerStatus> {
  try {
    const response = await fetch(`${getPuppeteerApiUrl()}/status`);
    if (!response.ok) {
      return { connected: false, message: `Puppeteer 插件响应异常: ${response.status}` };
    }
    const result = await response.json();
    // 能成功请求且返回 code=0 即视为已连接（与启动日志判断逻辑一致）
    if (result.code === 0) {
      return { connected: true, message: '渲染服务已连接' };
    }
    return { connected: false, message: result.message || '渲染服务异常' };
  } catch (error) {
    return { connected: false, message: `无法连接 Puppeteer 插件: ${error}` };
  }
}

/**
 * 渲染 HTML 为图片
 * 调用 napcat-plugin-puppeteer 的 /render API
 */
export async function render (options: RenderOptions): Promise<RenderResult> {
  const startTime = Date.now();
  const apiUrl = `${getPuppeteerApiUrl()}/render`;

  logger.render(`开始调用 Puppeteer API: ${apiUrl}`);

  try {
    // 当指定了 selector 时，只截取该元素，不使用 fullPage
    const hasSelector = !!options.selector;
    const requestBody = {
      html: options.template,
      selector: options.selector || '.red-record-container',
      setViewport: {
        width: options.width || 1280,
        height: options.height || 800, // 减小默认高度
        deviceScaleFactor: 2,
      },
      // 有 selector 时强制 fullPage 为 false，让 Puppeteer 只截取元素
      fullPage: hasSelector ? false : (options.fullPage === true),
      waitForTimeout: options.waitForTimeout || 300,
      encoding: 'base64',
      type: 'png',
    };

    logger.render(`请求参数: selector=${requestBody.selector}, viewport=${requestBody.setViewport.width}x${requestBody.setViewport.height}`);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    logger.render(`API 响应状态: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      logger.error(`[渲染] API 错误: ${response.status} - ${errorText}`);
      return {
        success: false,
        error: `Puppeteer API 响应异常: ${response.status} - ${errorText}`,
        time: Date.now() - startTime,
      };
    }

    const result = await response.json();
    logger.render(`API 返回: code=${result.code}, hasData=${!!result.data}, message=${result.message || ''}`);

    if (result.code === 0 && result.data) {
      logger.render(`成功，耗时 ${result.time || (Date.now() - startTime)}ms`);
      return {
        success: true,
        data: result.data,
        base64: result.data, // 别名
        time: result.time || (Date.now() - startTime),
      };
    }

    logger.warn(`[渲染] API 返回错误: ${result.message || '未知错误'}`);
    return {
      success: false,
      error: result.message || '渲染失败',
      time: Date.now() - startTime,
    };
  } catch (error) {
    logger.error(`[渲染] 调用 Puppeteer API 异常: ${error}`);
    return {
      success: false,
      error: `调用 Puppeteer 插件失败: ${error}`,
      time: Date.now() - startTime,
    };
  }
}

// ==================== HTML 模板生成（与原版完全一致） ====================

/**
 * 生成出红记录 HTML
 * 模板结构和样式与 delta-force-plugin-main/resources/Template/redRecord 完全一致
 */
export function generateRedRecordHtml (data: {
  userName: string;
  userRank: string;
  userRankImage?: string;
  userAvatar: string;
  qqAvatarUrl: string;
  itemName: string;
  itemType?: string;
  itemImageUrl: string;
  firstUnlockTime: string;
  firstUnlockMap: string;
  firstUnlockMapBg?: string;
  records: Array<{ time: string; map: string; count?: number; }>;
  recordCount: number;
}): string {
  const resPath = getStaticUrl() + '/';

  // 生成记录列表 HTML
  const recordsHtml = data.records.length > 0
    ? data.records.map((record, index) => `
                <div class="record-entry">
                    <div class="entry-index">${index + 1}</div>
                    <div class="entry-data">
                        <div class="entry-row">
                            <span class="entry-label">出红时间 / TIME</span>
                            <span class="entry-value">${record.time}</span>
                        </div>
                        <div class="entry-row">
                            <span class="entry-label">出红地点 / LOCATION</span>
                            <span class="entry-value">${record.map}</span>
                        </div>${record.count ? `
                        <div class="entry-row">
                            <span class="entry-label">数量 / COUNT</span>
                            <span class="entry-value">${record.count}</span>
                        </div>` : ''}
                    </div>
                </div>`).join('\n')
    : '<div class="empty-state">暂无相关解锁记录</div>';

  return `<!DOCTYPE html>
<html lang="zh-cn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <link rel="shortcut icon" href="#" />
  <title>delta-force-plugin</title>
  <style>
/* ========== 项目统一字体定义 ========== */
@font-face {
  font-family: 'ProjectD';
  src: url("${resPath}fonts/p-med.ttf") format('truetype');
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: 'ProjectD';
  src: url("${resPath}fonts/p-bold.ttf") format('truetype');
  font-weight: 700;
  font-style: normal;
}

/* ========== 基础样式（不使用 scale，直接设置尺寸） ========== */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  -webkit-user-select: none;
  user-select: none;
}
body {
  font-size: 18px;
  color: #1e1f20;
  font-family: 'ProjectD', "Microsoft YaHei", "PingFang SC", sans-serif;
  width: 1250px;
  margin: 0;
  padding: 0;
}
.container {
  width: 1250px;
  padding: 0;
  background-size: contain;
}
.copyright {
  font-size: 14px;
  text-align: center;
  color: #fff;
  position: relative;
  padding-left: 10px;
  text-shadow: 1px 1px 1px #000;
  margin: 10px 0;
}

/* ========== redRecord.css CSS 变量定义 ========== */
:root {
    --primary-color: #0FF796;
    --bg-dark: #05080a;
    --card-bg: rgba(255, 255, 255, 0.03);
    --border-color: rgba(15, 247, 150, 0.2);
    --text-primary: #FFFFFF;
    --text-secondary: #aaa;
    --text-muted: #c7c7c7;
}

/* ========== 容器 ========== */
.red-record-container {
    position: relative;
    width: 100%;
    background: radial-gradient(circle at 50% 0%, #161d24 0%, #06090c 100%);
    padding: 60px;
    padding-bottom: 40px;
    box-sizing: border-box;
    overflow: hidden;
}

/* ========== 背景装饰 ========== */
.red-record-container::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image: radial-gradient(rgba(15, 247, 150, 0.05) 1px, transparent 1px);
    background-size: 30px 30px;
    z-index: 0;
}

.bg-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 15%;
    opacity: 0.1;
    z-index: 0;
    pointer-events: none;
}

/* 左上角渐变遮罩 */
.red-record-container::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 800px;
    height: 400px;
    background: radial-gradient(ellipse 800px 400px at top left, rgba(5, 8, 10, 0.95) 0%, rgba(5, 8, 10, 0.85) 30%, rgba(5, 8, 10, 0.6) 50%, rgba(5, 8, 10, 0.3) 70%, transparent 85%);
    z-index: 1;
    pointer-events: none;
}

/* ========== 头部区域 ========== */
.user-header {
    position: relative;
    z-index: 2;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 60px;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 30px;
}

.game-meta {
    display: flex;
    align-items: center;
}

.game-logo {
    height: 70px;
    width: auto;
}

.user-profile {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-direction: row-reverse;
}

.avatar-wrapper {
    position: relative;
}

.avatar-wrapper img {
    width: 100px;
    height: 100px;
    border: 2px solid var(--primary-color);
    padding: 4px;
    background: #000;
    border-radius: 4px;
}

.user-meta {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-end;
    text-align: right;
}

.nickname {
    font-size: 36px;
    font-weight: 700;
    color: var(--text-primary);
}

.rank-tag {
    display: flex;
    align-items: center;
    gap: 12px;
}

.rank-text {
    font-size: 18px;
    color: var(--text-primary);
    font-weight: 700;
}

.rank-icon {
    height: 40px;
    width: auto;
}

/* ========== 区块样式 ========== */
.section-block {
    background: rgba(255, 255, 255, 0.01);
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: 30px;
    margin-bottom: 40px;
    position: relative;
    z-index: 3;
}

.section-header {
    font-size: 36px;
    font-weight: bold;
    margin-bottom: 25px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 10px;
    color: var(--text-primary);
}

.section-header .dot {
    width: 8px;
    height: 8px;
    background: var(--primary-color);
    border-radius: 50%;
}

/* ========== 物品展示区域 ========== */
.item-display-card {
    position: relative;
    z-index: 3;
    background: rgba(255, 255, 255, 0.01);
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: 30px;
    margin-bottom: 40px;
}

.item-title-box {
    margin-bottom: 25px;
    border-left: 4px solid var(--primary-color);
    padding-left: 20px;
}

.item-name-text {
    color: var(--primary-color);
    font-size: 48px;
    font-weight: 900;
    text-shadow: 0 0 10px rgba(15, 247, 150, 0.35);
    margin-bottom: 8px;
}

.item-type-tag {
    color: var(--text-secondary);
    font-size: 28px;
    letter-spacing: 2px;
    text-transform: uppercase;
    font-weight: 700;
}

.item-details-flex {
    display: flex;
    gap: 40px;
    align-items: flex-start;
}

.item-img-container {
    width: 400px;
    height: 400px;
    min-width: 400px;
    min-height: 400px;
    aspect-ratio: 1 / 1;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    box-shadow: inset 0 0 20px rgba(15, 247, 150, 0.1);
}

.item-main-img {
    width: 90%;
    height: 90%;
    max-width: 90%;
    max-height: 90%;
    object-fit: contain;
    filter: drop-shadow(0 0 20px rgba(15, 247, 150, 0.2));
}

.unlock-data-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.data-row {
    background: var(--card-bg);
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: 20px 25px;
    border-radius: 4px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    min-width: 0;
    border-left: 4px solid rgba(255, 255, 255, 0.2);
}

.data-row.highlight {
    background: rgba(15, 247, 150, 0.05);
    border-left-color: var(--primary-color);
}

.data-row .label {
    color: var(--text-secondary);
    font-size: 26px;
    white-space: nowrap;
    flex-shrink: 0;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
}

.data-row .value {
    color: var(--primary-color);
    font-size: 24px;
    font-weight: 700;
    white-space: nowrap;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
    font-family: 'ProjectD', 'D-DIN', sans-serif;
}

.map-box {
    width: 100%;
    height: 200px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    position: relative;
}

.map-thumbnail {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.8;
}

/* ========== 记录列表区域 ========== */
.records-container {
    position: relative;
    z-index: 3;
    background: rgba(255, 255, 255, 0.01);
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: 30px;
    margin-bottom: 40px;
}

.records-header {
    display: flex;
    align-items: center;
    margin-bottom: 25px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 10px;
}

.records-title {
    font-size: 36px;
    font-weight: bold;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 10px;
}

.records-title::before {
    content: "";
    width: 8px;
    height: 8px;
    background: var(--primary-color);
    border-radius: 50%;
}

.records-badge {
    margin-left: 12px;
    width: 24px;
    height: 24px;
    border: 1px solid var(--border-color);
    border-radius: 50%;
    color: var(--text-secondary);
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--card-bg);
}

.records-content {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 20px;
}

.record-entry {
    display: flex;
    padding: 15px 20px;
    background: var(--card-bg);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    margin-bottom: 12px;
    border-left: 4px solid rgba(255, 255, 255, 0.2);
    transition: all 0.3s ease;
}

.record-entry:hover {
    background: rgba(15, 247, 150, 0.05);
    border-left-color: var(--primary-color);
}

.record-entry:last-child {
    margin-bottom: 0;
}

.entry-index {
    color: var(--primary-color);
    font-size: 24px;
    font-weight: 900;
    width: 40px;
    flex-shrink: 0;
    font-family: 'ProjectD', 'D-DIN', sans-serif;
}

.entry-data {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.entry-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
}

.entry-label {
    color: var(--text-muted);
    font-size: 28px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    white-space: nowrap;
}

.entry-value {
    color: var(--text-primary);
    font-size: 26px;
    font-weight: 600;
    text-align: right;
    flex: 1;
}

.records-footer-note {
    text-align: center;
    color: var(--primary-color);
    font-size: 12px;
    margin-top: 20px;
    opacity: 0.8;
    font-weight: 700;
}

.empty-state {
    text-align: center;
    color: var(--text-secondary);
    font-size: 18px;
    padding: 40px 20px;
    font-weight: 700;
}
  </style>
</head>
<body class="elem-hydro default-mode">
  <div class="container" id="container">
<div class="red-record-container">
    <!-- 整体背景图片 -->
    <img class="bg-overlay" src="${resPath}imgs/redCollection/bg.webp" />
    
    <!-- ========== 头部区域 ========== -->
    <div class="user-header">
        <div class="game-meta">
            <img class="game-logo" src="${resPath}imgs/others/logo.png" alt="三角洲行动" />
        </div>
        <div class="user-profile">
            <div class="avatar-wrapper">
                <img class="avatar" src="${data.userAvatar}" data-qq-avatar="${data.qqAvatarUrl}" onerror="if(this.dataset.qqAvatar){this.src=this.dataset.qqAvatar;this.onerror=null;}else{this.style.display='none';}" />
            </div>
            <div class="user-meta">
                <div class="nickname">${data.userName}</div>
                <div class="rank-tag">
                    <span class="rank-text">${data.userRank}</span>
                    ${data.userRankImage ? `<img class="rank-icon" src="${resPath}${data.userRankImage}" alt="${data.userRank}" onerror="this.style.display='none';" />` : ''}
                </div>
            </div>
        </div>
    </div>
    
    <!-- ========== 物品详细展示区域 ========== -->
    <div class="section-block item-display-card">
        <div class="section-header">
            <span class="dot"></span> 物品详情 / ITEM DETAILS
        </div>
        
        <div class="item-title-box">
            <h1 class="item-name-text">${data.itemName}</h1>
            ${data.itemType ? `<span class="item-type-tag">${data.itemType}</span>` : ''}
        </div>

        <div class="item-details-flex">
            <!-- 左侧：物品图片 -->
            <div class="item-img-container">
                <img class="item-main-img" src="${data.itemImageUrl}" onerror="this.style.display='none'" />
            </div>
            
            <!-- 右侧：解锁数据 -->
            <div class="unlock-data-panel">
                <div class="data-row highlight">
                    <span class="label">首次解锁 / FIRST UNLOCK</span>
                    <span class="value">${data.firstUnlockTime}</span>
                </div>
        
                ${data.firstUnlockMapBg ? `<div class="map-box">
                    <img class="map-thumbnail" src="${resPath}${data.firstUnlockMapBg}" onerror="this.style.display='none'" />
                </div>` : ''}
        
                <div class="data-row">
                    <span class="label">解锁地点 / UNLOCK LOCATION</span>
                    <span class="value">${data.firstUnlockMap}</span>
                </div>
            </div>
        </div>
    </div>
    
    <!-- ========== 历史记录区域 ========== -->
    <div class="section-block records-container">
        <div class="records-header">
            <div class="records-title">出红记录 / RED RECORDS</div>
            ${data.recordCount > 0 ? `<div class="records-badge">${data.recordCount}</div>` : ''}
        </div>
        
        <div class="records-content">
            ${recordsHtml}
        </div>
        
        ${data.recordCount > 20 ? '<p class="records-footer-note">（仅展示最新的 20 条记录）</p>' : ''}
    </div>
</div>
    <div class="copyright"></div>
  </div>
</body>
</html>`;
}

// 兼容旧接口
export function getResourcePath (): string {
  return '';
}

export function setResourcePath (_path: string): void {
  // 不再需要，使用 HTTP 静态资源服务
}

// ==================== 数据统计模板 ====================

/** 数据统计模板数据 */
export interface PersonalDataTemplateData {
  userName: string;
  userAvatar: string;
  qqAvatarUrl: string;
  season: string | number;
  currentDate: string;
  mode: 'sol' | 'mp' | 'both';
  // 烽火地带数据
  solDetail?: {
    levelScore?: number;
    totalEscape?: number;
    totalGainedPrice?: number;
    redTotalMoney?: number;
    userRank?: string;
    totalFight?: number;
    totalKill?: number;
    totalGameTime?: number;
    lowKillDeathRatio?: number;
    medKillDeathRatio?: number;
    highKillDeathRatio?: number;
    mapList?: Array<{ mapID: string; mapName?: string; mapImage?: string | null; totalCount: number; leaveCount: number; }>;
    gunPlayList?: Array<{ objectID: string; weaponName?: string; fightCount: number; escapeCount: number; totalPrice?: number; }>;
    redCollectionDetail?: Array<{ objectID: string; objectName?: string; price: number; count: number; }>;
  };
  solRank?: string;
  solRankImage?: string | null;
  // 全面战场数据
  mpDetail?: {
    levelScore?: number;
    winRatio?: number;
    totalScore?: number;
    avgKillPerMinute?: number;
    avgScorePerMinute?: number;
    totalFight?: number;
    totalWin?: number;
    totalVehicleKill?: number;
    totalVehicleDestroyed?: number;
    totalGameTime?: number;
    mapList?: Array<{ mapID: string; mapName?: string; mapImage?: string | null; totalCount: number; leaveCount: number; }>;
  };
  mpRank?: string;
  mpRankImage?: string | null;
}

/** 生成数据统计 HTML */
export function generatePersonalDataHtml (data: PersonalDataTemplateData): string {
  const resPath = getStaticUrl() + '/';
  const isMpTheme = data.mode === 'mp' && !data.solDetail;
  const primaryColor = isMpTheme ? '#ff5252' : '#0FF796';

  // 格式化函数
  const formatGameTime = (seconds: number | undefined, isMp = false): string => {
    if (!seconds || isNaN(seconds)) return '0分钟';
    if (isMp) {
      // MP 是分钟
      const hours = Math.floor(seconds / 60);
      const mins = seconds % 60;
      return `${hours}小时${mins}分钟`;
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}小时${minutes}分钟`;
  };

  const formatPrice = (price: number | undefined): string => {
    if (!price || isNaN(price)) return '-';
    const numPrice = parseFloat(String(price));
    if (numPrice >= 1000000000) return (numPrice / 1000000000).toFixed(2) + 'B';
    if (numPrice >= 1000000) return (numPrice / 1000000).toFixed(2) + 'M';
    if (numPrice >= 1000) return (numPrice / 1000).toFixed(1) + 'K';
    return numPrice.toFixed(0);
  };

  const formatKd = (kd: number | undefined): string => {
    if (kd === null || kd === undefined || isNaN(kd)) return '-';
    return (parseFloat(String(kd)) / 100).toFixed(2);
  };

  // 生成烽火地带数据节点
  let solDataNodesHtml = '';
  if (data.solDetail) {
    const sol = data.solDetail;
    const totalGainedFormatted = formatPrice(sol.totalGainedPrice);
    const gameTimeFormatted = formatGameTime(sol.totalGameTime);

    solDataNodesHtml = `
      <div class="data-node highlight">
        <div class="node-label"><i class="icon-rank"></i> 段位 / OPERATOR RANK</div>
        <div class="rank-display">
          ${data.solRankImage ? `<img src="${resPath}${data.solRankImage}" class="rank-img" alt="${data.solRank}" onerror="this.style.display='none';" />` : ''}
          <span class="node-value">${data.solRank || '-'}</span>
        </div>
      </div>
      <div class="data-node highlight">
        <div class="node-label">总撤离 / TOTAL EXTRACTIONS</div>
        <span class="node-value large">${sol.totalEscape || '-'}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">总带出价值 / TOTAL VALUE</div>
        <span class="node-value large">${totalGainedFormatted}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">收藏大红 / COLLECTION VALUE</div>
        <span class="node-value large">${sol.redTotalMoney?.toLocaleString() || '-'}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">用户排名 / USER RANK</div>
        <span class="node-value highlight-green">${sol.userRank || '-'}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">总对局 / TOTAL FIGHTS</div>
        <span class="node-value large">${sol.totalFight || '-'}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">总击杀 / TOTAL KILLS</div>
        <span class="node-value large">${sol.totalKill || '-'}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">总游戏时长 / TOTAL GAME TIME</div>
        <span class="node-value highlight-green">${gameTimeFormatted}</span>
      </div>`;
  }

  // 生成全面战场数据节点
  let mpDataNodesHtml = '';
  if (data.mpDetail) {
    const mp = data.mpDetail;
    const gameTimeFormatted = formatGameTime(mp.totalGameTime, true);
    const avgKillFormatted = mp.avgKillPerMinute ? (mp.avgKillPerMinute / 100).toFixed(2) : '-';
    const avgScoreFormatted = mp.avgScorePerMinute ? (mp.avgScorePerMinute / 100).toFixed(2) : '-';

    mpDataNodesHtml = `
      <div class="data-node highlight">
        <div class="node-label">段位 / BATTLEFIELD RANK</div>
        <div class="rank-display">
          ${data.mpRankImage ? `<img src="${resPath}${data.mpRankImage}" class="rank-img" alt="${data.mpRank}" onerror="this.style.display='none';" />` : ''}
          <span class="node-value">${data.mpRank || '-'}</span>
        </div>
      </div>
      <div class="data-node highlight">
        <div class="node-label">胜率 / WIN RATE</div>
        <span class="node-value large">${mp.winRatio ? mp.winRatio + '%' : '-'}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">总得分 / TOTAL SCORE</div>
        <span class="node-value large">${mp.totalScore?.toLocaleString() || '-'}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">每分钟击杀 / KILLS PER MINUTE</div>
        <span class="node-value">${avgKillFormatted}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">每分钟得分 / SCORE PER MINUTE</div>
        <span class="node-value">${avgScoreFormatted}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">总对局 / TOTAL FIGHTS</div>
        <span class="node-value large">${mp.totalFight || '-'}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">总胜利 / TOTAL WINS</div>
        <span class="node-value large">${mp.totalWin || '-'}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">载具击杀 / VEHICLE KILLS</div>
        <span class="node-value">${mp.totalVehicleKill || '-'}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">载具摧毁 / VEHICLE DESTROYED</div>
        <span class="node-value">${mp.totalVehicleDestroyed || '-'}</span>
      </div>
      <div class="data-node highlight">
        <div class="node-label">总游戏时长 / TOTAL GAME TIME</div>
        <span class="node-value">${gameTimeFormatted}</span>
      </div>`;
  }

  // 生成 KD 卡片（仅烽火）
  let kdCardHtml = '';
  if (data.solDetail) {
    const sol = data.solDetail;
    kdCardHtml = `
      <div class="kd-card">
        <div class="kd-label">击杀比 / K/D RATIO</div>
        <div class="kd-grid">
          <div class="kd-item"><small>常规</small><span>${formatKd(sol.lowKillDeathRatio)}</span></div>
          <div class="kd-item"><small>机密</small><span>${formatKd(sol.medKillDeathRatio)}</span></div>
          <div class="kd-item"><small>绝密</small><span>${formatKd(sol.highKillDeathRatio)}</span></div>
        </div>
      </div>`;
  }

  // 生成地图列表
  let mapListHtml = '';
  if (data.solDetail?.mapList && data.solDetail.mapList.length > 0) {
    const mapItems = data.solDetail.mapList.slice(0, 10).map(map => {
      const mapBg = map.mapImage ? `<img class="map-bg" src="${resPath}${map.mapImage}" alt="${map.mapName}" onerror="this.style.display='none'"/>` : '<div class="map-bg-placeholder"></div>';
      return `
      <div class="map-card">
        ${mapBg}
        <div class="map-content">
          <div class="map-name">${map.mapName || map.mapID}</div>
          <div class="map-stats">对局: ${map.totalCount} | 撤离: ${map.leaveCount}</div>
        </div>
      </div>`;
    }).join('');
    mapListHtml = `<div class="map-row">${mapItems}</div>`;
  } else if (data.mpDetail?.mapList && data.mpDetail.mapList.length > 0) {
    const mapItems = data.mpDetail.mapList.slice(0, 10).map(map => {
      const mapBg = map.mapImage ? `<img class="map-bg" src="${resPath}${map.mapImage}" alt="${map.mapName}" onerror="this.style.display='none'"/>` : '<div class="map-bg-placeholder"></div>';
      return `
      <div class="map-card">
        ${mapBg}
        <div class="map-content">
          <div class="map-name">${map.mapName || map.mapID}</div>
          <div class="map-stats">对局: ${map.totalCount} | 胜利: ${map.leaveCount}</div>
        </div>
      </div>`;
    }).join('');
    mapListHtml = `<div class="map-list-mp">${mapItems}</div>`;
  }

  // 生成武器列表（仅烽火）
  let weaponListHtml = '';
  if (data.solDetail?.gunPlayList && data.solDetail.gunPlayList.length > 0) {
    const weaponItems = data.solDetail.gunPlayList.slice(0, 10).map(weapon => {
      const totalPriceFormatted = weapon.totalPrice ? (weapon.totalPrice / 1000000).toFixed(2) + 'M' : '-';
      return `
        <div class="weapon-item">
          <div class="weapon-img-box">
            <img src="https://playerhub.df.qq.com/playerhub/60004/object/${weapon.objectID}.png" alt="${weapon.weaponName}" onerror="this.style.display='none';" />
          </div>
          <div class="weapon-info">
            <div class="weapon-name">${weapon.weaponName || `武器(${weapon.objectID})`}</div>
            <div class="weapon-meta">对局: ${weapon.fightCount || 0} | 撤离: ${weapon.escapeCount || 0}</div>
            <div class="weapon-val">收益：${totalPriceFormatted}</div>
          </div>
        </div>`;
    }).join('');
    weaponListHtml = `
      <div class="section-block">
        <div class="section-header"><span class="dot"></span> 常用武器 / WEAPON REGISTRY</div>
        <div class="weapon-list">${weaponItems}</div>
      </div>`;
  }

  // 生成收藏品列表（仅烽火）
  let assetListHtml = '';
  if (data.solDetail?.redCollectionDetail && data.solDetail.redCollectionDetail.length > 0) {
    const assetItems = data.solDetail.redCollectionDetail.slice(0, 10).map(item => {
      const priceFormatted = formatPrice(item.price);
      return `
        <div class="asset-item">
          <div class="asset-img-box">
            <img src="https://playerhub.df.qq.com/playerhub/60004/object/${item.objectID}.png" alt="${item.objectName}" onerror="this.style.display='none';" />
          </div>
          <div class="asset-info">
            <div class="asset-name">${item.objectName || `物品(${item.objectID})`}</div>
            <div class="asset-meta">
              <span class="asset-price">${priceFormatted}</span>
              <span class="asset-count">X${item.count}</span>
            </div>
          </div>
        </div>`;
    }).join('');
    assetListHtml = `
      <div class="section-block">
        <div class="section-header"><span class="dot"></span> 收藏品 / HIGH-VALUE ASSETS</div>
        <div class="asset-list">${assetItems}</div>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="zh-cn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>个人数据统计</title>
  <style>
@font-face { font-family: 'ProjectD'; src: url("${resPath}fonts/p-med.ttf") format('truetype'); font-weight: 400; }
@font-face { font-family: 'ProjectD'; src: url("${resPath}fonts/p-bold.ttf") format('truetype'); font-weight: 700; }

:root {
  --primary-color: ${primaryColor};
  --bg-dark: #05080a;
  --card-bg: rgba(255, 255, 255, 0.03);
  --border-color: rgba(15, 247, 150, 0.2);
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg-dark); color: #fff; font-family: 'ProjectD', "Microsoft YaHei", sans-serif; margin: 0; width: 1600px; }

.container { padding: 50px; position: relative; box-sizing: border-box; overflow: hidden; }
.bg-grid { position: absolute; inset: 0; background-image: radial-gradient(circle at 2px 2px, rgba(15, 247, 150, 0.05) 1px, transparent 0); background-size: 40px 40px; z-index: -1; }

.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 50px; border-bottom: 1px solid var(--border-color); padding-bottom: 25px; }
.header-left { display: flex; align-items: center; gap: 25px; }
.logo-box img { height: 60px; }
.header-right { display: flex; align-items: flex-start; gap: 18px; }
.user-info { text-align: right; display: flex; flex-direction: column; }
.user-name-row { display: flex; align-items: center; gap: 12px; justify-content: flex-end; margin-bottom: 5px; }
.season-info { font-size: 16px; color: #FFFFFF; font-weight: 700; }
.user-name { font-size: 30px; font-weight: 700; color: #FFFFFF; }
.report-date { font-size: 14px; color: #FFFFFF; font-weight: 700; }
.avatar-wrapper img { width: 85px; height: 85px; border: 2px solid var(--primary-color); padding: 3px; background: #000; }

.dashboard-section { margin-bottom: 50px; }
.dashboard-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
.dashboard-grid.mp-grid { grid-template-columns: repeat(5, 1fr); }

.data-node { background: var(--card-bg); border: 1px solid rgba(255,255,255,0.05); padding: 22px; position: relative; border-left: 4px solid rgba(255,255,255,0.2); }
.data-node.highlight { border-left-color: var(--primary-color); background: rgba(15, 247, 150, 0.02); }
.node-label { font-size: 18px; color: #FFFFFF; margin-bottom: 12px; font-weight: 700; }
.node-value { font-size: 28px; font-weight: 800; font-family: 'ProjectD', 'D-DIN', sans-serif; }
.node-value.large { font-size: 40px; color: var(--primary-color); }
.node-value.highlight-green { color: var(--primary-color); }
.rank-display { display: flex; align-items: center; gap: 18px; }
.rank-img { height: 55px; }

.kd-card { background: var(--card-bg); border: 1px solid rgba(255,255,255,0.05); border-left: 4px solid rgba(255,255,255,0.2); padding: 22px; margin-bottom: 25px; }
.kd-label { font-size: 18px; color: #FFFFFF; margin-bottom: 18px; font-weight: 700; }
.kd-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.kd-item { display: flex; flex-direction: column; align-items: center; text-align: center; }
.kd-item small { display: block; color: #FFFFFF; font-size: 14px; margin-bottom: 6px; font-weight: 700; }
.kd-item span { font-size: 30px; font-weight: 800; color: var(--primary-color); }

.section-block { background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.05); padding: 25px; margin-bottom: 35px; }
.section-header { font-size: 28px; font-weight: bold; margin-bottom: 22px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; }
.section-header .dot { width: 7px; height: 7px; background: var(--primary-color); }

.map-list { display: flex; flex-direction: column; gap: 18px; }
.map-list-mp { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
.map-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; }
.map-card { position: relative; height: 180px; border-radius: 7px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.5); }
.map-bg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
.map-bg-placeholder { width: 100%; height: 100%; background: linear-gradient(135deg, rgba(15, 247, 150, 0.1) 0%, rgba(0,0,0,0.3) 100%); }
.map-content { position: absolute; bottom: 0; left: 0; width: 100%; padding: 22px; background: linear-gradient(transparent, rgba(0,0,0,0.9)); min-height: 85px; z-index: 1; }
.map-name { font-weight: bold; font-size: 20px; color: #FFFFFF; margin-bottom: 10px; }
.map-stats { font-size: 16px; color: #FFFFFF; font-weight: 700; }

.weapon-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.weapon-item { display: flex; flex-direction: column; background: rgba(255,255,255,0.03); padding: 14px; border-radius: 4px; align-items: center; gap: 10px; }
.weapon-img-box { width: 100%; height: 120px; background: rgba(0,0,0,0.3); border-radius: 4px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.weapon-img-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
.weapon-info { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 7px; text-align: center; }
.weapon-name { font-size: 26px; font-weight: 700; color: #FFFFFF; }
.weapon-meta { font-size: 22px; color: #FFFFFF; font-weight: 700; }
.weapon-val { font-size: 22px; color: var(--primary-color); font-weight: 700; }

.asset-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
.asset-item { display: flex; gap: 14px; background: rgba(255,255,255,0.03); padding: 14px; border-radius: 4px; align-items: center; border: 1px solid rgba(255,255,255,0.05); }
.asset-img-box { width: 68px; height: 68px; background: rgba(0,0,0,0.3); border-radius: 4px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.asset-img-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
.asset-info { flex: 1; display: flex; flex-direction: column; gap: 5px; }
.asset-name { font-size: 30px; font-weight: 700; color: #FFFFFF; }
.asset-meta { display: flex; align-items: center; gap: 10px; }
.asset-price { font-size: 22px; font-weight: 700; color: var(--primary-color); }
.asset-count { font-size: 22px; font-weight: 700; color: #FFFFFF; }
  </style>
</head>
<body>
  <div class="container${isMpTheme ? ' mp-theme' : ''}">
    <div class="bg-grid"></div>
    
    <div class="header">
      <div class="header-left">
        <div class="logo-box">
          <img src="${resPath}imgs/others/logo.png" alt="Logo" />
        </div>
      </div>
      <div class="header-right">
        <div class="user-info">
          <div class="user-name-row">
            <div class="season-info">赛季 - ${data.season}</div>
            <div class="user-name">${data.userName}</div>
          </div>
          <div class="report-date">报告日期: ${data.currentDate}</div>
        </div>
        <div class="avatar-wrapper">
          <img src="${data.userAvatar}" alt="Avatar" data-qq-avatar="${data.qqAvatarUrl}" onerror="if(this.dataset.qqAvatar){this.src=this.dataset.qqAvatar;this.onerror=null;}" />
        </div>
      </div>
    </div>

    <div class="dashboard-section">
      <div class="dashboard-grid${isMpTheme ? ' mp-grid' : ''}">
        ${solDataNodesHtml}
        ${mpDataNodesHtml}
      </div>
    </div>

    <div class="section-block">
      <div class="section-header"><span class="dot"></span> 常玩地图 / DEPLOYMENT HISTORY</div>
      ${kdCardHtml}
      <div class="map-list">${mapListHtml}</div>
    </div>

    ${weaponListHtml}
    ${assetListHtml}
  </div>
</body>
</html>`;
}

// ==================== 战绩模板 ====================

/** 战绩记录数据 */
export interface RecordTemplateData {
  modeName: string;
  page: number;
  records: Array<{
    recordNum: number;
    time: string;
    map: string;
    operator: string;
    mapBg?: string;
    status: string;
    statusClass: string;
    duration: string;
    // 烽火地带
    value?: string;
    income?: string;
    incomeClass?: string;
    killsHtml?: string;
    // 全面战场
    kda?: string;
    score?: string;
    rescue?: number;
    // 队友信息
    teammates?: Array<{
      operator: string;
      status: string;
      statusClass: string;
      value?: string;
      kills?: string;
      duration?: string;
      rescue?: number;
    }>;
  }>;
}

/** 生成战绩 HTML */
export function generateRecordHtml (data: RecordTemplateData): string {
  const resPath = getStaticUrl() + '/';

  // 生成记录卡片
  const recordCardsHtml = data.records.length > 0
    ? data.records.map(item => {
      // 队友信息 HTML（仅烽火地带）
      let teammatesHtml = '';
      if (item.value && item.teammates && item.teammates.length > 0) {
        const teammateCards = item.teammates.map(t => `
          <div class="teammate-card">
            <div class="teammate-header">
              <div class="teammate-operator">${t.operator}</div>
              <span class="teammate-status-badge ${t.statusClass}">${t.status}</span>
            </div>
            <div class="teammate-data">
              ${t.value ? `<div class="teammate-item"><span class="teammate-item-label">价值</span><span class="teammate-item-value">${t.value}</span></div>` : ''}
              ${t.kills ? `<div class="teammate-item"><span class="teammate-item-label">击杀</span><span class="teammate-item-value">${t.kills}</span></div>` : ''}
              ${t.duration ? `<div class="teammate-item"><span class="teammate-item-label">时长</span><span class="teammate-item-value">${t.duration}</span></div>` : ''}
              ${t.rescue && t.rescue > 0 ? `<div class="teammate-item"><span class="teammate-item-label">救援</span><span class="teammate-item-value">${t.rescue}次</span></div>` : ''}
            </div>
          </div>
        `).join('');

        teammatesHtml = `
          <div class="teammates-section">
            <div class="teammates-label">队友信息</div>
            <div class="teammates-list">${teammateCards}</div>
          </div>
        `;
      }

      return `
        <div class="record-card" style="${item.mapBg ? `background-image: url(${item.mapBg});` : ''}">
          <div class="data-section">
            <div class="card-status">
              <div class="title-info">
                <span class="record-index">#${item.recordNum}</span>
                <span class="map-name-display">${item.map}</span>
                <span class="title-separator">·</span>
                <span class="operator-name-display">${item.operator}</span>
              </div>
              <div class="status-right">
                <span class="record-time">${item.time}</span>
                <span class="status-badge ${item.statusClass}">${item.status}</span>
              </div>
            </div>
            <div class="data-content-wrapper">
              <div class="data-content">
                ${item.value ? `<div class="data-item-main"><div class="data-label">带出价值</div><div class="data-value highlight-value">${item.value}</div></div>` : ''}
                ${item.income ? `<div class="data-item-main"><div class="data-label">净收益</div><div class="data-value highlight-income ${item.incomeClass || ''}">${item.income}</div></div>` : ''}
                ${item.score ? `<div class="data-item-main"><div class="data-label">得分</div><div class="data-value highlight-score">${item.score}</div></div>` : ''}
                ${item.kda ? `<div class="data-item-main"><div class="data-label">KDA</div><div class="data-value highlight-kda">${item.kda}</div></div>` : ''}
                ${item.duration ? `<div class="data-item-main"><div class="data-label">作战时长</div><div class="data-value">${item.duration}</div></div>` : ''}
              </div>
              <div class="data-row-secondary">
                ${item.killsHtml ? `<div class="kills-section"><div class="kills-label">击杀明细</div><div class="kills-content">${item.killsHtml}</div></div>` : ''}
                ${item.rescue ? `<div class="rescue-section"><div class="rescue-label">战场救援</div><div class="rescue-value">${item.rescue} 次</div></div>` : ''}
              </div>
            </div>
            ${teammatesHtml}
          </div>
        </div>
      `;
    }).join('')
    : '<div class="no-data">当前页面无战绩记录</div>';

  return `<!DOCTYPE html>
<html lang="zh-cn">
<head>
  <meta charset="utf-8">
  <style>
    @font-face { font-family: 'ProjectD'; src: url("${resPath}fonts/p-med.ttf") format('truetype'); font-weight: 400; }
    @font-face { font-family: 'ProjectD'; src: url("${resPath}fonts/p-bold.ttf") format('truetype'); font-weight: 700; }
    
    body {
      background: #0b0f13;
      color: #F2F2F2;
      width: 600px;
      height: auto;
      min-height: 400px;
      font-family: 'ProjectD', "Microsoft YaHei", "PingFang SC", sans-serif;
      margin: 0;
      padding: 0;
    }
    .container { position: relative; width: 600px; min-height: 400px; margin: 0 auto; background: transparent; overflow: hidden; }
    .header { position: relative; z-index: 2; padding: 20px; }
    .header-content { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
    .header-left { display: flex; align-items: center; gap: 20px; }
    .game-logo { height: 28px; width: auto; opacity: 0.95; flex-shrink: 0; }
    .header-right { display: flex; align-items: center; gap: 16px; flex-shrink: 0; flex-wrap: wrap; }
    .header-info { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .mode-name { color: rgba(15, 247, 150, 1); font-weight: 600; font-size: 15px; letter-spacing: 0.5px; }
    .time-stamp { color: rgba(242, 242, 242, 0.9); font-weight: 500; font-size: 12px; background: rgba(0, 0, 0, 0.4); padding: 5px 12px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.15); letter-spacing: 0.8px; font-family: 'Consolas', 'Monaco', monospace; white-space: nowrap; }
    .content { position: relative; z-index: 2; padding: 0 20px 20px 20px; }
    .record-list { display: flex; flex-direction: column; gap: 18px; }
    .record-card { position: relative; border-radius: 12px; overflow: hidden; margin-bottom: 20px; background-size: cover; background-position: center; background-repeat: no-repeat; background-clip: padding-box; border: 1px solid rgba(255, 255, 255, 0.08); min-height: 200px; isolation: isolate; }
    .map-name-display { font-size: 18px; font-weight: 700; color: #FFFFFF; letter-spacing: 0.5px; line-height: 1.4; white-space: nowrap; }
    .operator-name-display { font-size: 15px; font-weight: 700; color: #FFFFFF; letter-spacing: 0.3px; line-height: 1.4; white-space: nowrap; }
    .record-index { font-family: 'Consolas', monospace; font-size: 20px; margin-right: 10px; font-weight: bold; background: linear-gradient(135deg, #0FF796, #00d4aa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .data-section { position: absolute; width: 100%; height: 100%; display: flex; flex-direction: column; z-index: 2; background: linear-gradient(180deg, rgba(11, 15, 19, 0.4) 0%, rgba(11, 15, 19, 0.6) 100%); border-radius: 12px; }
    .card-status { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; background: rgba(0, 0, 0, 0.3); border-bottom: 1px solid rgba(255, 255, 255, 0.05); gap: 12px; flex-wrap: wrap; flex-shrink: 0; }
    .title-info { display: flex; flex-direction: row; align-items: center; gap: 8px; flex: 1; flex-wrap: wrap; }
    .title-separator { color: rgba(255, 255, 255, 0.4); font-size: 16px; font-weight: 300; margin: 0 2px; }
    .status-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; flex-wrap: wrap; }
    .record-time { color: rgba(242, 242, 242, 0.7); font-size: 12px; font-weight: 400; white-space: nowrap; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 13px; font-weight: bold; color: #FFFFFF; flex-shrink: 0; white-space: nowrap; }
    .status-badge.success { background: rgba(15, 247, 150, 0.25); color: #0FF796; border: 1px solid rgba(15, 247, 150, 0.4); }
    .status-badge.fail { background: rgba(255, 82, 82, 0.25); color: #ff5252; border: 1px solid rgba(255, 82, 82, 0.4); }
    .status-badge.exit { background: rgba(255, 180, 0, 0.25); color: #ffb400; border: 1px solid rgba(255, 180, 0, 0.4); }
    .data-content-wrapper { flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0; }
    .data-content { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 15px; padding: 20px 18px 0 18px; }
    .data-item-main { display: flex; flex-direction: column; align-items: flex-start; padding-left: 10px; border-left: 2px solid rgba(255, 255, 255, 0.1); }
    .data-label { background: transparent; border: none; padding: 0; font-size: 11px; color: #FFFFFF; text-transform: uppercase; margin-bottom: 4px; font-weight: 700; white-space: nowrap; letter-spacing: 0.3px; }
    .data-value { font-size: 18px; font-weight: 600; color: #F2F2F2; line-height: 1.5; word-break: break-word; letter-spacing: -0.5px; }
    .highlight-value, .highlight-score, .highlight-kda { color: #0FF796; font-weight: 700; font-size: 19px; }
    .highlight-income { font-weight: 700; font-size: 19px; }
    .highlight-income.income-positive { color: #0FF796; }
    .highlight-income.income-negative { color: #ff5252; }
    .data-row-secondary { padding: 20px 18px 20px 18px; display: flex; justify-content: space-between; align-items: flex-end; flex-shrink: 0; }
    .kills-section { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; padding-left: 10px; border-left: 2px solid rgba(255, 255, 255, 0.1); }
    .kills-label { background: transparent; border: none; padding: 0; font-size: 11px; color: #FFFFFF; margin-bottom: 6px; font-weight: 700; white-space: nowrap; letter-spacing: 0.3px; text-transform: uppercase; }
    .kills-content { display: flex; flex-direction: row; align-items: center; gap: 8px; font-size: 15px; line-height: 1.6; flex-wrap: wrap; justify-content: center; }
    .kill-item { font-weight: 600; display: inline-block; }
    .kill-separator { color: rgba(242, 242, 242, 0.5); margin: 0 2px; font-weight: 400; }
    .kill-player { color: #0FF796; }
    .kill-ai-player { color: #ff5252; }
    .kill-ai { color: #ffb400; }
    .rescue-section { display: flex; flex-direction: column; gap: 10px; align-items: flex-end; }
    .rescue-label { font-size: 11px; color: #FFFFFF; background: transparent; border: none; padding: 0; font-weight: 700; white-space: nowrap; letter-spacing: 0.3px; text-transform: uppercase; }
    .rescue-value { font-size: 17px; font-weight: 600; color: #F2F2F2; line-height: 1.5; }
    .no-data { text-align: center; font-size: 18px; padding: 60px 20px; color: rgba(242, 242, 242, 0.5); background: rgba(255, 255, 255, 0.03); border-radius: 10px; border: 2px dashed rgba(255, 255, 255, 0.1); }
    .teammates-section { margin: 0 18px 18px; padding-top: 15px; border-top: 1px solid rgba(255, 255, 255, 0.05); flex-shrink: 0; }
    .teammates-label { font-size: 12px; color: #FFFFFF; background: rgba(0, 0, 0, 0.5); padding: 5px 10px; border-radius: 4px; font-weight: 700; white-space: nowrap; border: 1px solid rgba(255, 255, 255, 0.12); display: inline-block; letter-spacing: 0.3px; margin-bottom: 12px; }
    .teammates-list { display: flex; flex-direction: column; gap: 10px; }
    .teammate-card { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 6px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; }
    .teammate-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0; flex: 0 0 120px; gap: 8px; }
    .teammate-operator { font-size: 13px; font-weight: 600; color: #FFFFFF; flex: 1; }
    .teammate-status-badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; color: #FFFFFF; white-space: nowrap; flex-shrink: 0; }
    .teammate-status-badge.success { background: rgba(15, 247, 150, 0.25); color: #0FF796; border: 1px solid rgba(15, 247, 150, 0.4); }
    .teammate-status-badge.fail { background: rgba(255, 82, 82, 0.25); color: #ff5252; border: 1px solid rgba(255, 82, 82, 0.4); }
    .teammate-status-badge.exit { background: rgba(255, 180, 0, 0.25); color: #ffb400; border: 1px solid rgba(255, 180, 0, 0.4); }
    .teammate-data { display: flex; flex-wrap: wrap; gap: 15px; align-items: center; flex: 1; justify-content: flex-end; }
    .teammate-item { display: flex; align-items: center; gap: 4px; font-size: 11px; }
    .teammate-item-label { color: #FFFFFF; font-weight: 700; }
    .teammate-item-value { color: #0FF796; font-weight: 600; }
    .template-footer { padding: 15px 20px; }
    .copyright-text { font-size: 12px; color: rgba(242, 242, 242, 0.5); font-weight: 400; letter-spacing: 0.5px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-content">
        <div class="header-left">
          <img class="game-logo" src="${resPath}imgs/others/logo.png" alt="三角洲行动" />
        </div>
        <div class="header-right">
          <div class="header-info">
            <span class="mode-name">${data.modeName}战绩</span>
          </div>
          <span class="time-stamp">第 ${data.page} 页</span>
        </div>
      </div>
    </div>
    <div class="content">
      <div class="record-list">
        ${recordCardsHtml}
      </div>
    </div>
    <div class="template-footer">
      <div class="copyright-text">由 DeltaForce-Plugin 强力驱动</div>
    </div>
  </div>
</body>
</html>`;
}


// ==================== 特勤处信息模板 ====================

export interface PlaceInfoTemplateData {
  placeTypeName: string;
  places: Array<{
    displayName: string;
    level: number;
    imageUrl: string | null;
    detail: string;
    upgradeInfo: {
      condition: string;
      conditions: string[];
      levelCondition: string | null;
      hafCount: number;
      hafCountFormatted: string;
    } | null;
    upgradeRequired: Array<{
      objectName: string;
      count: number;
      imageUrl: string | null;
    }>;
    unlockInfo: {
      properties: string[];
      props: Array<{
        objectName: string;
        imageUrl: string | null;
        count: number | null;
      }>;
    } | null;
  }>;
}

/** 生成特勤处信息 HTML（单个设施单个等级） */
export function generatePlaceInfoHtml (data: PlaceInfoTemplateData): string {
  const resPath = getStaticUrl() + '/';

  const placesHtml = data.places.map(place => {
    // 升级条件
    let upgradeHtml = '';
    if (place.upgradeInfo) {
      let tilesHtml = '';
      if (place.upgradeInfo.levelCondition) {
        tilesHtml += `<div class="info-tile"><div class="tile-label">解锁等级</div><div class="tile-value">${place.upgradeInfo.levelCondition}</div></div>`;
      }
      if (place.upgradeInfo.conditions && place.upgradeInfo.conditions.length > 0) {
        tilesHtml += place.upgradeInfo.conditions.map(c => `<div class="info-tile"><div class="tile-label">条件</div><div class="tile-value">${c}</div></div>`).join('');
      } else if (place.upgradeInfo.condition && !place.upgradeInfo.levelCondition) {
        tilesHtml += `<div class="info-tile"><div class="tile-label">条件</div><div class="tile-value">${place.upgradeInfo.condition}</div></div>`;
      }
      if (place.upgradeInfo.hafCount > 0) {
        tilesHtml += `<div class="info-tile"><div class="tile-label">所需哈夫币</div><div class="tile-value highlight">${place.upgradeInfo.hafCountFormatted}</div></div>`;
      }
      if (tilesHtml) {
        upgradeHtml = `<div class="section"><div class="section-title">升级条件 / REQUIREMENTS</div><div class="upgrade-grid">${tilesHtml}</div></div>`;
      }
    }

    // 所需物资
    let materialsHtml = '';
    if (place.upgradeRequired && place.upgradeRequired.length > 0) {
      const itemsHtml = place.upgradeRequired.map(item => `
        <div class="material-item">
          <div class="mat-img-container">
            <img class="mat-img" src="${item.imageUrl || ''}" alt="${item.objectName}" onerror="this.style.display='none'" />
          </div>
          <div class="mat-name">${item.objectName}</div>
          <div class="mat-count">×${item.count}</div>
        </div>`).join('');
      materialsHtml = `<div class="section"><div class="section-title">所需物资 / MATERIALS</div><div class="materials-list">${itemsHtml}</div></div>`;
    }

    // 解锁效果
    let unlockHtml = '';
    if (place.unlockInfo) {
      if (place.unlockInfo.properties && place.unlockInfo.properties.length > 0) {
        const propsHtml = place.unlockInfo.properties.map(p => `<div class="effect-chip">+ ${p}</div>`).join('');
        unlockHtml += `<div class="section"><div class="section-title">解锁效果 / UNLOCK EFFECTS</div><div class="effect-row">${propsHtml}</div></div>`;
      }
      if (place.unlockInfo.props && place.unlockInfo.props.length > 0) {
        const itemsHtml = place.unlockInfo.props.map(p => `
          <div class="unlock-tag">
            ${p.imageUrl ? `<img class="unlock-tag-img" src="${p.imageUrl}" alt="${p.objectName}" onerror="this.style.display='none'" />` : ''}
            <span>${p.objectName}${p.count ? ` ×${p.count}` : ''}</span>
          </div>`).join('');
        unlockHtml += `<div class="section"><div class="section-title">解锁物品库 / ITEM REGISTRY</div><div class="unlock-grid">${itemsHtml}</div></div>`;
      }
    }

    // 详情
    const detailHtml = place.detail ? `<div class="section"><div class="section-title">详情 / DETAILS</div><div class="detail-text">${place.detail}</div></div>` : '';

    return `
      <div class="place-card">
        <div class="place-left">
          <div class="place-name">${place.displayName}</div>
          ${place.imageUrl ? `<div class="image-box"><img class="place-image" src="${resPath}${place.imageUrl}" alt="${place.displayName}" onerror="this.style.display='none'" /></div>` : ''}
          <div class="level-display">
            <span class="level-label">当前等级 / CURRENT LEVEL</span>
            <span class="level-value">${place.level}</span>
          </div>
        </div>
        <div class="place-right">
          ${upgradeHtml}
          ${materialsHtml}
          ${unlockHtml}
          ${detailHtml}
        </div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>特勤处信息</title>
  <style>
@font-face { font-family: 'ProjectD'; src: url("${resPath}fonts/p-med.ttf") format('truetype'); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: 'ProjectD'; src: url("${resPath}fonts/p-bold.ttf") format('truetype'); font-weight: 700; font-style: normal; font-display: swap; }
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-user-select: none; user-select: none; }
body { background: #06090c; color: #d1d5db; font-family: 'ProjectD', "Microsoft YaHei", sans-serif; width: 1700px; margin: 0 auto; overflow: hidden; height: auto; min-height: 600px; }
.container { position: relative; width: 100%; min-height: 1000px; background: radial-gradient(circle at 50% 0%, #161d24 0%, #06090c 100%); padding-bottom: 60px; }
.container::before { content: ""; position: absolute; inset: 0; background-image: radial-gradient(rgba(15, 247, 150, 0.05) 1px, transparent 1px); background-size: 30px 30px; z-index: 0; }
.header { position: relative; z-index: 2; display: flex; align-items: center; padding: 40px 60px; border-bottom: 1px solid rgba(15, 247, 150, 0.1); }
.game-logo { height: 40px; width: auto; }
.header-center { position: absolute; left: 50%; transform: translateX(-50%); text-align: center; }
.title { color: #FFFFFF; font-size: 32px; font-weight: 700; letter-spacing: 6px; text-shadow: 0 0 20px rgba(15, 247, 150, 0.4); }
.subtitle { font-size: 12px; color: rgba(15, 247, 150, 0.5); letter-spacing: 2px; margin-top: 5px; text-transform: uppercase; }
.content { position: relative; z-index: 2; padding: 40px 60px 0 60px; }
.place-card { display: flex; gap: 60px; background: rgba(20, 25, 30, 0.4); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 4px; padding: 50px; position: relative; margin-bottom: 0; }
.place-card::after { content: ""; position: absolute; top: -1px; left: -1px; width: 30px; height: 30px; border-top: 3px solid #0FF796; border-left: 3px solid #0FF796; }
.place-left { width: 480px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: space-between; }
.place-name { font-size: 56px; font-weight: 700; color: #FFFFFF; margin-bottom: 40px; letter-spacing: 2px; text-align: center; }
.image-box { width: 450px; height: 400px; display: flex; align-items: center; justify-content: center; position: relative; margin-bottom: 0; flex: 1; }
.place-image { max-width: 150%; max-height: 150%; object-fit: contain; filter: drop-shadow(0 0 40px rgba(15, 247, 150, 0.15)); }
.level-display { margin-top: 0; width: 100%; text-align: center; padding-top: 20px; }
.level-label { font-size: 14px; color: #FFFFFF; font-weight: 700; letter-spacing: 4px; display: block; margin-bottom: 10px; }
.level-value { font-size: 100px; font-weight: 800; color: #FFFFFF; line-height: 1; }
.place-right { flex: 1; display: flex; flex-direction: column; gap: 40px; }
.section { width: 100%; }
.section-title { font-size: 14px; color: #0FF796; font-weight: bold; letter-spacing: 2px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px; text-transform: uppercase; }
.section-title::before { content: ""; width: 4px; height: 14px; background: #0FF796; }
.upgrade-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.info-tile { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); padding: 20px 25px; border-radius: 4px; }
.tile-label { font-size: 12px; color: #888; margin-bottom: 10px; }
.tile-value { font-size: 24px; font-weight: bold; color: #fff; }
.tile-value.highlight { color: #0FF796; }
.materials-list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.material-item { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); padding: 25px; display: flex; flex-direction: column; align-items: center; border-radius: 4px; }
.mat-img-container { width: 120px; height: 120px; background: rgba(0, 0, 0, 0.4); border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; box-shadow: inset 0 0 20px rgba(15, 247, 150, 0.1); }
.mat-img { width: 90px; height: 90px; object-fit: contain; }
.mat-name { font-size: 16px; color: #eee; margin-bottom: 8px; font-weight: bold; }
.mat-count { font-size: 20px; color: #0FF796; font-weight: 800; }
.unlock-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.unlock-tag { background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.05); padding: 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; font-size: 13px; color: #FFFFFF; font-weight: 700; text-align: center; border-radius: 4px; min-height: 120px; }
.unlock-tag-img { width: 64px; height: 64px; object-fit: contain; background: rgba(255, 255, 255, 0.05); padding: 6px; border-radius: 4px; flex-shrink: 0; }
.unlock-tag span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; text-align: center; }
.effect-row { display: flex; flex-wrap: wrap; gap: 10px; }
.effect-chip { background: rgba(15, 247, 150, 0.1); border: 1px solid rgba(15, 247, 150, 0.3); color: #0FF796; padding: 5px 15px; border-radius: 2px; font-size: 13px; }
.detail-text { color: rgba(255, 255, 255, 0.8); font-size: 14px; line-height: 1.7; font-style: italic; padding: 12px 16px; background: rgba(0, 0, 0, 0.4); border-radius: 4px; border-left: 3px solid #0FF796; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img class="game-logo" src="${resPath}imgs/others/logo.png" alt="LOGO" />
      <div class="header-center">
        <div class="title">特勤处信息</div>
        <div class="subtitle">Special Services Division Intel</div>
      </div>
    </div>
    <div class="content">
      ${placesHtml}
    </div>
  </div>
</body>
</html>`;
}
