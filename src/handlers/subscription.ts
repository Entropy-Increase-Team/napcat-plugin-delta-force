/**
 * 战绩订阅处理器
 * 订阅管理和实时推送功能
 */

import type { OB11Message } from 'napcat-types';
import { pluginState } from '../core/state';
import { createApi } from '../core/api';
import { reply, replyAt, getUserId, sendGroupMsg, sendPrivateMsg } from '../utils/message';
import { handleApiError as _handleApiError } from '../utils/error-handler';
import type { CommandDef } from '../utils/command';
import { getWebSocketManager } from '../services/websocket';
import * as subConfig from '../services/subscription';
import { dataManager } from '../services/data-manager';
import { logger } from '../utils/logger';

/** 错误处理包装 */
async function checkApiError (res: any, msg: OB11Message): Promise<boolean> {
  const result = _handleApiError(res);
  if (result.handled && result.message) {
    await reply(msg, result.message);
    return true;
  }
  return result.handled;
}

/** 命令定义 */
export const commands: CommandDef[] = [
  { keywords: ['订阅战绩', '订阅 战绩'], handler: 'subscribeRecord', name: '订阅战绩', hasArgs: true },
  { keywords: ['取消订阅战绩', '取消订阅 战绩'], handler: 'unsubscribeRecord', name: '取消订阅战绩' },
  { keywords: ['订阅状态战绩', '订阅状态 战绩'], handler: 'getSubscriptionStatus', name: '订阅状态' },
  { keywords: ['开启本群订阅推送战绩', '开启本群订阅推送 战绩'], handler: 'enableGroupPush', name: '开启群推送', hasArgs: true },
  { keywords: ['关闭本群订阅推送战绩', '关闭本群订阅推送 战绩'], handler: 'disableGroupPush', name: '关闭群推送' },
  { keywords: ['开启私信订阅推送战绩', '开启私信订阅推送 战绩'], handler: 'enablePrivatePush', name: '开启私信推送', hasArgs: true },
  { keywords: ['关闭私信订阅推送战绩', '关闭私信订阅推送 战绩'], handler: 'disablePrivatePush', name: '关闭私信推送' },
];

/** 状态映射常量 */
const ESCAPE_REASONS: Record<string, string> = {
  '1': '撤离成功',
  '2': '被玩家击杀',
  '3': '被人机击杀',
  '10': '撤离失败',
};

const MP_RESULTS: Record<string, string> = {
  '1': '胜利',
  '2': '失败',
  '3': '中途退出',
};

/** 监听器注册标记 */
let listenerRegistered = false;

/** 昵称缓存 */
const nicknameCache = new Map<string, { name: string; time: number; }>();
const NICKNAME_CACHE_EXPIRE = 60 * 60 * 1000; // 1小时

// ==================== 命令处理 ====================

/** 订阅战绩 */
export async function subscribeRecord (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const clientID = pluginState.getConfig().clientID;

  if (!clientID || clientID === 'xxxxxx') {
    await reply(msg, 'clientID 未配置，请先在配置中设置');
    return true;
  }

  // 解析订阅类型
  let subscriptionType = 'both';
  const typeArg = args.toLowerCase();
  if (['sol', '烽火', '烽火地带'].some(k => typeArg.includes(k))) {
    subscriptionType = 'sol';
  } else if (['mp', '全面', '全面战场', '战场'].some(k => typeArg.includes(k))) {
    subscriptionType = 'mp';
  }

  // 1. 通过 HTTP API 创建订阅
  const res = await api.subscribeRecord({
    platformID: userId,
    clientID,
    subscriptionType,
  });

  if (await checkApiError(res, msg)) return true;

  if (!res?.success) {
    await reply(msg, `订阅失败: ${(res as any)?.message || '未知错误'}`);
    return true;
  }

  // 2. 确保 WebSocket 已连接
  const wsManager = getWebSocketManager();
  const wsStatus = wsManager.getStatus();

  if (!wsStatus.isConnected) {
    await reply(msg, '订阅成功，但 WebSocket 未连接\n请使用 三角洲ws连接 建立连接以接收实时推送');
  } else {
    // 3. 发送 WebSocket 订阅消息
    wsManager.send({
      type: 'record_subscribe',
      platformID: userId,
      recordType: subscriptionType,
    });
  }

  // 4. 保存订阅信息
  subConfig.setSubscription(userId, subscriptionType);

  const typeText = subscriptionType === 'both' ? '烽火地带+全面战场'
    : subscriptionType === 'sol' ? '烽火地带'
      : '全面战场';

  await reply(msg, `✅ 订阅成功 [${typeText}]\n使用 三角洲订阅状态战绩 查看详情`);
  return true;
}

