/**
 * WebSocket 处理器
 * 管理 WebSocket 连接、订阅和广播通知
 */

import type { OB11Message } from '../types/index';
import type { CommandDef } from '../utils/command';
import { pluginState } from '../core/state';
import { reply, getUserId, sendGroupMsg, sendPrivateMsg } from '../utils/message';
import { getWebSocketManager } from '../services/websocket';

/** 命令定义 */
export const commands: CommandDef[] = [
  { keywords: ['ws连接', 'ws启动', 'ws开启', 'WS连接'], handler: 'wsConnect', name: 'WS连接' },
  { keywords: ['ws断开', 'ws关闭', 'ws停止', 'WS断开'], handler: 'wsDisconnect', name: 'WS断开' },
  { keywords: ['ws状态', 'WS状态'], handler: 'wsStatus', name: 'WS状态' },
  { keywords: ['广播开启', '通知开启', '广播启用', '通知启用'], handler: 'enableNotification', name: '广播开启' },
  { keywords: ['广播关闭', '通知关闭', '广播禁用', '通知禁用'], handler: 'disableNotification', name: '广播关闭' },
  { keywords: ['广播状态', '通知状态', '广播设置', '通知设置'], handler: 'getNotificationStatus', name: '广播状态' },
];

/** 广播通知缓存 (防止重复推送) */
const notificationCache = new Set<string>();
const CACHE_EXPIRE_TIME = 5 * 60 * 1000;

/** 检查是否为管理员 */
function isMaster (userId: string): boolean {
  const masters = pluginState.config.master_qq?.split(',').map(s => s.trim()).filter(Boolean) || [];
  return masters.includes(userId);
}

/** 连接 WebSocket */
export async function wsConnect (msg: OB11Message): Promise<boolean> {
  const userId = getUserId(msg);

  if (!isMaster(userId)) {
    await reply(msg, '⚠️ 抱歉，只有机器人主人才能管理 WebSocket 连接');
    return true;
  }

  const clientID = pluginState.config.clientID;
  if (!clientID || clientID === 'xxxxxx') {
    await reply(msg, 'clientID 未配置，请先在配置中设置');
    return true;
  }

  const wsManager = getWebSocketManager();
  const status = wsManager.getStatus();

  if (status.isConnected) {
    await reply(msg, 'WebSocket 已经连接');
    return true;
  }

  if (status.isConnecting) {
    await reply(msg, 'WebSocket 正在连接中，请稍候...');
    return true;
  }

  await reply(msg, '正在连接 WebSocket 服务器...');

  try {
    const options = {
      clientID: clientID,
      platformID: userId,
      clientType: msg.group_id ? 'group' : 'private',
    };

    await wsManager.connect(options);

    // 等待连接就绪
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 5000);
      wsManager.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    const statusAfter = wsManager.getStatus();
    if (statusAfter.isConnected) {
      let text = '✅ WebSocket 连接成功！\n\n';
      text += `客户端ID: ${statusAfter.connectionInfo.clientId || '-'}\n`;
      text += `可用频道: ${statusAfter.availableChannels.length} 个\n\n`;
      text += 'WebSocket 已就绪，可用于实时推送';
      await reply(msg, text);
    } else {
      await reply(msg, 'WebSocket 连接超时，请稍后使用 ws状态 查看');
    }
  } catch (error: any) {
    pluginState.log('error', 'WebSocket 连接失败:', error);
    await reply(msg, `WebSocket 连接失败: ${error.message}\n请检查配置和网络连接`);
  }

  return true;
}

/** 断开 WebSocket */
export async function wsDisconnect (msg: OB11Message): Promise<boolean> {
  const userId = getUserId(msg);

  if (!isMaster(userId)) {
    await reply(msg, '⚠️ 抱歉，只有机器人主人才能管理 WebSocket 连接');
    return true;
  }

  const wsManager = getWebSocketManager();
  const status = wsManager.getStatus();

  if (!status.isConnected && !status.isConnecting) {
    await reply(msg, 'WebSocket 未连接');
    return true;
  }

  wsManager.disconnect(true);
  await reply(msg, '✅ WebSocket 已断开连接');
  return true;
}

