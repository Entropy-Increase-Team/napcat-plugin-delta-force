/**
 * API 请求封装
 * 统一处理 API 请求、认证、故障转移
 */

import { pluginState } from './state';
import { logger } from '../utils/logger';
import type { ApiResponse, UserListResponse, PersonalInfoResponse } from '../types/index';

/** API 地址列表（优先使用 eo 和 esa） */
const API_URL_LIST = [
  'https://df-api-eo.shallow.ink',
  'https://df-api-esa.shallow.ink',
  'https://df-api.shallow.ink',
];

/** 固定模式地址映射 */
const API_URL_MAP: Record<string, string> = {
  default: 'https://df-api.shallow.ink',
  eo: 'https://df-api-eo.shallow.ink',
  esa: 'https://df-api-esa.shallow.ink',
};

/** 请求超时时间 (ms) - 与原版一致 */
const REQUEST_TIMEOUT = 30000;

/** 设置环境变量跳过 SSL 验证（与原版 httpsAgent rejectUnauthorized: false 一致） */
if (typeof process !== 'undefined' && process.env) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

/** 带超时的 fetch（web调试时自动记录请求/响应详情） */
async function fetchWithTimeout (url: string, options: RequestInit, timeout = REQUEST_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    // Web 调试模式：记录完整请求和响应
    if (pluginState.webDebugMode) {
      const duration = Date.now() - startTime;
      const headers = options.headers as Record<string, string> || {};
      // 克隆响应以读取 body（不影响后续消费）
      const cloned = response.clone();
      const respText = await cloned.text().catch(() => '<无法读取响应体>');
      pluginState.pushApiLog({
        method: options.method || 'GET',
        url,
        headers: { ...headers },
        body: options.body ? String(options.body).slice(0, 2000) : undefined,
        status: response.status,
        response: respText.slice(0, 5000),
        duration,
      });
    }

    return response;
  } catch (error: any) {
    // Web 调试模式：记录失败请求
    if (pluginState.webDebugMode) {
      const duration = Date.now() - startTime;
      const headers = options.headers as Record<string, string> || {};
      pluginState.pushApiLog({
        method: options.method || 'GET',
        url,
        headers: { ...headers },
        body: options.body ? String(options.body).slice(0, 2000) : undefined,
        duration,
        error: error?.name === 'AbortError' ? '请求超时' : String(error),
      });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** API 地址管理器 */
class ApiUrlManager {
  private currentIndex = 0;

  /** 获取当前 API 模式 */
  getMode (): string {
    return pluginState.config.api_mode || 'auto';
  }

  /** 获取 API 地址（指定索引，用于重试） */
  getUrlByIndex (index: number): string | null {
    const mode = this.getMode();

    // 非 auto 模式只有一个地址
    if (mode !== 'auto') {
      return index === 0 ? (API_URL_MAP[mode] || API_URL_LIST[0]) : null;
    }

    // auto 模式：返回对应索引的地址，超出范围返回 null
    return index < API_URL_LIST.length ? API_URL_LIST[index] : null;
  }

  /** 获取最大重试次数 */
  getMaxRetries (): number {
    return this.getMode() === 'auto' ? API_URL_LIST.length : 1;
  }

  /** 获取默认地址 */
  getDefaultUrl (): string {
    const mode = this.getMode();
    return API_URL_MAP[mode] || API_URL_LIST[0];
  }

  /** 获取 WebSocket 地址 */
  getWebSocketUrl (): string {
    const baseUrl = this.getDefaultUrl();
    return baseUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://') + '/ws';
  }
}

/** 导出 API 地址管理器单例 */
export const apiUrlManager = new ApiUrlManager();

/** API 请求类 */
export class DeltaForceApi {
  private userId?: string;

  constructor (userId?: string) {
    this.userId = userId;
  }

  /** 获取 API Key */
  private getApiKey (): string | null {
    const apiKey = pluginState.config.api_key;
    if (!apiKey || apiKey === 'sk-xxxxxxx') {
      return null;
    }
    return apiKey;
  }

  /** 获取 Client ID */
  getClientID (): string | null {
    const clientID = pluginState.config.clientID;
    if (!clientID || clientID === 'xxxxxx') {
      return null;
    }
    return clientID;
  }

  /** 构建带参数的 URL */
  private buildUrl (baseUrl: string, path: string, params?: Record<string, unknown>): string {
    let fullUrl = `${baseUrl}${path}`;
    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== null && value !== undefined) {
          if (Array.isArray(value)) {
            searchParams.append(key, JSON.stringify(value));
          } else {
            searchParams.append(key, String(value));
          }
        }
      }
      fullUrl += `?${searchParams.toString()}`;
    }
    return fullUrl;
  }

  /**
   * 基础 GET 请求（带自动重试）
   */
  async request<T = unknown> (
    url: string,
    params?: Record<string, unknown>,
    options: { responseType?: 'json' | 'stream'; } = {}
  ): Promise<ApiResponse<T> | false> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      pluginState.log('error', 'API Key 未配置');
      return false;
    }

    const maxRetries = apiUrlManager.getMaxRetries();
    let lastError: string = '';

    // 尝试每个可用的 API 地址
    for (let i = 0; i < maxRetries; i++) {
      const baseUrl = apiUrlManager.getUrlByIndex(i);
      if (!baseUrl) break;

      const fullUrl = this.buildUrl(baseUrl, url, params);

      try {
        const response = await fetchWithTimeout(fullUrl, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ message: `API 错误: ${response.statusText}` }));
          lastError = `${response.status} - ${fullUrl}`;

          // 5xx 错误时继续尝试下一个地址
          if (response.status >= 500 && i < maxRetries - 1) {
            pluginState.log('warn', `API ${response.status} 错误，尝试下一个地址: ${baseUrl}`);
            continue;
          }

          pluginState.log('error', `API 请求失败: ${lastError}`);
          return errorBody as ApiResponse<T>;
        }

        if (options.responseType === 'stream') {
          return { code: 0, data: response.body as unknown as T };
        }

        const result = await response.json() as ApiResponse<T>;

        // 调试模式：输出原始响应
        logger.api(`GET ${fullUrl} -> ${(result as any).success ?? (result as any).code ?? 'N/A'}`);

        return result;
      } catch (error: any) {
        const errorMsg = error?.name === 'AbortError' ? '请求超时' : String(error);
        lastError = `${errorMsg} - ${fullUrl}`;

        // 网络错误时尝试下一个地址
        if (i < maxRetries - 1) {
          const nextUrl = apiUrlManager.getUrlByIndex(i + 1);
          pluginState.log('warn', `${baseUrl} 网络错误，切换到: ${nextUrl}`);
          continue;
        }

        pluginState.log('error', `所有 API 地址均不可用: ${lastError}`);
      }
    }

    return false;
  }

  /**
   * POST 请求 (表单格式，带自动重试)
   */
  async post<T = unknown> (
    url: string,
    data?: Record<string, unknown>
  ): Promise<ApiResponse<T> | false> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      pluginState.log('error', 'API Key 未配置');
      return false;
    }

    const maxRetries = apiUrlManager.getMaxRetries();
    let lastError: string = '';

    for (let i = 0; i < maxRetries; i++) {
      const baseUrl = apiUrlManager.getUrlByIndex(i);
      if (!baseUrl) break;

      const fullUrl = `${baseUrl}${url}`;

      try {
        const response = await fetchWithTimeout(fullUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: data ? new URLSearchParams(data as Record<string, string>).toString() : undefined,
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ message: `API 错误: ${response.statusText}` }));
          lastError = `${response.status} - ${fullUrl}`;

          if (response.status >= 500 && i < maxRetries - 1) {
            pluginState.log('warn', `API ${response.status} 错误，尝试下一个地址: ${baseUrl}`);
            continue;
          }

          pluginState.log('error', `API POST 请求失败: ${lastError}`);
          return errorBody as ApiResponse<T>;
        }

        const result = await response.json() as ApiResponse<T>;

        // 调试模式：输出原始响应
        logger.api(`POST ${fullUrl} -> ${(result as any).success ?? (result as any).code ?? 'N/A'}`);

        return result;
      } catch (error: any) {
        const errorMsg = error?.name === 'AbortError' ? '请求超时' : String(error);
        lastError = `${errorMsg} - ${fullUrl}`;

        if (i < maxRetries - 1) {
          const nextUrl = apiUrlManager.getUrlByIndex(i + 1);
          pluginState.log('warn', `${baseUrl} 网络错误，切换到: ${nextUrl}`);
          continue;
        }

        pluginState.log('error', `所有 API 地址均不可用: ${lastError}`);
      }
    }

    return false;
  }

  /**
   * POST 请求 (JSON 格式，带自动重试)
   */
  async postJson<T = unknown> (
    url: string,
    data?: Record<string, unknown>
  ): Promise<ApiResponse<T> | false> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      pluginState.log('error', 'API Key 未配置');
      return false;
    }

    const maxRetries = apiUrlManager.getMaxRetries();
    let lastError: string = '';

    for (let i = 0; i < maxRetries; i++) {
      const baseUrl = apiUrlManager.getUrlByIndex(i);
      if (!baseUrl) break;

      const fullUrl = `${baseUrl}${url}`;

      try {
        const response = await fetchWithTimeout(fullUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: data ? JSON.stringify(data) : undefined,
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ message: `API 错误: ${response.statusText}` }));
          lastError = `${response.status} - ${fullUrl}`;

          if (response.status >= 500 && i < maxRetries - 1) {
            pluginState.log('warn', `API ${response.status} 错误，尝试下一个地址: ${baseUrl}`);
            continue;
          }

          pluginState.log('error', `API JSON POST 请求失败: ${lastError}`);
          return errorBody as ApiResponse<T>;
        }

        const result = await response.json() as ApiResponse<T>;

        // 调试模式：输出原始响应
        logger.api(`POST-JSON ${fullUrl} -> ${(result as any).success ?? (result as any).code ?? 'N/A'}`);

        return result;
      } catch (error: any) {
        const errorMsg = error?.name === 'AbortError' ? '请求超时' : String(error);
        lastError = `${errorMsg} - ${fullUrl}`;

        if (i < maxRetries - 1) {
          const nextUrl = apiUrlManager.getUrlByIndex(i + 1);
          pluginState.log('warn', `${baseUrl} 网络错误，切换到: ${nextUrl}`);
          continue;
        }

        pluginState.log('error', `所有 API 地址均不可用: ${lastError}`);
      }
    }

    return false;
  }

  // ==================== 登录相关 ====================

  /** 获取登录二维码 */
  async getLoginQr (platform: string) {
    return this.request(`/login/${platform}/qr`);
  }

  /** 获取登录状态 */
  async getLoginStatus (platform: string, frameworkToken: string) {
    return this.request(`/login/${platform}/status`, { frameworkToken });
  }

  /** Cookie 登录 */
  async loginWithCookie (cookie: string) {
    return this.post('/login/qq/ck', { cookie });
  }

  /** QQ OAuth 获取授权链接 */
  async getQqOAuthAuth (platformID?: string, botID?: string) {
    const params: Record<string, string> = {};
    if (platformID) params.platformID = platformID;
    if (botID) params.botID = botID;
    return this.request('/login/qq/oauth', params);
  }

  /** QQ OAuth 提交授权 */
  async submitQqOAuthAuth (authurl?: string, frameworkToken?: string, authcode?: string) {
    const data: Record<string, string> = {};
    if (authurl) data.authurl = authurl;
    else if (frameworkToken && authcode) {
      data.frameworkToken = frameworkToken;
      data.authcode = authcode;
    }
    return this.postJson('/login/qq/oauth', data);
  }

  /** 刷新登录状态 */
  async refreshLogin (platform: string, frameworkToken: string) {
    return this.request(`/login/${platform}/refresh`, { frameworkToken });
  }

  /** 获取平台登录状态 (用于网页登录轮询) */
  async getPlatformLoginStatus (platformID: string, botID?: string, type?: string) {
    const params: Record<string, string> = { platformID };
    if (botID) params.botID = botID;
    if (type) params.type = type;
    return this.request('/login/oauth/platform-status', params);
  }

  /** 获取 QQ OAuth 状态 */
  async getQqOAuthStatus (frameworkToken: string) {
    return this.request('/login/qq/oauth/status', { frameworkToken });
  }

  /** 获取微信 OAuth 状态 */
  async getWechatOAuthStatus (frameworkToken: string) {
    return this.request('/login/wechat/oauth/status', { frameworkToken });
  }

  /** 微信 OAuth 获取授权链接 */
  async getWechatOAuthAuth (platformID?: string, botID?: string) {
    const params: Record<string, string> = {};
    if (platformID) params.platformID = platformID;
    if (botID) params.botID = botID;
    return this.request('/login/wechat/oauth', params);
  }

  /** 微信 OAuth 提交授权 */
  async submitWechatOAuthAuth (authurl?: string, frameworkToken?: string, authcode?: string) {
    const data: Record<string, string> = {};
    if (authurl) data.authurl = authurl;
    else if (frameworkToken && authcode) {
      data.frameworkToken = frameworkToken;
      data.authcode = authcode;
    }
    return this.postJson('/login/wechat/oauth', data);
  }

  /** 删除 QQ 登录数据 */
  async deleteQqLogin (frameworkToken: string) {
    return this.request('/login/qq/delete', { frameworkToken });
  }

  /** 删除微信登录数据 */
  async deleteWechatLogin (frameworkToken: string) {
    return this.request('/login/wechat/delete', { frameworkToken });
  }

  /** 获取违规记录 (QQ安全中心) */
  async getBanHistory (frameworkToken: string) {
    return this.request('/login/qqsafe/ban', { frameworkToken });
  }

  // ==================== 用户数据 ====================

  /** 获取个人信息 */
  async getPersonalInfo (frameworkToken: string): Promise<PersonalInfoResponse | false> {
    return this.request('/df/person/personalInfo', { frameworkToken }) as Promise<PersonalInfoResponse | false>;
  }

  /** 获取个人数据 */
  async getPersonalData (frameworkToken: string, type?: string, seasonid?: number | string) {
    const params: Record<string, unknown> = { frameworkToken };
    if (type) params.type = type;
    if (seasonid !== 'all') params.seasonid = seasonid;
    return this.request('/df/person/personalData', params);
  }

  /** 获取战绩记录 */
  async getRecord (frameworkToken: string, type: number, page: number) {
    return this.request('/df/person/record', { frameworkToken, type, page });
  }

  /** 获取地图统计 */
  async getMapStats (frameworkToken: string, seasonid: string, type: string, mapId?: string) {
    const params: Record<string, string> = { frameworkToken, seasonid, type };
    if (mapId) params.mapId = mapId;
    return this.request('/df/person/mapStats', params);
  }

  /** 获取货币信息 */
  async getMoney (frameworkToken: string) {
    return this.request('/df/person/money', { frameworkToken });
  }

  /** 获取日报 */
  async getDailyRecord (frameworkToken: string, type?: string, date?: string) {
    const params: Record<string, string> = { frameworkToken };
    if (type) params.type = type;
    if (date) params.date = date;
    return this.request('/df/person/dailyRecord', params);
  }

  /** 获取周报 */
  async getWeeklyRecord (frameworkToken: string, type?: string, isShowNullFriend?: boolean, date?: string, showExtra?: boolean) {
    const params: Record<string, unknown> = { frameworkToken, isShowNullFriend: String(isShowNullFriend ?? true) };
    if (type) params.type = type;
    if (date) params.date = date;
    if (showExtra) params.showExtra = String(showExtra);
    return this.request('/df/person/weeklyRecord', params);
  }

  /** 获取藏品 */
  async getCollection (frameworkToken: string) {
    return this.request('/df/person/collection', { frameworkToken });
  }

  /** 获取藏品对照表 */
  async getCollectionMap () {
    return this.request('/df/object/collection');
  }

  /** 获取称号 */
  async getTitle (frameworkToken: string) {
    return this.request('/df/person/title', { frameworkToken });
  }

  // ==================== 账号绑定 ====================

  /** 绑定角色 */
  async bindCharacter (frameworkToken: string) {
    return this.request('/df/person/bind', { frameworkToken, method: 'bind' });
  }

  /** 绑定用户 */
  async bindUser (data: { frameworkToken: string; platformID: string; clientID: string; clientType: string; }) {
    return this.post('/user/bind', data);
  }

  /** 解绑用户 */
  async unbindUser (data: { frameworkToken: string; platformID: string; clientID: string; clientType: string; }) {
    return this.post('/user/unbind', data);
  }

  /** 获取用户列表 */
  async getUserList (params: { platformID: string; clientID: string; clientType: string; }): Promise<UserListResponse | false> {
    return this.request('/user/list', params) as Promise<UserListResponse | false>;
  }

  // ==================== 工具接口 ====================

  /** 获取每日密码 */
  async getDailyKeyword () {
    return this.request('/df/tools/dailykeyword');
  }

  /** 获取文章列表 */
  async getArticleList () {
    return this.post('/df/tools/article/list');
  }

  /** 获取文章详情 */
  async getArticleDetail (threadId: string) {
    return this.request('/df/tools/article/detail', { threadID: threadId });
  }

  /** 获取地图数据 */
  async getMaps () {
    return this.request('/df/object/maps');
  }

  /** 获取干员数据（ID-名称映射） */
  async getOperators () {
    return this.request('/df/object/operator2');
  }

  /** 获取干员详细信息 */
  async getOperatorDetails () {
    return this.request('/df/object/operator');
  }

  /** 获取段位分数 */
  async getRankScore () {
    return this.request('/df/object/rankscore');
  }

  /** 获取游戏角色健康状态 (buff/debuff) */
  async getHealthStatus () {
    return this.request('/df/object/health');
  }

  /** 获取特勤处状态 */
  async getPlaceStatus (frameworkToken: string) {
    return this.request('/df/place/status', { frameworkToken });
  }

  /** 获取特勤处信息 */
  async getPlaceInfo (frameworkToken: string, place?: string) {
    const params: Record<string, string> = { frameworkToken };
    if (place) params.place = place;
    return this.request('/df/place/info', params);
  }

  // ==================== AI/TTS ====================

  /** 获取 AI 评价 */
  async getAiCommentary (frameworkToken: string, type: string, preset?: string) {
    const params: Record<string, string> = { frameworkToken, type };
    if (preset) params.preset = preset;
    return this.post('/df/person/ai', params);
  }

  /** 获取 AI 预设列表 */
  async getAiPresets () {
    return this.request('/df/person/ai/presets');
  }

  /** TTS 合成 */
  async ttsSynthesize (params: { text: string; character?: string; emotion?: string; }) {
    return this.postJson('/df/tts/synthesize', params);
  }

  /** 获取 TTS 任务状态 */
  async getTtsTaskStatus (taskId: string) {
    return this.request('/df/tts/task', { taskId });
  }

  /** 获取 TTS 服务状态 */
  async getTtsHealth () {
    return this.request('/df/tts/health');
  }

  /** 获取 TTS 预设列表 */
  async getTtsPresets () {
    return this.request('/df/tts/presets');
  }

  /** 获取 TTS 预设详情 */
  async getTtsPreset (characterId: string) {
    return this.request('/df/tts/preset', { characterId });
  }

  // ==================== 流水查询 ====================

  /** 获取流水记录 */
  async getFlows (frameworkToken: string, type: number, page: number) {
    return this.request('/df/person/flows', { frameworkToken, type, page });
  }

  // ==================== 物品查询 ====================

  /** 获取物品列表 */
  async getObjectList (primary?: string, second?: string) {
    const params: Record<string, string> = {};
    if (primary) params.primary = primary;
    if (second) params.second = second;
    return this.request('/df/object/list', params);
  }

  /** 搜索物品 */
  async searchObject (name?: string, ids?: string) {
    const params: Record<string, string> = {};
    if (name) params.name = name;
    if (ids) params.ids = ids;
    return this.request('/df/object/search', params);
  }

  // ==================== 红色藏品 ====================

  /** 获取红色藏品列表 */
  async getRedList (frameworkToken: string) {
    return this.request('/df/person/redlist', { frameworkToken });
  }

  /** 获取红色藏品记录 */
  async getRedRecord (frameworkToken: string, objectid: string) {
    return this.request('/df/person/redone', { frameworkToken, objectid });
  }

  // ==================== 价格查询 ====================

  /** 获取历史价格 V1 (日均价) */
  async getPriceHistoryV1 (id: string) {
    return this.request('/df/object/price/history/v1', { id });
  }

  /** 获取历史价格 V2 (半小时精度) */
  async getPriceHistoryV2 (objectId: string | string[]) {
    return this.request('/df/object/price/history/v2', { objectId });
  }

  /** 获取当前价格 */
  async getCurrentPrice (id: string | string[]) {
    return this.request('/df/object/price/latest', { id });
  }

  /** 获取材料价格 */
  async getMaterialPrice (id?: string) {
    const params: Record<string, string> = {};
    if (id) params.id = id;
    return this.request('/df/place/materialPrice', params);
  }

  /** 获取利润历史 */
  async getProfitHistory (params: { objectId?: string; objectName?: string; place?: string; }) {
    return this.request('/df/place/profitHistory', params);
  }

  /** 获取利润排行 V1 */
  async getProfitRankV1 (params: { type: string; limit?: number; place?: string; timestamp?: number; }) {
    return this.request('/df/place/profitRank/v1', params);
  }

  /** 获取利润排行 V2 (最高利润) */
  async getProfitRankV2 (params: { type: string; place?: string; id?: string; }) {
    return this.request('/df/place/profitRank/v2', params);
  }

  // ==================== 服务器状态 ====================

  /** 获取服务器健康状态 */
  async getServerHealth () {
    return this.request('/health/detailed');
  }

  // ==================== 房间功能 ====================

  /** 获取房间列表 */
  async getRoomList (clientID: string, type?: string, hasPassword?: boolean | string) {
    const params: Record<string, string> = { clientID };
    if (type) params.type = type;
    if (hasPassword !== '' && hasPassword !== undefined) params.hasPassword = String(hasPassword);
    return this.request('/df/tools/Room/list', params);
  }

  /** 创建房间 */
  async createRoom (frameworkToken: string, clientID: string, type: string, mapid: string, tag: string, password: string, onlyCurrentlyClient: boolean) {
    return this.postJson('/df/tools/Room/create', { frameworkToken, clientID, type, mapid, tag, password, onlyCurrentlyClient: String(onlyCurrentlyClient) });
  }

  /** 加入房间 */
  async joinRoom (frameworkToken: string, clientID: string, roomId: string, password?: string) {
    const data: Record<string, string> = { frameworkToken, clientID, roomId };
    if (password) data.password = password;
    return this.postJson('/df/tools/Room/join', data);
  }

  /** 退出/解散房间 */
  async quitRoom (frameworkToken: string, clientID: string, roomId: string) {
    return this.postJson('/df/tools/Room/quit', { frameworkToken, clientID, roomId });
  }

  /** 踢出成员 */
  async kickMember (frameworkToken: string, clientID: string, roomId: string, targetFrameworkToken: string) {
    return this.postJson('/df/tools/Room/kick', { frameworkToken, clientID, roomId, targetFrameworkToken });
  }

  /** 获取房间信息 */
  async getRoomInfo (frameworkToken: string, clientID: string) {
    return this.request('/df/tools/Room/info', { frameworkToken, clientID });
  }

  /** 获取房间标签列表 */
  async getTags () {
    return this.request('/df/tools/Room/tags');
  }

  // ==================== 统计相关 ====================

  /** 获取用户统计信息 */
  async getUserStats (clientID: string) {
    return this.request('/stats/users', { clientID });
  }

  // ==================== 语音相关 ====================

  /** 获取随机音频 */
  async getRandomAudio (params: { category?: string; tag?: string; count?: number; }) {
    return this.request('/df/audio/random', params);
  }

  /** 获取角色音频 */
  async getCharacterAudio (params: { character?: string; scene?: string; actionType?: string; count?: number; }) {
    return this.request('/df/audio/character', params);
  }

  /** 获取音频角色列表 */
  async getAudioCharacters () {
    return this.request('/df/audio/characters');
  }

  /** 获取音频标签列表 */
  async getAudioTags () {
    return this.request('/df/audio/tags');
  }

  /** 获取音频分类列表 */
  async getAudioCategories () {
    return this.request('/df/audio/categories');
  }

  /** 获取音频统计 */
  async getAudioStats () {
    return this.request('/df/audio/stats');
  }

  // ==================== 改枪方案相关 (V2) ====================

  /** 上传改枪方案 */
  async uploadSolution (frameworkToken: string, clientID: string, platformID: string, solutionCode: string, desc: string, isPublic: boolean, type: string, weaponId?: string, accessory?: string) {
    const data: Record<string, any> = {
      clientID,
      clientType: 'napcat',
      platformID,
      frameworkToken,
      solutionCode,
      desc,
      isPublic,
      type,
    };
    if (weaponId) data.weaponId = weaponId;
    if (accessory) data.Accessory = accessory;
    return this.postJson('/df/tools/solution/v2/upload', data);
  }

  /** 获取改枪方案列表 */
  async getSolutionList (frameworkToken: string, clientID: string, platformID: string, weaponId?: string, weaponName?: string, priceRange?: string, authorPlatformID?: string, type?: string) {
    const params: Record<string, string> = {
      clientID,
      clientType: 'napcat',
      platformID,
      frameworkToken,
    };
    if (weaponId) params.weaponId = weaponId;
    if (weaponName) params.weaponName = weaponName;
    if (priceRange) params.priceRange = priceRange;
    if (authorPlatformID) params.authorPlatformID = authorPlatformID;
    if (type) params.type = type;
    return this.request('/df/tools/solution/v2/list', params);
  }

  /** 获取改枪方案详情 */
  async getSolutionDetail (frameworkToken: string, clientID: string, platformID: string, solutionId: string) {
    return this.request('/df/tools/solution/v2/detail', {
      clientID,
      clientType: 'napcat',
      platformID,
      frameworkToken,
      solutionId,
    });
  }

  /** 点赞/点踩改枪方案 */
  async voteSolution (frameworkToken: string, clientID: string, platformID: string, solutionId: string, voteType: string) {
    return this.postJson('/df/tools/solution/v2/vote', {
      clientID,
      clientType: 'napcat',
      platformID,
      frameworkToken,
      solutionId,
      voteType,
    });
  }

  /** 更新改枪方案 */
  async updateSolution (frameworkToken: string, clientID: string, platformID: string, solutionId: string, solutionCode?: string, desc?: string, isPublic?: boolean | null, type?: string, accessory?: string) {
    const data: Record<string, any> = {
      clientID,
      clientType: 'napcat',
      platformID,
      frameworkToken,
      solutionId,
    };
    if (solutionCode) data.solutionCode = solutionCode;
    if (desc) data.desc = desc;
    if (isPublic !== null && isPublic !== undefined) data.isPublic = isPublic;
    if (type) data.type = type;
    if (accessory) data.Accessory = accessory;
    return this.postJson('/df/tools/solution/v2/update', data);
  }

  /** 删除改枪方案 */
  async deleteSolution (frameworkToken: string, clientID: string, platformID: string, solutionId: string) {
    return this.postJson('/df/tools/solution/v2/delete', {
      clientID,
      clientType: 'napcat',
      platformID,
      frameworkToken,
      solutionId,
    });
  }

  /** 收藏改枪方案 */
  async collectSolution (frameworkToken: string, clientID: string, platformID: string, solutionId: string) {
    return this.postJson('/df/tools/solution/v2/collect', {
      clientID,
      clientType: 'napcat',
      platformID,
      frameworkToken,
      solutionId,
    });
  }

  /** 取消收藏改枪方案 */
  async discollectSolution (frameworkToken: string, clientID: string, platformID: string, solutionId: string) {
    return this.postJson('/df/tools/solution/v2/discollect', {
      clientID,
      clientType: 'napcat',
      platformID,
      frameworkToken,
      solutionId,
    });
  }

  /** 获取收藏列表 */
  async getCollectList (frameworkToken: string, clientID: string, platformID: string) {
    return this.request('/df/tools/solution/v2/collectlist', {
      clientID,
      clientType: 'napcat',
      platformID,
      frameworkToken,
    });
  }

  // ==================== 鼠鼠音乐相关 ====================

  /** 获取鼠鼠音乐 */
  async getShushuMusic (params: { artist?: string; title?: string; playlist?: string; count?: number; }) {
    return this.request('/df/audio/shushu', params);
  }

  /** 获取鼠鼠音乐列表 */
  async getShushuMusicList (params: { playlist?: string; artist?: string; sortBy?: string; }) {
    return this.request('/df/audio/shushu/list', params);
  }

  // ==================== 战绩订阅相关 ====================

  /** 订阅战绩 */
  async subscribeRecord (params: { platformID: string; clientID: string; subscriptionType: string; }) {
    return this.postJson('/df/record/subscribe', params);
  }

  /** 取消订阅战绩 */
  async unsubscribeRecord (params: { platformID: string; clientID: string; }) {
    return this.postJson('/df/record/unsubscribe', params);
  }

  /** 获取订阅状态 */
  async getRecordSubscription (platformID: string, clientID: string) {
    return this.request('/df/record/subscription', { platformID, clientID });
  }

  /** 获取战绩统计 */
  async getRecordStats () {
    return this.request('/df/record/stats');
  }
}

/** 创建 API 实例 */
export function createApi (userId?: string): DeltaForceApi {
  return new DeltaForceApi(userId);
}

export default DeltaForceApi;
