/**
 * 统一日志模块
 * 按模块分类，自动添加前缀，debug 级别受调试开关控制
 */

import { pluginState } from '../core/state';

/** 日志工具 */
export const logger = {
  /** 重要信息（插件启动/关闭、严重状态变更） */
  info: (...args: unknown[]) => pluginState.log('info', ...args),
  /** 警告 */
  warn: (...args: unknown[]) => pluginState.log('warn', ...args),
  /** 错误 */
  error: (...args: unknown[]) => pluginState.log('error', ...args),
  /** 通用调试（仅调试模式输出） */
  debug: (...args: unknown[]) => pluginState.logDebug(...args),

  // ====== 模块级调试日志（仅调试模式输出） ======
  /** API 请求/响应 */
  api: (...args: unknown[]) => pluginState.logDebug('[API]', ...args),
  /** 图片渲染 */
  render: (...args: unknown[]) => pluginState.logDebug('[渲染]', ...args),
  /** WebSocket */
  ws: (...args: unknown[]) => pluginState.logDebug('[WS]', ...args),
  /** 定时推送 */
  push: (...args: unknown[]) => pluginState.logDebug('[推送]', ...args),
  /** 命令调度 */
  cmd: (...args: unknown[]) => pluginState.logDebug('[命令]', ...args),
};

export default logger;