/** 获取 WebSocket 状态 */
export async function wsStatus (msg: OB11Message): Promise<boolean> {
  const userId = getUserId(msg);

  if (!isMaster(userId)) {
    await reply(msg, '⚠️ 抱歉，只有机器人主人才能查看 WebSocket 状态');
    return true;
  }

  const wsManager = getWebSocketManager();
  const status = wsManager.getStatus();

  let text = '【WebSocket 状态】\n\n';
  text += `连接状态: ${status.isConnected ? '✅ 已连接' : '❌ 未连接'}\n`;

  if (status.isConnecting) {
    text += '状态: 正在连接中...\n';
  }

  if (status.isConnected) {
    text += `\n客户端ID: ${status.connectionInfo.clientId || '-'}\n`;
    text += `可用频道: ${status.availableChannels.length} 个\n`;

    if (status.subscriptions.length > 0) {
      text += `\n已订阅频道:\n`;
      status.subscriptions.forEach((ch, idx) => {
        text += `  ${idx + 1}. ${ch}\n`;
      });
    }

    text += '\n使用 ws断开 可断开连接';
  } else {
    text += '\n使用 ws连接 可建立连接';
  }

  await reply(msg, text.trim());
  return true;
}

// ==================== 广播通知功能 ====================

/** 启用广播通知 */
export async function enableNotification (msg: OB11Message): Promise<boolean> {
  const userId = getUserId(msg);

  if (!isMaster(userId)) {
    await reply(msg, '⚠️ 抱歉，只有机器人主人才能管理广播通知');
    return true;
  }

  const config = pluginState.getConfig();
  if (config.broadcast_notification?.enabled) {
    await reply(msg, '广播通知已经是启用状态');
    return true;
  }

  // 更新配置
  const newConfig = {
    ...config,
    broadcast_notification: {
      enabled: true,
      push_to: config.broadcast_notification?.push_to || {
        group: [],
        private_enabled: false,
        private: [],
      },
    },
  };
  pluginState.updateConfig(newConfig);

  // 如果 WebSocket 已连接，订阅频道
  const wsManager = getWebSocketManager();
  const status = wsManager.getStatus();

  if (status.isConnected) {
    try {
      await wsManager.subscribe('notification:broadcast');
      await reply(msg, '✅ 广播通知已启用\n\n提示：使用 三角洲通知状态 查看详细配置');
    } catch (error) {
      pluginState.log('error', '订阅广播频道失败:', error);
      await reply(msg, '✅ 广播通知已启用\n\n⚠️ 订阅频道失败，将在重连后自动订阅');
    }
  } else {
    await reply(msg, '✅ 广播通知已启用\n\nWebSocket 未连接，将在连接后自动订阅\n使用 三角洲ws连接 来连接');
  }

  return true;
}

/** 禁用广播通知 */
export async function disableNotification (msg: OB11Message): Promise<boolean> {
  const userId = getUserId(msg);

  if (!isMaster(userId)) {
    await reply(msg, '⚠️ 抱歉，只有机器人主人才能管理广播通知');
    return true;
  }

  const config = pluginState.getConfig();
  if (!config.broadcast_notification?.enabled) {
    await reply(msg, '广播通知已经是禁用状态');
    return true;
  }

  // 更新配置
  const newConfig = {
    ...config,
    broadcast_notification: {
      ...config.broadcast_notification,
      enabled: false,
    },
  };
  pluginState.updateConfig(newConfig);

  // 取消订阅
  const wsManager = getWebSocketManager();
  const status = wsManager.getStatus();

  if (status.isConnected) {
    try {
      await wsManager.unsubscribe('notification:broadcast');
    } catch (error) {
      pluginState.log('warn', '取消订阅广播频道失败:', error);
    }
  }

  await reply(msg, '✅ 广播通知已禁用');
  return true;
}

/** 获取广播通知状态 */
export async function getNotificationStatus (msg: OB11Message): Promise<boolean> {
  const userId = getUserId(msg);

  if (!isMaster(userId)) {
    await reply(msg, '⚠️ 抱歉，只有机器人主人才能查看通知设置');
    return true;
  }

  const config = pluginState.getConfig();
  const cfg = config.broadcast_notification || {};
  const wsManager = getWebSocketManager();
  const wsStatus = wsManager.getStatus();

  let text = '【广播通知设置】\n';
  text += `功能状态：${cfg.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`;
  text += `WebSocket：${wsStatus.isConnected ? '✅ 已连接' : '❌ 未连接'}\n`;

  text += '\n【推送目标群】\n';
  if (cfg.push_to?.group && cfg.push_to.group.length > 0) {
    text += `群聊：${cfg.push_to.group.join(', ')} (共${cfg.push_to.group.length}个)\n`;
  } else {
    text += '未配置 (请在Web面板中配置)\n';
  }

  text += '\n【推送私信】\n';
  if (cfg.push_to?.private_enabled) {
    const privateList = cfg.push_to?.private || [];
    if (privateList.length > 0) {
      text += `QQ号：${privateList.join(', ')} (共${privateList.length}个)\n`;
    } else {
      text += '默认推送给主人\n';
    }
  } else {
    text += '未启用\n';
  }

  if (cfg.enabled && !wsStatus.isConnected) {
    text += '\n⚠️ WebSocket 未连接，使用 三角洲ws连接';
  }

  await reply(msg, text.trim());
  return true;
}

