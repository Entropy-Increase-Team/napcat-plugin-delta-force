/**
 * 命令工具
 * 处理自定义命令前缀和命令匹配
 */

import { pluginState } from '../core/state';

/** 命令定义 */
export interface CommandDef {
  /** 关键词列表 */
  keywords: string[];
  /** 处理器名称 */
  handler: string;
  /** 命令名称（用于日志） */
  name: string;
  /** 是否有参数 */
  hasArgs?: boolean;
  /** 参数正则（用于验证参数格式） */
  argsPattern?: RegExp;
  /** 别名列表 */
  aliases?: string[];
}

/** 获取配置的前缀列表 */
export function getPrefixes (): string[] {
  const config = pluginState.getConfig();
  const prefix = config.command_prefix;

  // 支持数组或逗号分隔的字符串
  if (Array.isArray(prefix) && prefix.length > 0) {
    return prefix;
  }
  if (typeof prefix === 'string' && prefix.trim()) {
    return prefix.split(',').map(p => p.trim()).filter(Boolean);
  }
  return ['三角洲', '^'];
}

/** 检查消息是否以配置的前缀开头 */
export function hasPrefix (message: string): boolean {
  const prefixes = getPrefixes();
  return prefixes.some(prefix => message.startsWith(prefix));
}

/** 去除消息的前缀 */
export function stripPrefix (message: string): string {
  const prefixes = getPrefixes();
  for (const prefix of prefixes) {
    if (message.startsWith(prefix)) {
      return message.substring(prefix.length).trim();
    }
  }
  return message;
}

export default {
  getPrefixes,
  hasPrefix,
  stripPrefix,
};
