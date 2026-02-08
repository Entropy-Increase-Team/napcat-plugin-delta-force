/**
 * 插件状态管理
 * 管理插件运行时状态、配置、日志等
 */

import type { NapCatPluginContext, PluginLogger } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { DeltaForceConfig } from '../types/index';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 运行时从 package.json 读取版本号
function getPluginVersion (): string {
  try {
    // 通过 import.meta.url 获取当前模块目录
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(__dirname, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '1.0.0';
    }
  } catch { /* 读取失败使用默认版本 */ }
  return '1.0.0';
}

/** 默认配置 */
const DEFAULT_CONFIG: DeltaForceConfig = {
  api_key: '',
  clientID: '',
  api_mode: 'auto',
  command_prefix: ['三角洲', '^'],
  puppeteer_plugin_id: 'napcat-plugin-puppeteer',
  master_qq: '',
  push_daily_keyword: { enabled: false, cron: '0 8 * * *', push_to: { group: [], private: [] } },
  push_place_status: { enabled: false, cron: '*/5 * * * *' },
  push_daily_report: { enabled: false, cron: '0 10 * * *' },
  push_weekly_report: { enabled: false, cron: '0 10 * * 1' },
  websocket: { auto_connect: false },
  broadcast_notification: { enabled: false, push_to: { group: [], private: [], private_enabled: false } },
  tts: { enabled: true, mode: 'blacklist', group_list: [], user_list: [], max_length: 800, ai_tts: { enabled: true, mode: 'blacklist', group_list: [], user_list: [] } },
  debug: false,
};

/** Token 数据结构 */
interface TokenData {
  tokens: Record<string, string>;
  groupTokens: Record<string, string>;
}

/** 调试日志条目 */
export interface DebugLogEntry {
  id: number;
  time: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'api';
  message: string;
  /** API 请求专用字段 */
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  status?: number;
  response?: string;
  duration?: number;
}

/** 日志缓冲区最大条目数 */
const MAX_LOG_ENTRIES = 500;

/** 插件状态类 */
class PluginState {
  /** 插件名称 */
  pluginName: string = 'napcat-plugin-delta-force';
  /** 插件版本（运行时从 package.json 读取） */
  version: string = getPluginVersion();
  /** 配置路径 */
  configPath: string = '';
  /** 数据路径 */
  dataPath: string = '';
  /** 插件路径 */
  pluginPath: string = '';
  /** 插件数据路径 (用于存放持久化数据) */
  pluginDataPath: string = '';
  /** 插件配置 */
  config: DeltaForceConfig = { ...DEFAULT_CONFIG };
  /** 启动时间 */
  private startTime: number = Date.now();
  /** 日志器 */
  private logger: PluginLogger | null = null;
  /** 插件上下文 */
  private ctx: NapCatPluginContext | null = null;
  /** 调试模式 */
  debugMode: boolean = false;
  /** Web 调试模式（日志输出到 web 面板而非框架） */
  webDebugMode: boolean = false;
  /** Web 调试日志缓冲区 */
  private debugLogs: DebugLogEntry[] = [];
  /** 日志ID计数器 */
  private logIdCounter: number = 0;
  /** 用户 Token 缓存 (userId -> token) */
  private tokenCache: Map<string, string> = new Map();
  /** 分组 Token 缓存 (userId:group -> token) */
  private groupTokenCache: Map<string, string> = new Map();
  /** Token 数据文件路径 */
  private tokenDataFile: string = '';

  /** 从上下文初始化 */
  initFromContext (ctx: NapCatPluginContext): void {
    this.ctx = ctx;
    this.pluginName = ctx.pluginName;
    this.configPath = ctx.configPath;
    this.dataPath = ctx.dataPath;
    this.pluginPath = ctx.pluginPath;
    this.pluginDataPath = path.join(ctx.dataPath, 'users');
    this.logger = ctx.logger;
    this.startTime = Date.now();

    // 确保用户数据目录存在
    if (!fs.existsSync(this.pluginDataPath)) {
      fs.mkdirSync(this.pluginDataPath, { recursive: true });
    }

    // 初始化 Token 数据文件路径
    this.tokenDataFile = path.join(this.pluginDataPath, 'tokens.json');

    // 加载 Token 数据
    this.loadTokenData();
  }