/** 格式化通知消息 */
function formatNotificationMessage (notification: any): string {
  const priorityLabels: Record<string, string> = {
    low: '低',
    normal: '普通',
    high: '重要',
    urgent: '紧急',
  };

  const typeLabel = notification.type || '系统通知';
  const priorityLabel = priorityLabels[notification.priority] || '普通';

  let text = '【Delta-Force-Plugin 广播通知】\n';
  text += '\n';
  text += `【类型】${typeLabel}\n`;
  text += `【程度】${priorityLabel}\n`;
  text += `【标题】${notification.title}\n`;
  text += `【内容】\n${notification.content}\n`;

  const time = new Date(notification.timestamp);
  const timeStr = time.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  text += '\n';
  text += `${timeStr}\n`;

  return text;
}

/** 处理广播通知 (由 WebSocket 服务调用) */
export async function handleBroadcastNotification (data: any): Promise<void> {
  const config = pluginState.getConfig();
  const cfg = config.broadcast_notification;

  if (!cfg?.enabled) {
    pluginState.logDebug('广播通知功能未启用，跳过推送');
    return;
  }

  const notification = data.notification;
  if (!notification) {
    pluginState.log('warn', '收到的广播通知数据无效:', data);
    return;
  }

  // 去重检查
  if (notificationCache.has(notification.id)) {
    pluginState.logDebug(`广播通知已推送过，跳过: ${notification.id}`);
    return;
  }

  // 添加到缓存
  notificationCache.add(notification.id);
  setTimeout(() => {
    notificationCache.delete(notification.id);
  }, CACHE_EXPIRE_TIME);

  // 格式化消息
  const message = formatNotificationMessage(notification);

  let successCount = 0;
  let failCount = 0;

  // 推送到目标群
  const targetGroups = cfg.push_to?.group || [];
  for (const groupId of targetGroups) {
    try {
      await sendGroupMsg(groupId, message);
      successCount++;
      pluginState.logDebug(`广播通知推送成功 → 群 ${groupId}`);
    } catch (error: any) {
      failCount++;
      pluginState.log('error', `广播通知推送失败 → 群 ${groupId}:`, error.message);
    }
  }

  // 推送到私信
  if (cfg.push_to?.private_enabled) {
    let privateTargets = cfg.push_to?.private || [];

    // 如果没有配置私信列表，默认推送给主人
    if (privateTargets.length === 0) {
      const masterQQ = config.master_qq;
      if (masterQQ) {
        privateTargets = masterQQ.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    }

    for (const userId of privateTargets) {
      try {
        await sendPrivateMsg(userId, message);
        successCount++;
        pluginState.logDebug(`广播通知推送成功 → 私信 ${userId}`);
      } catch (error: any) {
        failCount++;
        pluginState.log('error', `广播通知推送失败 → 私信 ${userId}:`, error.message);
      }
    }
  }

  const total = targetGroups.length + (cfg.push_to?.private_enabled ? (cfg.push_to?.private?.length || 1) : 0);
  if (total === 0) {
    pluginState.log('warn', '广播通知未配置任何推送目标');
    pluginState.log('info', `收到广播通知: ${notification.title}`);
  } else {
    pluginState.log('info', `广播通知推送完成: ${notification.title} | 成功 ${successCount}/${total}`);
  }
}

/** 初始化广播通知监听器 */
export function initBroadcastNotificationListener (): void {
  const wsManager = getWebSocketManager();

  wsManager.on('notification_broadcast', async (data: any) => {
    try {
      await handleBroadcastNotification(data);
    } catch (error) {
      pluginState.log('error', '处理广播通知失败:', error);
    }
  });

  pluginState.logDebug('广播通知监听器已注册');
}
