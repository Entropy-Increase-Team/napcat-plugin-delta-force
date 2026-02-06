/**
 * 类型定义
 */

/** 推送目标配置 */
export interface PushTarget {
  /** 群号列表 */
  group: string[];
  /** QQ号列表 */
  private: string[];
  /** 是否开启私信推送 */
  private_enabled?: boolean;
}

/** 定时推送配置 */
export interface ScheduledPush {
  /** 是否启用 */
  enabled: boolean;
  /** Cron 表达式 */
  cron: string;
  /** 推送目标 */
  push_to?: PushTarget;
}

/** TTS 配置 */
export interface TTSConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 黑白名单模式 */
  mode: 'blacklist' | 'whitelist';
  /** 群号列表 */
  group_list: string[];
  /** 用户列表 */
  user_list: string[];
  /** 最大字数 */
  max_length: number;
  /** AI评价TTS配置 */
  ai_tts?: {
    enabled: boolean;
    mode: 'blacklist' | 'whitelist';
    group_list: string[];
    user_list: string[];
  };
}

/** WebSocket 配置 */
export interface WebSocketConfig {
  /** 自动连接 */
  auto_connect: boolean;
}

/** 广播通知配置 */
export interface BroadcastConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 推送目标 */
  push_to: PushTarget;
}

/** 插件配置 */
export interface DeltaForceConfig {
  /** API 密钥 */
  api_key: string;
  /** 客户端 ID */
  clientID: string;
  /** API 模式 */
  api_mode: 'auto' | 'default' | 'eo' | 'esa';
  /** 指令前缀列表 */
  command_prefix: string[];
  /** Puppeteer 插件 ID */
  puppeteer_plugin_id: string;
  /** 主人QQ (多个用逗号分隔) */
  master_qq?: string;
  /** 每日密码推送 */
  push_daily_keyword?: ScheduledPush;
  /** 特勤处状态推送 */
  push_place_status?: ScheduledPush;
  /** 日报推送 */
  push_daily_report?: ScheduledPush;
  /** 周报推送 */
  push_weekly_report?: ScheduledPush;
  /** WebSocket 配置 */
  websocket?: WebSocketConfig;
  /** 广播通知 */
  broadcast_notification?: BroadcastConfig;
  /** TTS 配置 */
  tts?: TTSConfig;
  /** 调试模式 */
  debug?: boolean;
}

/** 渲染选项 */
export interface RenderOptions {
  /** HTML 模板（字符串或文件路径） */
  template: string;
  /** 模板数据 */
  data: Record<string, unknown>;
  /** CSS 选择器 */
  selector?: string;
  /** 图片类型 */
  type?: 'png' | 'jpeg' | 'webp';
  /** JPEG/WebP 质量 */
  quality?: number;
  /** 视口宽度 */
  width?: number;
  /** 视口高度 */
  height?: number;
  /** 设备像素比 */
  deviceScaleFactor?: number;
  /** 是否全页截图 */
  fullPage?: boolean;
  /** 等待超时 */
  waitForTimeout?: number;
}

/** 渲染结果 */
export interface RenderResult {
  /** 是否成功 */
  success: boolean;
  /** Base64 图片数据 */
  data?: string;
  /** 错误信息 */
  error?: string;
  /** 渲染耗时 */
  time?: number;
}

/** API 响应基础结构 */
export interface ApiResponse<T = any> {
  code?: number;
  success?: boolean;
  message?: string;
  msg?: string;
  data?: T;
}

/** 用户列表响应 */
export interface UserListResponse extends ApiResponse {
  data?: Array<{
    frameworkToken: string;
    tokenType?: string;
    isValid?: boolean;
  }>;
}

/** 个人信息响应 */
export interface PersonalInfoResponse extends ApiResponse {
  data?: {
    userData?: {
      charac_name?: string;
      level?: number;
      charac_no?: string;
    };
    banInfo?: any[];
  };
  roleInfo?: {
    charac_name?: string;
    level?: number;
    charac_no?: string;
  };
}