/** 取消订阅战绩 */
export async function unsubscribeRecord (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const clientID = pluginState.getConfig().clientID;

  if (!clientID) {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  // 1. 通过 HTTP API 取消订阅
  const res = await api.unsubscribeRecord({
    platformID: userId,
    clientID,
  });

  if (await checkApiError(res, msg)) return true;

  if (!res?.success) {
    await reply(msg, `取消失败: ${(res as any)?.message || '未知错误'}`);
    return true;
  }

  // 2. 删除本地订阅
  subConfig.deleteSubscription(userId);

  await reply(msg, '✅ 已取消订阅');
  return true;
}

/** 查询订阅状态 */
export async function getSubscriptionStatus (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const clientID = pluginState.getConfig().clientID;

  if (!clientID) {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  // 1. 查询 HTTP API 订阅状态
  const res = await api.getRecordSubscription(userId, clientID);

  if (await checkApiError(res, msg)) return true;

  if (!res?.success || !(res as any).data) {
    await reply(msg, '您尚未订阅战绩推送\n使用 三角洲订阅战绩 进行订阅');
    return true;
  }

  const subData = (res as any).data;

  // 2. 获取推送配置
  const pushConfig = subConfig.getUserPushConfig(userId);

  // 3. 构建状态消息
  const typeText = subData.subscriptionType === 'both' ? '烽火地带+全面战场'
    : subData.subscriptionType === 'sol' ? '烽火地带'
      : '全面战场';

  let text = '━━ 订阅状态（API）━━\n';
  text += `状态: ${subData.isActive ? '已激活' : '未激活'}\n`;
  text += `模式: ${typeText}\n`;
  text += `订阅: ${new Date(subData.createdAt).toLocaleString()}\n`;
  text += `轮询: 每${subData.pollInterval}秒\n`;
  text += `统计: ${subData.newRecordsCount}条新战绩 (总${subData.totalPolls}次轮询)\n`;

  if (subData.lastPollAt) {
    text += `上次: ${new Date(subData.lastPollAt).toLocaleTimeString()}\n`;
  }
  if (subData.nextPollAt) {
    text += `下次: ${new Date(subData.nextPollAt).toLocaleTimeString()}\n`;
  }

  text += '\n━━ 推送配置（机器人）━━\n';
  text += `私信: ${pushConfig.private ? '已开启' : '已关闭'}`;
  if (pushConfig.private && pushConfig.filters.length > 0) {
    text += ` [${pushConfig.filters.join('、')}]`;
  }
  text += '\n';

  if (pushConfig.groups.length > 0) {
    text += `群聊: ${pushConfig.groups.length}个群\n`;
    pushConfig.groups.forEach((group, index) => {
      text += `  ${index + 1}. ${group.groupId}`;
      if (group.filters.length > 0) {
        text += ` [${group.filters.join('、')}]`;
      }
      text += '\n';
    });
  } else {
    text += '群聊: 未配置\n';
  }

  await reply(msg, text.trim());
  return true;
}

/** 开启群推送 */
export async function enableGroupPush (msg: OB11Message, args: string): Promise<boolean> {
  if (msg.message_type !== 'group') {
    await reply(msg, '此命令只能在群里使用');
    return true;
  }

  const userId = getUserId(msg);
  const groupId = String((msg as any).group_id);

  // 检查用户是否已订阅
  const sub = subConfig.getSubscription(userId);
  if (!sub) {
    await reply(msg, '您还未订阅战绩推送\n请先使用 三角洲订阅战绩');
    return true;
  }

  // 解析筛选条件
  const filters = subConfig.parseFilters(args);

  // 保存群推送配置
  subConfig.setGroupPush(userId, groupId, filters);

  let text = '✅ 已开启本群推送';
  if (filters.length > 0) {
    text += ` [${filters.join('、')}]`;
  }

  await reply(msg, text);
  return true;
}

/** 关闭群推送 */
export async function disableGroupPush (msg: OB11Message): Promise<boolean> {
  if (msg.message_type !== 'group') {
    await reply(msg, '此命令只能在群里使用');
    return true;
  }

  const userId = getUserId(msg);
  const groupId = String((msg as any).group_id);

  subConfig.removeGroupPush(userId, groupId);

  await reply(msg, '✅ 已关闭本群推送');
  return true;
}

/** 开启私信推送 */
export async function enablePrivatePush (msg: OB11Message, args: string): Promise<boolean> {
  const userId = getUserId(msg);

  // 检查用户是否已订阅
  const sub = subConfig.getSubscription(userId);
  if (!sub) {
    await reply(msg, '您还未订阅战绩推送\n请先使用 三角洲订阅战绩');
    return true;
  }

  // 解析筛选条件
  const filters = subConfig.parseFilters(args);

  // 保存私信推送配置
  subConfig.setPrivatePush(userId, true, filters);

  let text = '✅ 已开启私信推送';
  if (filters.length > 0) {
    text += ` [${filters.join('、')}]`;
  }

  await reply(msg, text);
  return true;
}

/** 关闭私信推送 */
export async function disablePrivatePush (msg: OB11Message): Promise<boolean> {
  const userId = getUserId(msg);

  subConfig.setPrivatePush(userId, false, []);

  await reply(msg, '✅ 已关闭私信推送');
  return true;
}

// ==================== 推送处理 ====================

/** 初始化战绩推送监听器 */
export function initRecordPushListener (): void {
  if (listenerRegistered) return;

  const wsManager = getWebSocketManager();

  // 监听战绩推送消息
  wsManager.on('record_update', async (data: any) => {
    await handleRecordPush(data);
  });

  // 监听连接成功事件，自动重新订阅
  wsManager.on('connected', async () => {
    await autoResubscribeOnConnect();
  });

  listenerRegistered = true;
  logger.debug('战绩推送监听器已初始化');

  // 如果 WebSocket 已连接，立即执行订阅
  const wsStatus = wsManager.getStatus();
  if (wsStatus.isConnected) {
    setTimeout(() => autoResubscribeOnConnect(), 100);
  }
}

/** WebSocket 连接成功后自动重新订阅 */
async function autoResubscribeOnConnect (): Promise<void> {
  try {
    const allSubs = subConfig.getAllSubscriptions();
    if (allSubs.size === 0) return;

    const wsManager = getWebSocketManager();

    for (const [platformID, sub] of allSubs.entries()) {
      if (!sub.enabled) continue;

      wsManager.send({
        type: 'record_subscribe',
        platformID,
        recordType: sub.subscriptionType,
      });
    }

    logger.debug(`自动重新订阅完成: ${allSubs.size} 个用户`);
  } catch (error) {
    logger.error('自动重新订阅失败:', error);
  }
}

/** 处理战绩推送 */
async function handleRecordPush (data: any): Promise<void> {
  const { platformId: platformID, frameworkToken, recordType, record, isNew, isRecent } = data;
  const modeText = recordType === 'sol' ? '烽火地带' : recordType === 'mp' ? '全面战场' : `未知(${recordType})`;

  // 判断是否应该处理
  const shouldProcess = isNew !== undefined ? isNew : (isRecent === true);

  if (!shouldProcess) {
    logger.debug(`跳过缓存战绩: ${platformID} | 模式: ${modeText}`);
    return;
  }

  // 生成去重ID
  const mapId = record.MapID || record.MapId;
  const armedForceId = record.ArmedForceId;
  const dtEventTime = record.dtEventTime || '';
  const extraId = recordType === 'sol' ? (record.FinalPrice || '0') : (record.TotalScore || '0');
  const recordId = `${platformID}:${recordType}:${mapId}:${armedForceId}:${dtEventTime}:${extraId}`;

  // 检查是否已推送
  if (subConfig.isPushed(recordId)) {
    logger.debug(`检测到重复推送，已跳过: ${platformID} | 模式: ${modeText}`);
    return;
  }

  subConfig.markAsPushed(recordId);

  logger.debug(`处理新战绩: ${platformID} | 模式: ${modeText}`);

  try {
    const sub = subConfig.getSubscription(platformID);
    if (!sub || !sub.enabled) {
      logger.debug(`用户未订阅或已禁用: ${platformID}`);
      return;
    }

    const pushConfig = subConfig.getUserPushConfig(platformID);
    if (!pushConfig.private && pushConfig.groups.length === 0) {
      logger.warn(`没有推送目标: ${platformID} | 模式: ${modeText}`);
      return;
    }

    // 格式化消息
    const message = await formatRecordMessage(recordType, record, platformID, frameworkToken);

    // 推送到私信
    if (pushConfig.private) {
      const shouldPush = pushConfig.filters.length === 0 ||
        subConfig.checkFilters(recordType, record, pushConfig.filters);

      if (shouldPush) {
        try {
          await sendPrivateMsg(platformID, message);
          logger.debug(`战绩私信推送成功: ${platformID}`);
        } catch (err: any) {
          logger.error(`战绩私信推送失败: ${platformID}`, err.message);
        }
      }
    }

    // 推送到群
    for (const groupConfig of pushConfig.groups) {
      const shouldPush = groupConfig.filters.length === 0 ||
        subConfig.checkFilters(recordType, record, groupConfig.filters);

      if (shouldPush) {
        try {
          await sendGroupMsg(groupConfig.groupId, message);
          logger.debug(`战绩群推送成功: 群${groupConfig.groupId}`);
        } catch (err: any) {
          logger.error(`战绩群推送失败: 群${groupConfig.groupId}`, err.message);
        }
      }
    }
  } catch (err) {
    logger.error(`处理推送失败: ${platformID} | 模式: ${modeText}`, err);
  }
}

/** 格式化战绩消息 */
async function formatRecordMessage (recordType: string, record: any, platformID: string, frameworkToken?: string): Promise<string> {
  const modeText = recordType === 'sol' ? '烽火地带' : '全面战场';
  const mapId = record.MapID || record.MapId;
  const armedForceId = record.ArmedForceId;

  // 获取地图和干员名称
  const mapName = dataManager.getMapName(mapId) || '未知地图';
  const operatorName = dataManager.getOperatorName(armedForceId) || '未知干员';

  // 获取玩家昵称
  let displayName = '未知玩家';
  const cached = nicknameCache.get(platformID);
  if (cached && Date.now() - cached.time < NICKNAME_CACHE_EXPIRE) {
    displayName = cached.name;
  } else if (frameworkToken) {
    displayName = `${frameworkToken.substring(0, 4)}****${frameworkToken.slice(-4)}`;
  }

  let msg = `【${displayName}】战绩推送 - ${modeText}\n`;

  if (recordType === 'sol') {
    const finalPrice = Number(record.FinalPrice || 0).toLocaleString();
    const income = (record.flowCalGainedPrice != null && record.flowCalGainedPrice !== '')
      ? Number(record.flowCalGainedPrice).toLocaleString()
      : '未知';
    const duration = formatDuration(Number(record.DurationS));
    const escapeStatus = ESCAPE_REASONS[String(record.EscapeFailReason)] || '撤离失败';

    msg += `地图: ${mapName}\n`;
    msg += `干员: ${operatorName}\n`;
    msg += `时间: ${record.dtEventTime}\n`;
    msg += `状态: ${escapeStatus}\n`;
    msg += `存活: ${duration}\n`;
    msg += `带出价值: ${finalPrice}\n`;
    msg += `净收益: ${income}\n`;

    const killCount = record.KillCount ?? 0;
    const killAI = record.KillAICount ?? 0;
    const killPlayerAI = record.KillPlayerAICount ?? 0;
    msg += `击杀: 玩家(${killCount}) / AI(${killAI}) / AI玩家(${killPlayerAI})`;

    if (record.Rescue != null && record.Rescue > 0) {
      msg += `\n救援: ${record.Rescue}次`;
    }
  } else {
    const duration = formatDuration(Number(record.gametime));
    const result = MP_RESULTS[String(record.MatchResult)] || '未知结果';

    msg += `地图: ${mapName}\n`;
    msg += `干员: ${operatorName}\n`;
    msg += `时间: ${record.dtEventTime}\n`;
    msg += `结果: ${result}\n`;
    msg += `K/D/A: ${record.KillNum}/${record.Death}/${record.Assist}\n`;
    msg += `得分: ${record.TotalScore.toLocaleString()}\n`;
    msg += `时长: ${duration}`;

    if (record.RescueTeammateCount != null && record.RescueTeammateCount > 0) {
      msg += `\n救援: ${record.RescueTeammateCount}次`;
    }
  }

  return msg;
}

/** 格式化时长 */
function formatDuration (seconds: number): string {
  if (!seconds && seconds !== 0) return '未知';
  if (seconds === 0) return '0秒';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) return `${hours}小时${minutes}分${secs}秒`;
  if (minutes > 0) return `${minutes}分${secs}秒`;
  return `${secs}秒`;
}

export default {
  commands,
  subscribeRecord,
  unsubscribeRecord,
  getSubscriptionStatus,
  enableGroupPush,
  disableGroupPush,
  enablePrivatePush,
  disablePrivatePush,
  initRecordPushListener,
};
