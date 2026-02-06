/**
 * 服务器状态处理器
 * 查询API服务器运行状态
 */

import type { OB11Message } from '../types/index';
import type { CommandDef } from '../utils/command';
import { createApi } from '../core/api';
import { pluginState } from '../core/state';
import { reply } from '../utils/message';

/** 命令定义 */
export const commands: CommandDef[] = [
  { keywords: ['服务器状态'], handler: 'getServerHealth', name: '服务器状态' },
];

/** 格式化详细健康状态 */
function formatHealthStatus (data: any): string {
  const status = data.status || 'unknown';
  const cluster = data.cluster || {};
  const system = data.system || {};
  const dependencies = data.dependencies || {};

  const statusText = status === 'healthy' ? '✅ 在线' : status === 'unhealthy' ? '❌ 离线' : '⚠️ 未知';
  const nodeTypeName = cluster.nodeType === 'master' ? '主节点' : cluster.nodeType === 'worker' ? '从节点' : '未知节点';
  const uptime = system.uptime || 0;
  const uptimeHours = uptime > 0 ? (uptime / 3600).toFixed(1) : '0';

  const memory = system.memory || {};
  const memoryInfo = memory.rss && memory.heapUsed && memory.heapTotal
    ? `RSS ${memory.rss}MB，堆内存 ${memory.heapUsed}/${memory.heapTotal}MB`
    : '内存信息不可用';

  const mongoStatus = dependencies.mongodb?.status === 'connected' ? '✅ 正常' : '❌ 异常';
  const redisStatus = dependencies.redis?.status === 'connected' ? '✅ 正常' : '❌ 异常';

  let msg = `【三角洲插件-服务器状态】\n`;
  msg += `服务状态：${statusText}\n`;

  if (cluster.nodeId) {
    msg += `节点信息：${cluster.nodeId} (${nodeTypeName})\n`;
  } else {
    msg += `节点信息：${nodeTypeName}\n`;
  }

  msg += `运行时间：${uptimeHours}小时\n`;

  if (system.platform) {
    msg += `系统平台：${system.platform}\n`;
  }

  msg += `内存使用：${memoryInfo}\n`;

  if (dependencies.mongodb || dependencies.redis) {
    msg += `数据库连接：MongoDB ${mongoStatus}，Redis ${redisStatus}`;
  } else {
    msg += `数据库连接：状态信息不可用`;
  }

  return msg;
}

/** 格式化简单状态 */
function formatSimpleStatus (data: any): string {
  const status = data.status || 'unknown';
  const statusText = status === 'healthy' ? '✅ 在线' : status === 'unhealthy' ? '❌ 离线' : '⚠️ 未知';

  let msg = `【三角洲插件-服务器状态】\n`;
  msg += `服务状态：${statusText}\n`;

  if (data.message) {
    msg += `消息：${data.message}\n`;
  }

  if (data.timestamp) {
    const time = new Date(data.timestamp).toLocaleString();
    msg += `检查时间：${time}`;
  }

  return msg;
}

/** 格式化离线状态 */
function formatOfflineStatus (errorInfo: string): string {
  const currentTime = new Date().toLocaleString();
  return `【三角洲插件-服务器状态】\n服务状态：❌ 离线\n错误信息：${errorInfo}\n检查时间：${currentTime}`;
}

/** 获取服务器健康状态 */
export async function getServerHealth (msg: OB11Message): Promise<boolean> {
  const api = createApi();

  try {
    const res = await api.getServerHealth();

    // 能获取到响应且格式正确，显示详细状态
    if (res && typeof res === 'object' && (res as any).status) {
      const statusMsg = formatHealthStatus(res);
      await reply(msg, statusMsg);
      return true;
    }

    // 响应格式不正确但有数据，显示简单状态
    if (res && typeof res === 'object') {
      const statusMsg = formatSimpleStatus(res);
      await reply(msg, statusMsg);
      return true;
    }

    // 没有响应，显示离线状态
    await reply(msg, formatOfflineStatus('无响应'));
  } catch (error: any) {
    pluginState.log('error', '服务器状态查询异常:', error);

    let errorInfo = '未知错误';
    if (error.message) {
      if (error.message.includes('502')) {
        errorInfo = '502 Bad Gateway';
      } else if (error.message.includes('503')) {
        errorInfo = '503 Service Unavailable';
      } else if (error.message.includes('500')) {
        errorInfo = '500 Internal Server Error';
      } else if (error.message.includes('404')) {
        errorInfo = '404 Not Found';
      } else if (error.message.includes('timeout')) {
        errorInfo = '请求超时';
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        errorInfo = '连接被拒绝';
      } else {
        errorInfo = error.message;
      }
    }

    await reply(msg, formatOfflineStatus(errorInfo));
  }

  return true;
}
