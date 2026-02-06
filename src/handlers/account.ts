/**
 * 账号管理处理器
 */

import type { OB11Message } from 'napcat-types';
import { pluginState } from '../core/state';
import { createApi } from '../core/api';
import { reply, replyAt, getUserId, isGroupMsg } from '../utils/message';
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
  { keywords: ['账号', '账号列表'], handler: 'showAccounts', name: '账号列表' },
  { keywords: ['绑定'], handler: 'bindToken', name: '绑定Token', hasArgs: true },
  { keywords: ['解绑'], handler: 'unbindToken', name: '解绑账号', hasArgs: true },
  { keywords: ['删除'], handler: 'deleteToken', name: '删除登录', hasArgs: true },
  { keywords: ['账号切换', '切换账号'], handler: 'switchAccount', name: '切换账号', hasArgs: true },
  { keywords: ['微信刷新', '刷新微信'], handler: 'refreshWechat', name: '刷新微信' },
  { keywords: ['qq刷新', 'QQ刷新', '刷新qq', '刷新QQ'], handler: 'refreshQq', name: '刷新QQ' },
];

/** 显示账号列表 */
export async function showAccounts (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const config = pluginState.getConfig();

  if (!config.clientID || config.clientID === 'xxxxxx') {
    await reply(msg, 'clientID 未配置，请联系管理员');
    return true;
  }

  const res = await api.getUserList({ clientID: config.clientID, platformID: userId, clientType: 'napcat' });

  if (!res || (res as any).code !== 0) {
    await reply(msg, '获取账号列表失败');
    return true;
  }

  const accounts = (res as any).data || [];
  if (accounts.length === 0) {
    await replyAt(msg, '您尚未绑定任何账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  // 自动激活第一个有效账号（如果当前没有激活的 token）
  const currentToken = await getAccount(userId);
  if (!currentToken) {
    const validAccount = accounts.find((acc: any) => acc.isValid && acc.frameworkToken);
    if (validAccount) {
      pluginState.setActiveToken(userId, validAccount.frameworkToken);
    }
  }

  const activeToken = await getAccount(userId);
  const isGroup = isGroupMsg(msg);
  let text = '【账号列表】\n';

  accounts.forEach((acc: any, idx: number) => {
    const token = acc.frameworkToken;
    const displayToken = isGroup ? `${token.substring(0, 4)}****${token.slice(-4)}` : token;
    const status = acc.isValid ? '【有效】' : '【失效】';
    const active = token === activeToken ? ' ★当前' : '';
    text += `${idx + 1}. 【${acc.tokenType?.toUpperCase() || '未知'}】 ${displayToken} ${status}${active}\n`;
  });

  text += '\n使用 三角洲账号切换 <序号> 切换账号';

  await reply(msg, text.trim());
  return true;
}

/** 绑定 Token */
export async function bindToken (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const config = pluginState.getConfig();

  if (!config.clientID || config.clientID === 'xxxxxx') {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  const token = args.trim();
  if (!token) {
    await reply(msg, '请提供 Token，格式：三角洲绑定 <token>');
    return true;
  }

  const res = await api.bindUser({
    frameworkToken: token,
    platformID: userId,
    clientID: config.clientID,
    clientType: 'napcat',
  });

  if (res && ((res as any).code === 0 || (res as any).success)) {
    await reply(msg, '账号绑定成功！');
  } else {
    await reply(msg, `绑定失败: ${(res as any)?.msg || '未知错误'}`);
  }
  return true;
}

/** 解绑 Token */
export async function unbindToken (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const config = pluginState.getConfig();

  if (!config.clientID || config.clientID === 'xxxxxx') {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  const index = parseInt(args.trim(), 10);
  if (isNaN(index) || index < 1) {
    await reply(msg, '请提供有效的序号，格式：三角洲解绑 <序号>');
    return true;
  }

  // 获取账号列表
  const res = await api.getUserList({ clientID: config.clientID, platformID: userId, clientType: 'napcat' });

  if (!res || (res as any).code !== 0) {
    await reply(msg, '获取账号列表失败');
    return true;
  }

  const accounts = (res as any).data || [];
  if (accounts.length === 0) {
    await reply(msg, '您尚未绑定任何账号');
    return true;
  }

  if (index > accounts.length) {
    await reply(msg, `序号超出范围，当前共有 ${accounts.length} 个账号`);
    return true;
  }

  const tokenToUnbind = accounts[index - 1].frameworkToken;
  const tokenType = accounts[index - 1].tokenType?.toUpperCase() || '未知';

  // 执行解绑
  const unbindRes = await api.unbindUser({
    frameworkToken: tokenToUnbind,
    platformID: userId,
    clientID: config.clientID,
    clientType: 'napcat',
  });

  if (unbindRes && ((unbindRes as any).code === 0 || (unbindRes as any).success)) {
    // 如果解绑的是当前激活账号，清除激活状态
    const activeToken = await getAccount(userId);
    if (activeToken === tokenToUnbind) {
      pluginState.setActiveToken(userId, '');
    }
    await reply(msg, `账号 ${index}【${tokenType}】解绑成功！`);
  } else {
    await reply(msg, `解绑失败: ${(unbindRes as any)?.msg || (unbindRes as any)?.message || '未知错误'}`);
  }
  return true;
}

/** 删除 Token (删除 QQ/微信登录数据) */
export async function deleteToken (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const config = pluginState.getConfig();

  if (!config.clientID || config.clientID === 'xxxxxx') {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  const index = parseInt(args.trim(), 10);
  if (isNaN(index) || index < 1) {
    await reply(msg, '请提供有效的序号，格式：三角洲删除 <序号>');
    return true;
  }

  // 获取账号列表
  const res = await api.getUserList({ clientID: config.clientID, platformID: userId, clientType: 'napcat' });

  if (!res || (res as any).code !== 0) {
    await reply(msg, '获取账号列表失败');
    return true;
  }

  const accounts = (res as any).data || [];
  if (accounts.length === 0) {
    await reply(msg, '您尚未绑定任何账号');
    return true;
  }

  if (index > accounts.length) {
    await reply(msg, `序号超出范围，当前共有 ${accounts.length} 个账号`);
    return true;
  }

  const targetAccount = accounts[index - 1];
  const tokenType = targetAccount.tokenType?.toLowerCase();
  const tokenToDelete = targetAccount.frameworkToken;

  // 只支持删除 QQ 和微信登录数据
  if (!['qq', 'wechat'].includes(tokenType)) {
    await reply(msg, `该账号类型（${targetAccount.tokenType}）不支持删除操作\n删除功能仅支持 QQ 和微信登录数据`);
    return true;
  }

  await reply(msg, `正在删除 ${targetAccount.tokenType?.toUpperCase()} 登录数据，请稍候...`);

  // 根据类型调用不同的删除接口
  let deleteRes;
  if (tokenType === 'qq') {
    deleteRes = await api.deleteQqLogin(tokenToDelete);
  } else {
    deleteRes = await api.deleteWechatLogin(tokenToDelete);
  }

  if (await checkApiError(deleteRes, msg)) return true;

  if (deleteRes && ((deleteRes as any).success || (deleteRes as any).code === 0)) {
    // 删除成功后，同时解绑该账号
    const unbindRes = await api.unbindUser({
      frameworkToken: tokenToDelete,
      platformID: userId,
      clientID: config.clientID,
      clientType: 'napcat',
    });

    // 如果删除的是当前激活账号，清除激活状态
    const activeToken = await getAccount(userId);
    if (activeToken === tokenToDelete) {
      pluginState.setActiveToken(userId, '');
    }

    if (unbindRes && ((unbindRes as any).code === 0 || (unbindRes as any).success)) {
      await reply(msg, `${targetAccount.tokenType?.toUpperCase()} 登录数据删除成功！账号已自动解绑`);
    } else {
      await reply(msg, `${targetAccount.tokenType?.toUpperCase()} 登录数据删除成功！但账号解绑失败，请手动解绑`);
    }
  } else {
    await reply(msg, `删除失败: ${(deleteRes as any)?.message || (deleteRes as any)?.msg || '未知错误'}`);
  }
  return true;
}

/** 切换账号 */
export async function switchAccount (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const config = pluginState.getConfig();

  if (!config.clientID || config.clientID === 'xxxxxx') {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  const index = parseInt(args.trim(), 10);
  if (isNaN(index) || index < 1) {
    await reply(msg, '请提供有效的序号，格式：三角洲账号切换 <序号>');
    return true;
  }

  // 获取账号列表
  const res = await api.getUserList({ clientID: config.clientID, platformID: userId, clientType: 'napcat' });

  if (!res || (res as any).code !== 0) {
    await reply(msg, '获取账号列表失败');
    return true;
  }

  const accounts = (res as any).data || [];
  if (accounts.length === 0) {
    await reply(msg, '您尚未绑定任何账号');
    return true;
  }

  if (index > accounts.length) {
    await reply(msg, `序号超出范围，当前共有 ${accounts.length} 个账号`);
    return true;
  }

  const selectedAccount = accounts[index - 1];
  if (!selectedAccount.isValid) {
    await reply(msg, '该账号已失效，请重新登录');
    return true;
  }

  // 设置激活的 token
  pluginState.setActiveToken(userId, selectedAccount.frameworkToken);

  const tokenType = selectedAccount.tokenType?.toUpperCase() || '未知';
  await reply(msg, `已切换到账号 ${index}【${tokenType}】`);
  return true;
}

/** 刷新微信（与原版 Account.js refreshWechat 一致） */
export async function refreshWechat (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await reply(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定。');
    return true;
  }

  await reply(msg, '正在刷新微信登录状态，请稍候...');
  const res = await api.refreshLogin('wechat', token) as any;

  if (await checkApiError(res, msg)) return true;

  if (res?.success) {
    await reply(msg, '微信登录状态刷新成功！');
  } else {
    await reply(msg, `刷新失败：${res?.message || '未知错误'}`);
  }
  return true;
}

/** 刷新 QQ（与原版 Account.js refreshQq 一致） */
export async function refreshQq (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await reply(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定。');
    return true;
  }

  await reply(msg, '正在刷新QQ登录状态，请稍候...');
  const res = await api.refreshLogin('qq', token) as any;

  if (await checkApiError(res, msg)) return true;

  if (res?.success) {
    const data = res.data || {};
    let text = 'QQ登录状态刷新成功！';

    // 显示刷新后的详细信息
    if (data.expires_in) {
      const hours = Math.floor(data.expires_in / 3600);
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;

      if (days > 0) {
        text += `\n有效期：${days}天${remainingHours}小时`;
      } else {
        text += `\n有效期：${hours}小时`;
      }
    }

    if (data.qqnumber) {
      const maskedQQ = `${data.qqnumber.slice(0, 4)}****`;
      text += `\nQQ号：${maskedQQ}`;
    }

    await reply(msg, text);
  } else {
    await reply(msg, `QQ登录状态刷新失败：${res?.message || res?.msg || '未知错误'}`);
  }
  return true;
}

export default {
  commands,
  showAccounts,
  bindToken,
  unbindToken,
  deleteToken,
  switchAccount,
  refreshWechat,
  refreshQq,
};