  /** 加载配置 */
  loadConfig (ctx: NapCatPluginContext): void {
    // ctx.configPath 就是配置文件的完整路径
    const configFile = ctx.configPath;
    const configDir = path.dirname(configFile);

    try {
      // 确保配置目录存在
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // 检查配置文件是否被错误地创建为目录
      if (fs.existsSync(configFile)) {
        const stat = fs.statSync(configFile);
        if (stat.isDirectory()) {
          this.log('warn', '配置文件路径被错误地创建为目录，正在删除并重建...');
          fs.rmSync(configFile, { recursive: true, force: true });
        }
      }

      // 如果配置文件不存在，创建默认配置
      if (!fs.existsSync(configFile)) {
        fs.writeFileSync(configFile, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
        this.log('info', '已创建默认配置文件');
      }

      // 读取配置
      if (fs.existsSync(configFile)) {
        const stat = fs.statSync(configFile);
        if (stat.isFile()) {
          const content = fs.readFileSync(configFile, 'utf-8');
          const parsed = JSON.parse(content);
          this.config = { ...DEFAULT_CONFIG, ...parsed };
        }
      }

      // 同步调试模式
      this.debugMode = this.config.debug === true;

      this.log('debug', '配置加载完成');
    } catch (error) {
      this.log('error', '加载配置失败:', error);
    }
  }

  /** 保存配置 */
  saveConfig (_ctx: NapCatPluginContext | null, newConfig: Partial<DeltaForceConfig>): void {
    try {
      const configFile = this.configPath || _ctx?.configPath;
      if (!configFile) {
        this.log('error', '配置路径未初始化');
        return;
      }
      const configDir = path.dirname(configFile);

      // 确保配置目录存在
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // 检查配置文件是否被错误地创建为目录
      if (fs.existsSync(configFile)) {
        const stat = fs.statSync(configFile);
        if (stat.isDirectory()) {
          fs.rmSync(configFile, { recursive: true, force: true });
        }
      }

      this.config = { ...this.config, ...newConfig };
      fs.writeFileSync(configFile, JSON.stringify(this.config, null, 2), 'utf-8');
      this.log('info', '配置已保存');
    } catch (error) {
      this.log('error', '保存配置失败:', error);
    }
  }

  /** 获取配置 */
  getConfig (): DeltaForceConfig {
    return { ...this.config };
  }

  /** 设置配置项 */
  setConfig (ctx: NapCatPluginContext, config: Partial<DeltaForceConfig>): void {
    this.config = { ...this.config, ...config };
    this.saveConfig(ctx, this.config);
  }

  /** 获取运行时间 (ms) */
  getUptime (): number {
    return Date.now() - this.startTime;
  }

  /** 获取格式化的运行时间 */
  getUptimeFormatted (): string {
    const uptime = this.getUptime();
    const seconds = Math.floor(uptime / 1000) % 60;
    const minutes = Math.floor(uptime / 60000) % 60;
    const hours = Math.floor(uptime / 3600000) % 24;
    const days = Math.floor(uptime / 86400000);

    if (days > 0) return `${days}天${hours}小时${minutes}分钟`;
    if (hours > 0) return `${hours}小时${minutes}分钟`;
    return `${minutes}分钟${seconds}秒`;
  }

  /** 日志输出 */
  log (level: 'debug' | 'info' | 'warn' | 'error', ...args: unknown[]): void {
    const prefix = `[${this.pluginName}]`;
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');

    // Web 调试模式：所有日志写入缓冲区
    if (this.webDebugMode) {
      this.pushLog({ level, message: `${prefix} ${msg}` });
      // web 模式下不输出到框架日志（除了 error 级别始终输出）
      if (level === 'error' && this.logger) {
        this.logger.error(prefix, ...args);
      }
      return;
    }

    // 普通模式：输出到框架日志
    if (this.logger) {
      switch (level) {
        case 'debug':
          if (this.debugMode) this.logger.debug(prefix, ...args);
          break;
        case 'info':
          this.logger.info(prefix, ...args);
          break;
        case 'warn':
          this.logger.warn(prefix, ...args);
          break;
        case 'error':
          this.logger.error(prefix, ...args);
          break;
      }
    } else {
      console[level === 'debug' ? 'log' : level](prefix, ...args);
    }
  }

  /** 调试日志 */
  logDebug (...args: unknown[]): void {
    if (this.debugMode || this.webDebugMode) {
      this.log('debug', ...args);
    }
  }

  // ==================== Web 调试日志 ====================

  /** 添加日志条目到缓冲区 */
  pushLog (entry: Partial<DebugLogEntry>): void {
    const logEntry: DebugLogEntry = {
      id: ++this.logIdCounter,
      time: new Date().toISOString(),
      level: entry.level || 'info',
      message: entry.message || '',
      ...entry,
    };
    this.debugLogs.push(logEntry);
    if (this.debugLogs.length > MAX_LOG_ENTRIES) {
      this.debugLogs.splice(0, this.debugLogs.length - MAX_LOG_ENTRIES);
    }
  }

  /** 添加 API 请求日志（详细记录请求头和响应） */
  pushApiLog (entry: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    status?: number;
    response?: string;
    duration?: number;
    error?: string;
  }): void {
    if (!this.webDebugMode) return;
    const statusText = entry.status ? `${entry.status}` : (entry.error ? 'ERR' : '...');
    this.pushLog({
      level: 'api',
      message: `${entry.method} ${entry.url} [${statusText}] ${entry.duration ? entry.duration + 'ms' : ''}`,
      method: entry.method,
      url: entry.url,
      headers: entry.headers,
      body: entry.body,
      status: entry.status,
      response: entry.response?.slice(0, 5000), // 限制响应体大小
      duration: entry.duration,
    });
  }

