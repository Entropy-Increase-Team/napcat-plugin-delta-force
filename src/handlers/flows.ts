/**
 * 流水查询处理器
 * 查询游戏内交易流水
 */

import type { OB11Message } from 'napcat-types';
import { createApi } from '../core/api';
import { reply, replyAt, getUserId } from '../utils/message';
import { getAccount } from '../utils/account';
import type { CommandDef } from '../utils/command';

/** 流水 API 错误检查 (按原插件逻辑) */
function isFlowsApiError (res: any): { error: boolean; msg: string; } {
  if (!res || typeof res !== 'object') {
    return { error: true, msg: 'API未返回数据' };
  }
  if (res.code === '1000' || res.code === '1001' || res.code === '1100' || res.success === false) {
    return { error: true, msg: res.msg || res.message || 'API错误' };
  }
  if (res.data?.ret === 101 || res.error?.includes('请先完成QQ或微信登录') ||
    res.sMsg?.includes('请先登录') || res.data?.ret === 99998 || res.message?.includes('先绑定大区')) {
    return { error: true, msg: res.message || res.sMsg || '需要登录或绑定大区' };
  }
  if (res.code !== undefined && res.code !== null && res.code !== 0 && res.code !== '0') {
    return { error: true, msg: res.msg || res.message || 'API错误' };
  }
  return { error: false, msg: '' };
}

/** 流水类型映射 */
const TYPE_MAP: Record<string, number> = {
  '设备': 1,
  '道具': 2,
  '货币': 3,
};

/** 命令定义 */
export const commands: CommandDef[] = [
  { keywords: ['流水', 'flows'], handler: 'getFlows', name: '流水查询', hasArgs: true },
];

/** URL 解码 */
function decodeReason (reason: string | undefined): string {
  try {
    return decodeURIComponent(reason || '') || '未知原因';
  } catch {
    return reason || '未知原因';
  }
}

/** 格式化时间 */
function formatTime (time: string): string {
  if (!time) return '未知';
  // 提取日期时间部分
  const match = time.match(/(\d{4}[-/]\d{2}[-/]\d{2})\s*(\d{2}:\d{2})/);
  if (match) {
    return `${match[1]} ${match[2]}`;
  }
  return time.substring(0, 16);
}

