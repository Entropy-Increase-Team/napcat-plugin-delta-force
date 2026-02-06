/**
 * 账号管理工具
 * 管理用户 Token、账号切换等
 */

import { pluginState } from '../core/state';
import { createApi } from '../core/api';
import type { UserAccount } from '../types/index';
import { logger } from './logger';

/** 账号分组类型 */
export type AccountGroup = 'qq_wechat' | 'wegame' | 'qqsafe';

/** 账号分组配置 */
const GROUP_TOKEN_TYPES: Record<AccountGroup, string[]> = {
  qq_wechat: ['qq', 'wechat'],
  wegame: ['wegame', 'wegame/wechat'],
  qqsafe: ['qqsafe'],
};

/**
 * 获取客户端 ID
 */
export function getClientID (): string | null {
  const api = createApi();
  return api.getClientID();
}

/**
 * 设置用户激活 Token
 * @param userId 用户 ID
 * @param token 框架 Token
 * @param group 账号分组
 */
export function setActiveToken (userId: string, token: string, group: AccountGroup = 'qq_wechat'): void {
  pluginState.setGroupToken(userId, group, token);

  // 如果是 qq_wechat 分组，同时设置为默认激活
  if (group === 'qq_wechat') {
    pluginState.setActiveToken(userId, token);
  }
}

/**
 * 获取用户激活的账号 Token
 * @param userId 用户 ID
 * @param group 账号分组
 * @returns Token 或 null
 */
export async function getAccount (userId: string, group: AccountGroup = 'qq_wechat'): Promise<string | null> {
  // 1. 优先从缓存获取分组 Token
  let activeToken = pluginState.getGroupToken(userId, group);

  // 2. 如果是 qq_wechat 分组但没找到，尝试从默认缓存获取
  if (!activeToken && group === 'qq_wechat') {
    activeToken = pluginState.getActiveToken(userId);
  }

  if (activeToken) return activeToken;

  // 3. 从 API 获取账号列表
  const clientID = getClientID();
  if (!clientID) {
    logger.error('获取账号失败: clientID 未配置');
    return null;
  }

  const api = createApi(userId);
  const res = await api.getUserList({
    clientID,
    platformID: userId,
    clientType: 'napcat',
  });

  if (!res || res.code !== 0 || !res.data || res.data.length === 0) {
    return null;
  }

  // 4. 按分组筛选账号
  const allowedTypes = GROUP_TOKEN_TYPES[group] || [];
  const accountsInGroup = res.data.filter(acc => {
    const tokenType = acc.tokenType.toLowerCase();
    return allowedTypes.includes(tokenType);
  });

  // 5. 找到第一个有效的 Token
  const firstValid = accountsInGroup.find(acc => acc.isValid);

  if (firstValid?.frameworkToken) {
    // 6. 缓存并返回
    setActiveToken(userId, firstValid.frameworkToken, group);
    return firstValid.frameworkToken;
  }

  return null;
}

/**
 * 获取用户所有账号列表
 * @param userId 用户 ID
 * @param group 可选的分组筛选
 */
export async function getAccountList (userId: string, group?: AccountGroup): Promise<UserAccount[]> {
  const clientID = getClientID();
  if (!clientID) return [];

  const api = createApi(userId);
  const res = await api.getUserList({
    clientID,
    platformID: userId,
    clientType: 'napcat',
  });

  if (!res || res.code !== 0 || !res.data) return [];

  // 如果指定了分组，进行筛选
  if (group) {
    const allowedTypes = GROUP_TOKEN_TYPES[group] || [];
    return res.data.filter(acc => allowedTypes.includes(acc.tokenType.toLowerCase()));
  }

  return res.data;
}

/**
 * 切换激活账号
 * @param userId 用户 ID
 * @param token 目标 Token
 * @param group 账号分组
 */
export function switchAccount (userId: string, token: string, group: AccountGroup = 'qq_wechat'): void {
  setActiveToken(userId, token, group);
  logger.debug(`用户 ${userId} 切换账号到分组 ${group}`);
}

/**
 * 清除用户账号缓存
 * @param userId 用户 ID
 */
export function clearAccountCache (userId: string): void {
  pluginState.clearUserTokens(userId);
  logger.debug(`已清除用户 ${userId} 的账号缓存`);
}

/**
 * 绑定新账号
 * @param userId 用户 ID
 * @param frameworkToken 框架 Token
 * @param tokenType 登录类型 (qq/wechat/wegame等)
 */
export async function bindAccount (userId: string, frameworkToken: string, tokenType: string = 'qq'): Promise<{ success: boolean; message: string; }> {
  // 根据 tokenType 确定分组
  let group: AccountGroup = 'qq_wechat';
  const t = tokenType.toLowerCase();
  if (['wegame', 'wegame/wechat'].includes(t)) {
    group = 'wegame';
  } else if (t === 'qqsafe') {
    group = 'qqsafe';
  }

  // 设置为激活账号
  setActiveToken(userId, frameworkToken, group);
  logger.debug(`用户 ${userId} 绑定账号成功，分组: ${group}`);

  return { success: true, message: '账号绑定成功' };
}

/**
 * 解绑账号
 * @param userId 用户 ID
 * @param frameworkToken 框架 Token
 */
export async function unbindAccount (userId: string, frameworkToken: string): Promise<{ success: boolean; message: string; }> {
  const clientID = getClientID();
  if (!clientID) {
    return { success: false, message: 'clientID 未配置' };
  }

  const api = createApi(userId);
  const res = await api.unbindUser({
    frameworkToken,
    platformID: userId,
    clientID,
    clientType: 'napcat',
  });

  if (!res) {
    return { success: false, message: '网络请求失败' };
  }

  if (res.code === 0 || res.success) {
    // 清除缓存
    clearAccountCache(userId);
    return { success: true, message: '账号解绑成功' };
  }

  return { success: false, message: res.message || res.msg || '解绑失败' };
}

export default {
  getClientID,
  getAccount,
  getAccountList,
  setActiveToken,
  switchAccount,
  clearAccountCache,
  bindAccount,
  unbindAccount,
};
