/**
 * 战绩订阅配置服务
 * 管理用户的订阅状态和推送配置
 */

import { pluginState } from '../core/state';
import fs from 'node:fs';
import path from 'node:path';

/** 群推送配置 */
export interface GroupPushConfig {
  groupId: string;
  filters: string[];
}

/** 用户推送配置 */
export interface UserPushConfig {
  private: boolean;
  filters: string[];
  groups: GroupPushConfig[];
}

/** 订阅数据 */
export interface SubscriptionData {
  subscriptionType: string;
  subscribedAt: number;
  enabled: boolean;
}

/** 订阅存储 */
const subscriptions = new Map<string, SubscriptionData>();
const pushConfigs = new Map<string, UserPushConfig>();

/** 去重缓存 (防止重复推送) */
const pushedRecords = new Map<string, number>();
const PUSH_CACHE_EXPIRE = 24 * 60 * 60 * 1000; // 24小时

/** 配置文件路径 */
function getConfigPath (): string {
  return path.join(pluginState.pluginDataPath, 'subscription-config.json');
}

/** 加载配置 */
export function loadSubscriptionConfig (): void {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      if (data.subscriptions) {
        for (const [key, value] of Object.entries(data.subscriptions)) {
          subscriptions.set(key, value as SubscriptionData);
        }
      }

      if (data.pushConfigs) {
        for (const [key, value] of Object.entries(data.pushConfigs)) {
          pushConfigs.set(key, value as UserPushConfig);
        }
      }

      pluginState.logDebug(`订阅配置加载完成: ${subscriptions.size} 个订阅, ${pushConfigs.size} 个推送配置`);
    }
  } catch (error) {
    pluginState.log('error', '加载订阅配置失败:', error);
  }
}

/** 保存配置 */
export function saveSubscriptionConfig (): void {
  try {
    const configPath = getConfigPath();
    const data = {
      subscriptions: Object.fromEntries(subscriptions),
      pushConfigs: Object.fromEntries(pushConfigs),
    };
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
    pluginState.logDebug('订阅配置已保存');
  } catch (error) {
    pluginState.log('error', '保存订阅配置失败:', error);
  }
}

// ==================== 订阅管理 ====================

/** 设置订阅 */
export function setSubscription (platformID: string, type: string): void {
  subscriptions.set(platformID, {
    subscriptionType: type,
    subscribedAt: Date.now(),
    enabled: true,
  });
  saveSubscriptionConfig();
}

/** 获取订阅 */
export function getSubscription (platformID: string): SubscriptionData | undefined {
  return subscriptions.get(platformID);
}

/** 删除订阅 */
export function deleteSubscription (platformID: string): void {
  subscriptions.delete(platformID);
  pushConfigs.delete(platformID);
  saveSubscriptionConfig();
}

/** 获取所有订阅 */
export function getAllSubscriptions (): Map<string, SubscriptionData> {
  return subscriptions;
}

// ==================== 推送配置管理 ====================

/** 获取用户推送配置 */
export function getUserPushConfig (platformID: string): UserPushConfig {
  return pushConfigs.get(platformID) || {
    private: false,
    filters: [],
    groups: [],
  };
}

/** 设置私信推送 */
export function setPrivatePush (platformID: string, enabled: boolean, filters: string[]): void {
  const config = getUserPushConfig(platformID);
  config.private = enabled;
  config.filters = filters;
  pushConfigs.set(platformID, config);
  saveSubscriptionConfig();
}

/** 设置群推送 */
export function setGroupPush (platformID: string, groupId: string, filters: string[]): void {
  const config = getUserPushConfig(platformID);

  const existingIndex = config.groups.findIndex(g => g.groupId === groupId);
  if (existingIndex >= 0) {
    config.groups[existingIndex].filters = filters;
  } else {
    config.groups.push({ groupId, filters });
  }

  pushConfigs.set(platformID, config);
  saveSubscriptionConfig();
}

/** 移除群推送 */
export function removeGroupPush (platformID: string, groupId: string): void {
  const config = getUserPushConfig(platformID);
  config.groups = config.groups.filter(g => g.groupId !== groupId);
  pushConfigs.set(platformID, config);
  saveSubscriptionConfig();
}

/** 获取所有推送配置 */
export function getAllPushConfigs (): Map<string, UserPushConfig> {
  return pushConfigs;
}

// ==================== 去重缓存 ====================

/** 检查是否已推送 */
export function isPushed (recordId: string): boolean {
  const pushedTime = pushedRecords.get(recordId);
  if (!pushedTime) return false;

  // 检查是否过期
  if (Date.now() - pushedTime > PUSH_CACHE_EXPIRE) {
    pushedRecords.delete(recordId);
    return false;
  }

  return true;
}

/** 标记为已推送 */
export function markAsPushed (recordId: string): void {
  pushedRecords.set(recordId, Date.now());

  // 清理过期缓存
  const now = Date.now();
  for (const [key, time] of pushedRecords.entries()) {
    if (now - time > PUSH_CACHE_EXPIRE) {
      pushedRecords.delete(key);
    }
  }
}

// ==================== 筛选条件 ====================

/** 解析筛选条件 */
export function parseFilters (filterArg: string): string[] {
  const filters: string[] = [];
  const normalized = filterArg.toLowerCase().replace(/\s+/g, '');

  if (normalized.includes('百万撤离') || normalized.includes('100w撤离') || normalized.includes('百万带出')) {
    filters.push('百万撤离');
  }
  if (normalized.includes('百万战损') || normalized.includes('100w战损')) {
    filters.push('百万战损');
  }
  if (normalized.includes('天才少年') || normalized.includes('天才')) {
    filters.push('天才少年');
  }

  return filters;
}

/** 检查战绩是否符合筛选条件 */
export function checkFilters (recordType: string, record: any, filters: string[]): boolean {
  if (filters.length === 0) return true;

  for (const filter of filters) {
    switch (filter) {
      case '百万撤离':
        if (recordType === 'sol' && Number(record.FinalPrice) >= 1000000) {
          return true;
        }
        break;

      case '百万战损':
        if (recordType === 'sol') {
          const profit = Number(record.flowCalGainedPrice) || 0;
          const carryOut = Number(record.FinalPrice) || 0;
          if (profit - carryOut <= -1000000) {
            return true;
          }
        }
        break;

      case '天才少年':
        if (recordType === 'sol' && Number(record.KillCount) >= 12) {
          return true;
        }
        if (recordType === 'mp' && Number(record.KillNum) >= 140) {
          return true;
        }
        break;
    }
  }

  return false;
}

export default {
  loadSubscriptionConfig,
  saveSubscriptionConfig,
  setSubscription,
  getSubscription,
  deleteSubscription,
  getAllSubscriptions,
  getUserPushConfig,
  setPrivatePush,
  setGroupPush,
  removeGroupPush,
  getAllPushConfigs,
  isPushed,
  markAsPushed,
  parseFilters,
  checkFilters,
};