/** 流水查询 */
export async function getFlows (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  // 解析参数
  const argList = args.trim().split(/\s+/).filter(Boolean);
  let typeStr = '';
  let page = 1;

  for (const arg of argList) {
    if (['设备', '道具', '货币'].includes(arg)) {
      typeStr = arg;
    } else if (/^\d+$/.test(arg)) {
      page = parseInt(arg, 10);
    }
  }

  // 如果没有指定类型，查询所有类型
  if (!typeStr) {
    await reply(msg, '正在查询所有流水类型...');

    let text = '【流水记录汇总】\n\n';

    for (const [typeName, typeValue] of Object.entries(TYPE_MAP)) {
      try {
        const res = await api.getFlows(token, typeValue, page);
        const errCheck = isFlowsApiError(res);

        if (errCheck.error) {
          text += `【${typeName}流水】${errCheck.msg}\n\n`;
          continue;
        }

        const data = (res as any).data?.[0];
        if (!data) {
          text += `【${typeName}流水】无数据\n\n`;
          continue;
        }

        text += `【${typeName}流水】第${page}页\n`;

        switch (typeValue) {
          case 1: // 设备登录
            if (data.LoginArr && data.LoginArr.length > 0) {
              text += `登录记录: ${data.LoginArr.length} 条\n`;
              // 只显示最近3条
              data.LoginArr.slice(0, 3).forEach((r: any, i: number) => {
                text += `${i + 1}. ${formatTime(r.indtEventTime)} - ${r.vClientIP || '未知IP'}\n`;
              });
            } else {
              text += '暂无登录记录\n';
            }
            break;

          case 2: // 道具
            if (data.itemArr && data.itemArr.length > 0) {
              text += `道具记录: ${data.itemArr.length} 条\n`;
              data.itemArr.slice(0, 3).forEach((r: any, i: number) => {
                text += `${i + 1}. ${r.Name || '未知'} ${r.AddOrReduce || ''} - ${decodeReason(r.Reason)}\n`;
              });
            } else {
              text += '暂无道具记录\n';
            }
            break;

          case 3: // 货币
            if (data.iMoneyArr && data.iMoneyArr.length > 0) {
              text += `货币记录: ${data.iMoneyArr.length} 条\n`;
              data.iMoneyArr.slice(0, 3).forEach((r: any, i: number) => {
                text += `${i + 1}. ${r.AddOrReduce || '0'} | 余额: ${r.leftMoney || '未知'} - ${decodeReason(r.Reason)}\n`;
              });
            } else {
              text += '暂无货币记录\n';
            }
            break;
        }

        text += '\n';
      } catch (error) {
        text += `【${typeName}流水】查询异常\n\n`;
      }
    }

    text += `提示: 使用 "流水 类型 页码" 查询指定类型\n支持类型: 设备、道具、货币`;
    await reply(msg, text.trim());
    return true;
  }

  // 查询指定类型
  const typeValue = TYPE_MAP[typeStr];
  if (!typeValue) {
    await reply(msg, '未知的流水类型，支持: 设备、道具、货币');
    return true;
  }

  await reply(msg, `正在查询${typeStr}流水 (第${page}页)...`);

  const res = await api.getFlows(token, typeValue, page);
  const errCheck = isFlowsApiError(res);
  if (errCheck.error) {
    await reply(msg, `查询失败: ${errCheck.msg}`);
    return true;
  }

  const data = (res as any).data?.[0];
  if (!data) {
    await reply(msg, '暂无流水数据');
    return true;
  }

  let text = `【${typeStr}流水】第${page}页\n\n`;

  switch (typeValue) {
    case 1: // 设备登录
      if (data.vRoleName) {
        text += `角色: ${data.vRoleName} | 等级: ${data.Level || '未知'}\n`;
        text += `累计登录: ${data.loginDay || 0} 天\n\n`;
      }

      if (data.LoginArr && data.LoginArr.length > 0) {
        text += `登录记录 (${data.LoginArr.length} 条):\n`;
        data.LoginArr.slice(0, 10).forEach((r: any, i: number) => {
          text += `${i + 1}. 登入: ${formatTime(r.indtEventTime)}\n`;
          text += `   登出: ${formatTime(r.outdtEventTime)}\n`;
          text += `   IP: ${r.vClientIP || '未知'} | 设备: ${(r.SystemHardware || '未知').substring(0, 15)}\n`;
        });
        if (data.LoginArr.length > 10) {
          text += `... 还有 ${data.LoginArr.length - 10} 条记录`;
        }
      } else {
        text += '暂无登录记录';
      }
      break;

    case 2: // 道具
      if (data.itemArr && data.itemArr.length > 0) {
        text += `道具记录 (${data.itemArr.length} 条):\n`;
        data.itemArr.slice(0, 15).forEach((r: any, i: number) => {
          const changeType = String(r.AddOrReduce || '').startsWith('+') ? '📥' : '📤';
          text += `${changeType} ${r.Name || '未知物品'} ${r.AddOrReduce || ''}\n`;
          text += `   ${formatTime(r.dtEventTime)} - ${decodeReason(r.Reason)}\n`;
        });
        if (data.itemArr.length > 15) {
          text += `... 还有 ${data.itemArr.length - 15} 条记录`;
        }
      } else {
        text += '暂无道具记录';
      }
      break;

    case 3: // 货币
      if (data.iMoneyArr && data.iMoneyArr.length > 0) {
        text += `货币记录 (${data.iMoneyArr.length} 条):\n`;
        data.iMoneyArr.slice(0, 15).forEach((r: any, i: number) => {
          const changeType = String(r.AddOrReduce || '').startsWith('+') ? '💰' : '💸';
          text += `${changeType} ${r.AddOrReduce || '0'} | 余额: ${r.leftMoney || '未知'}\n`;
          text += `   ${formatTime(r.dtEventTime)} - ${decodeReason(r.Reason)}\n`;
        });
        if (data.iMoneyArr.length > 15) {
          text += `... 还有 ${data.iMoneyArr.length - 15} 条记录`;
        }
      } else {
        text += '暂无货币记录';
      }
      break;
  }

  await reply(msg, text.trim());
  return true;
}

export default {
  commands,
  getFlows,
};