  /** 获取日志（支持从指定ID之后获取，用于增量拉取） */
  getDebugLogs (afterId = 0): DebugLogEntry[] {
    if (afterId <= 0) return [...this.debugLogs];
    return this.debugLogs.filter(e => e.id > afterId);
  }

  /** 清空日志 */
  clearDebugLogs (): void {
    this.debugLogs = [];
    this.logIdCounter = 0;
  }

  /** 切换 Web 调试模式 */
  setWebDebugMode (enabled: boolean): void {
    this.webDebugMode = enabled;
    // 开启时同时启用调试模式（确保 debug 级别日志也会输出）
    if (enabled) {
      this.debugMode = true;
      this.pushLog({ level: 'info', message: '🔍 Web 调试模式已开启 - 所有日志和API请求将在此面板显示' });
    } else {
      this.debugMode = this.config.debug === true;
      // 关闭时把剩余日志输出到框架
      if (this.logger) {
        this.logger.info(`[${this.pluginName}]`, 'Web 调试模式已关闭');
      }
    }
  }

  /** 获取上下文 */
  getContext (): NapCatPluginContext | null {
    return this.ctx;
  }

  // ==================== Token 缓存管理 ====================

  /** 加载 Token 数据 */
  private loadTokenData (): void {
    try {
      if (fs.existsSync(this.tokenDataFile)) {
        const content = fs.readFileSync(this.tokenDataFile, 'utf-8');
        const data: TokenData = JSON.parse(content);

        // 加载 tokens
        if (data.tokens) {
          for (const [userId, token] of Object.entries(data.tokens)) {
            this.tokenCache.set(userId, token);
          }
        }

        // 加载 groupTokens
        if (data.groupTokens) {
          for (const [key, token] of Object.entries(data.groupTokens)) {
            this.groupTokenCache.set(key, token);
          }
        }

        this.log('debug', `Token 数据加载完成: ${this.tokenCache.size} 个用户`);
      }
    } catch (error) {
      this.log('error', '加载 Token 数据失败:', error);
    }
  }

  /** 保存 Token 数据 */
  private saveTokenData (): void {
    try {
      // 确保数据目录存在
      if (!fs.existsSync(this.pluginDataPath)) {
        fs.mkdirSync(this.pluginDataPath, { recursive: true });
      }

      const data: TokenData = {
        tokens: Object.fromEntries(this.tokenCache),
        groupTokens: Object.fromEntries(this.groupTokenCache),
      };

      fs.writeFileSync(this.tokenDataFile, JSON.stringify(data, null, 2), 'utf-8');
      this.log('debug', 'Token 数据已保存');
    } catch (error) {
      this.log('error', '保存 Token 数据失败:', error);
    }
  }

  /** 设置用户激活 Token */
  setActiveToken (userId: string, token: string): void {
    this.tokenCache.set(userId, token);
    this.saveTokenData();
  }

  /** 获取用户激活 Token */
  getActiveToken (userId: string): string | undefined {
    return this.tokenCache.get(userId);
  }

  /** 设置分组 Token */
  setGroupToken (userId: string, group: string, token: string): void {
    this.groupTokenCache.set(`${userId}:${group}`, token);
    this.saveTokenData();
  }

  /** 获取分组 Token */
  getGroupToken (userId: string, group: string): string | undefined {
    return this.groupTokenCache.get(`${userId}:${group}`);
  }

  /** 清除用户所有 Token 缓存 */
  clearUserTokens (userId: string): void {
    this.tokenCache.delete(userId);
    for (const key of this.groupTokenCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.groupTokenCache.delete(key);
      }
    }
    this.saveTokenData();
  }
}

/** 导出单例 */
export const pluginState = new PluginState();
export default pluginState;
