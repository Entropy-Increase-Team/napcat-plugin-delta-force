/**
 * 信息查询处理器
 */

import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types';
import { pluginState } from '../core/state';
import { createApi } from '../core/api';
import { reply, replyAt, getUserId } from '../utils/message';
import { handleApiError as _handleApiError } from '../utils/error-handler';
import { getAccount } from '../utils/account';
import type { CommandDef } from '../utils/command';

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
  { keywords: ['信息', 'info'], handler: 'getUserInfo', name: '个人信息' },
  { keywords: ['uid', 'UID'], handler: 'getUid', name: 'UID查询', hasArgs: true },
];

/** 获取个人信息 */
export async function getUserInfo (ctx: NapCatPluginContext, msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  await reply(msg, '正在查询个人信息...');

  const res = await api.getPersonalInfo(token);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data) {
    await reply(msg, '获取个人信息失败');
    return true;
  }

  const data = (res as any).data;
  const roleInfo = (res as any).roleInfo || {};

  const decode = (str: string | undefined) => {
    try {
      return decodeURIComponent(str || '');
    } catch {
      return str || '';
    }
  };

  // 按原插件逻辑获取数据
  const name = decode(data.userData?.charac_name || roleInfo.charac_name);
  const level = roleInfo.level || '-';
  const uid = roleInfo.uid || '未获取到';

  let text = '【三角洲行动-个人信息】\n';
  text += `昵称: ${name || '未知'}\n`;
  text += `等级: ${level}\n`;
  text += `UID: ${uid}\n`;

  await reply(msg, text.trim());
  return true;
}

/** 获取 UID */
export async function getUid (ctx: NapCatPluginContext, msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  const res = await api.getPersonalInfo(token);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data) {
    await reply(msg, '获取 UID 失败');
    return true;
  }

  const roleInfo = (res as any).roleInfo || {};
  const nickName = roleInfo.charac_name || '未知';
  const uid = roleInfo.uid || '未获取到';

  await replyAt(msg, `\n昵称: ${nickName}\nUID: ${uid}`);
  return true;
}

export default {
  commands,
  getUserInfo,
  getUid,
};
