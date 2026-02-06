/**
 * 改枪方案处理器
 * 管理和分享改枪方案/改枪码
 */

import type { OB11Message } from 'napcat-types';
import { pluginState } from '../core/state';
import { createApi } from '../core/api';
import { reply, replyAt, getUserId, makeForwardMsg } from '../utils/message';
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
  { keywords: ['上传改枪方案', '上传改枪码'], handler: 'uploadSolution', name: '上传改枪方案', hasArgs: true },
  { keywords: ['改枪方案列表', '改枪码列表'], handler: 'getSolutionList', name: '改枪方案列表', hasArgs: true },
  { keywords: ['改枪方案详情', '改枪码详情'], handler: 'getSolutionDetail', name: '改枪方案详情', hasArgs: true },
  { keywords: ['改枪方案点赞', '改枪码点赞'], handler: 'voteSolutionLike', name: '改枪方案点赞', hasArgs: true },
  { keywords: ['改枪方案点踩', '改枪码点踩'], handler: 'voteSolutionDislike', name: '改枪方案点踩', hasArgs: true },
  { keywords: ['更新改枪方案', '更新改枪码'], handler: 'updateSolution', name: '更新改枪方案', hasArgs: true },
  { keywords: ['删除改枪方案', '删除改枪码'], handler: 'deleteSolution', name: '删除改枪方案', hasArgs: true },
  { keywords: ['收藏改枪方案', '收藏改枪码'], handler: 'collectSolution', name: '收藏改枪方案', hasArgs: true },
  { keywords: ['取消收藏改枪方案', '取消收藏改枪码'], handler: 'discollectSolution', name: '取消收藏改枪方案', hasArgs: true },
  { keywords: ['改枪方案收藏列表', '改枪码收藏列表'], handler: 'getCollectList', name: '改枪方案收藏列表' },
];

/** 解析模式关键词 */
function parseMode (keyword: string): string {
  if (['sol', '烽火', '烽火地带', '摸金'].includes(keyword)) return 'sol';
  if (['mp', '全面', '战场', '全面战场'].includes(keyword)) return 'mp';
  return '';
}

/** 上传改枪方案 */
export async function uploadSolution (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);
  const clientID = pluginState.getConfig().clientID;

  if (!token) {
    await replyAt(msg, '请先绑定账号');
    return true;
  }
  if (!clientID) {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  if (!args) {
    const helpMsg = [
      '上传改枪方案指令格式:',
      '三角洲上传改枪码 <改枪码> [描述] [模式] [是否公开]',
      '',
      '示例:',
      '三角洲上传改枪码 腾龙突击步枪-烽火地带-6GQIU4800CIEH22G8UEHS',
      '三角洲上传改枪码 腾龙突击步枪-烽火地带-xxx 56W满配腾龙 烽火 是',
      '',
      '模式: sol/烽火/烽火地带, mp/全面/战场',
      '公开: 是/否 (是否公开作者QQ)',
    ].join('\n');
    await reply(msg, helpMsg);
    return true;
  }

  // 解析参数
  const parts = args.split(/\s+/);
  const solutionCode = parts[0];
  let desc = '';
  let type = 'sol';
  let isPublic = false;

  const modeKeywords = ['sol', '烽火', '烽火地带', '摸金', 'mp', '全面', '战场', '全面战场'];
  const publicKeywords = ['是', '否', 'true', 'false'];

  let modeIndex = -1;
  let publicIndex = -1;

  for (let i = parts.length - 1; i >= 1; i--) {
    if (publicKeywords.includes(parts[i]) && publicIndex === -1) {
      publicIndex = i;
      isPublic = ['是', 'true'].includes(parts[i]);
    } else if (modeKeywords.includes(parts[i]) && modeIndex === -1) {
      modeIndex = i;
      type = parseMode(parts[i]) || 'sol';
    }
  }

  let descEndIndex = parts.length - 1;
  if (publicIndex !== -1) descEndIndex = publicIndex - 1;
  else if (modeIndex !== -1) descEndIndex = modeIndex - 1;

  if (descEndIndex >= 1) {
    desc = parts.slice(1, descEndIndex + 1).join(' ');
  }

  const res = await api.uploadSolution(token, clientID, userId, solutionCode, desc, isPublic, type);
  if (await checkApiError(res, msg)) return true;

  if (res && (res.code === 0 || res.success === true)) {
    const modeDisplay = type === 'sol' ? '烽火地带' : '全面战场';
    let text = '✅ 改枪码上传成功！\n';
    text += `方案ID: ${(res as any).data?.solutionId || '未知'}\n`;
    text += `模式: ${modeDisplay}\n`;
    text += `状态: ${isPublic ? '公开' : '私有'}\n`;
    text += '注意: 新上传的方案需要通过审核后才会在列表中显示';
    await reply(msg, text);
  } else {
    await reply(msg, `上传失败: ${(res as any)?.msg || (res as any)?.message || '未知错误'}`);
  }

  return true;
}

/** 获取改枪方案列表 */
export async function getSolutionList (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);
  const clientID = pluginState.getConfig().clientID;

  if (!token) {
    await replyAt(msg, '请先绑定账号');
    return true;
  }
  if (!clientID) {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  const parts = args.split(/\s+/).filter(Boolean);
  let weaponName = '';
  let priceRange = '';

  for (const arg of parts) {
    if (/^\d+,\d+$/.test(arg)) {
      priceRange = arg;
    } else if (!weaponName) {
      weaponName = arg;
    }
  }

  let filterDesc: string[] = [];
  if (weaponName) filterDesc.push(`武器:${weaponName}`);
  if (priceRange) filterDesc.push(`价格:${priceRange.replace(',', '-')}`);

  await reply(msg, `正在查询改枪方案列表... ${filterDesc.length > 0 ? `[${filterDesc.join(', ')}]` : ''}`);

  const res = await api.getSolutionList(token, clientID, userId, '', weaponName, priceRange);
  if (await checkApiError(res, msg)) return true;

  // 处理数据结构
  let solutions: any[] = [];
  const data = (res as any)?.data;
  if (data && Array.isArray(data)) {
    solutions = data;
  } else if (data?.list && Array.isArray(data.list)) {
    solutions = data.list;
  } else if (data?.keywords && Array.isArray(data.keywords)) {
    solutions = data.keywords;
  }

  if (solutions.length === 0) {
    await reply(msg, '未找到符合条件的改枪方案');
    return true;
  }

  // 构建转发消息
  const messages: string[] = [];
  const filterTitle = filterDesc.length > 0 ? ` - ${filterDesc.join(', ')}` : '';
  messages.push(`【改枪方案列表${filterTitle}】 (${solutions.length}个方案)`);

  solutions.forEach((solution, index) => {
    let text = `#${index + 1}: ${solution.solutionCode}\n`;
    text += `方案ID: ${solution.id || solution.solutionId}\n`;
    text += `武器: ${solution.weaponName || '未知'}\n`;
    text += `模式: ${solution.type === 'sol' ? '烽火地带' : '全面战场'}\n`;
    text += `价格: ${solution.totalPrice ? solution.totalPrice.toLocaleString() : '未知'}\n`;
    text += `作者: ${solution.authorNickname || solution.author || '匿名用户'}\n`;
    text += `浏览: ${solution.views || 0} | 👍 ${solution.likes || solution.likeCount || 0} 👎 ${solution.dislikes || solution.dislikeCount || 0}`;
    if (solution.description || solution.desc) {
      text += `\n描述: ${solution.description || solution.desc}`;
    }
    text += `\n使用 三角洲改枪方案详情 ${solution.id || solution.solutionId} 查看详情`;
    messages.push(text);
  });

  await makeForwardMsg(msg, messages);
  return true;
}

/** 获取改枪方案详情 */
export async function getSolutionDetail (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);
  const clientID = pluginState.getConfig().clientID;

  if (!token) {
    await replyAt(msg, '请先绑定账号');
    return true;
  }
  if (!clientID) {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  const solutionId = args.trim();
  if (!solutionId || !/^\d+$/.test(solutionId)) {
    await reply(msg, '请提供有效的方案ID\n格式: 三角洲改枪方案详情 <方案ID>');
    return true;
  }

  await reply(msg, `正在查询方案详情 (ID: ${solutionId})...`);

  const res = await api.getSolutionDetail(token, clientID, userId, solutionId);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data) {
    await reply(msg, '方案不存在或无权限查看');
    return true;
  }

  const solution = (res as any).data;
  let text = '=== 改枪方案详情 ===\n';
  text += `方案ID: ${solution.id || solution.solutionId}\n`;
  text += `改枪码: ${solution.solutionCode}\n`;
  text += `武器: ${solution.weapon?.objectName || '未知'}\n`;
  text += `模式: ${solution.metadata?.type === 'sol' ? '烽火地带' : '全面战场'}\n`;
  text += `总价格: ${solution.statistics?.totalPrice ? solution.statistics.totalPrice.toLocaleString() : '未知'}\n`;
  text += `作者: ${solution.author?.platformID || '匿名用户'}\n`;
  text += `创建时间: ${solution.metadata?.createdAt || '未知'}\n`;
  text += `浏览量: ${solution.statistics?.views || 0}\n`;
  text += `👍 ${solution.statistics?.likes || 0} 👎 ${solution.statistics?.dislikes || 0}\n`;

  if (solution.description) {
    text += `描述: ${solution.description}\n`;
  }

  if (solution.attachments?.length > 0) {
    text += '\n=== 配件列表 ===\n';
    solution.attachments.forEach((acc: any, index: number) => {
      text += `${index + 1}. ${acc.objectName || acc.objectID} - ${acc.price ? acc.price.toLocaleString() : '未知价格'}\n`;
    });
  }

  text += '\n使用指令:\n';
  text += `三角洲改枪方案点赞 ${solutionId} - 点赞\n`;
  text += `三角洲改枪方案点踩 ${solutionId} - 点踩\n`;
  text += `三角洲收藏改枪方案 ${solutionId} - 收藏`;

  await reply(msg, text.trim());
  return true;
}

/** 点赞改枪方案 */
export async function voteSolutionLike (msg: OB11Message, args: string): Promise<boolean> {
  return voteSolution(msg, args, 'like');
}

/** 点踩改枪方案 */
export async function voteSolutionDislike (msg: OB11Message, args: string): Promise<boolean> {
  return voteSolution(msg, args, 'dislike');
}

/** 投票改枪方案 */
async function voteSolution (msg: OB11Message, args: string, voteType: 'like' | 'dislike'): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);
  const clientID = pluginState.getConfig().clientID;

  if (!token) {
    await replyAt(msg, '请先绑定账号');
    return true;
  }
  if (!clientID) {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  const solutionId = args.trim();
  if (!solutionId || !/^\d+$/.test(solutionId)) {
    await reply(msg, '请提供有效的方案ID');
    return true;
  }

  const actionText = voteType === 'like' ? '点赞' : '点踩';
  const res = await api.voteSolution(token, clientID, userId, solutionId, voteType);
  if (await checkApiError(res, msg)) return true;

  if (res && (res.code === 0 || res.success === true)) {
    await reply(msg, (res as any).msg || `${actionText}成功！`);
  } else {
    await reply(msg, `操作失败: ${(res as any)?.msg || (res as any)?.message || '未知错误'}`);
  }

  return true;
}

/** 更新改枪方案 */
export async function updateSolution (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);
  const clientID = pluginState.getConfig().clientID;

  if (!token) {
    await replyAt(msg, '请先绑定账号');
    return true;
  }
  if (!clientID) {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  if (!args) {
    const helpMsg = [
      '更新改枪方案指令格式:',
      '三角洲更新改枪码 <方案ID> [新改枪码] [新描述] [模式] [是否公开]',
      '',
      '示例:',
      '三角洲更新改枪码 123 腾龙突击步枪-xxx 新的配置描述 全面 是',
      '',
      '注意: 只能更新自己的方案',
    ].join('\n');
    await reply(msg, helpMsg);
    return true;
  }

  const parts = args.split(/\s+/);
  const solutionId = parts[0];
  let solutionCode = parts.length > 1 ? parts[1] : '';
  let desc = '';
  let type = '';
  let isPublic: boolean | null = null;

  const modeKeywords = ['sol', '烽火', '烽火地带', '摸金', 'mp', '全面', '战场', '全面战场'];
  const publicKeywords = ['是', '否', 'true', 'false'];

  let modeIndex = -1;
  let publicIndex = -1;

  for (let i = parts.length - 1; i >= 2; i--) {
    if (publicKeywords.includes(parts[i]) && publicIndex === -1) {
      publicIndex = i;
      isPublic = ['是', 'true'].includes(parts[i]);
    } else if (modeKeywords.includes(parts[i]) && modeIndex === -1) {
      modeIndex = i;
      type = parseMode(parts[i]);
    }
  }

  let descEndIndex = parts.length - 1;
  if (publicIndex !== -1) descEndIndex = publicIndex - 1;
  else if (modeIndex !== -1) descEndIndex = modeIndex - 1;

  if (descEndIndex >= 2) {
    desc = parts.slice(2, descEndIndex + 1).join(' ');
  }

  await reply(msg, `正在更新方案 (ID: ${solutionId})...`);

  const res = await api.updateSolution(token, clientID, userId, solutionId, solutionCode, desc, isPublic, type);
  if (await checkApiError(res, msg)) return true;

  if (res && (res.code === 0 || res.success === true)) {
    let text = '✅ 方案更新成功！\n';
    if (desc) text += '注意: 更新描述后需要重新审核';
    await reply(msg, text);
  } else {
    await reply(msg, `更新失败: ${(res as any)?.msg || (res as any)?.message || '未知错误，可能您不是方案作者'}`);
  }

  return true;
}

/** 删除改枪方案 */
export async function deleteSolution (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);
  const clientID = pluginState.getConfig().clientID;

  if (!token) {
    await replyAt(msg, '请先绑定账号');
    return true;
  }
  if (!clientID) {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  const solutionId = args.trim();
  if (!solutionId || !/^\d+$/.test(solutionId)) {
    await reply(msg, '请提供有效的方案ID\n格式: 三角洲删除改枪方案 <方案ID>');
    return true;
  }

  await reply(msg, `正在删除方案 (ID: ${solutionId})...`);

  const res = await api.deleteSolution(token, clientID, userId, solutionId);
  if (await checkApiError(res, msg)) return true;

  if (res && (res.code === 0 || res.success === true)) {
    await reply(msg, '✅ 方案删除成功！注意: 删除后无法恢复');
  } else {
    await reply(msg, `删除失败: ${(res as any)?.msg || (res as any)?.message || '未知错误，可能您不是方案作者或方案不存在'}`);
  }

  return true;
}

/** 收藏改枪方案 */
export async function collectSolution (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);
  const clientID = pluginState.getConfig().clientID;

  if (!token) {
    await replyAt(msg, '请先绑定账号');
    return true;
  }
  if (!clientID) {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  const solutionId = args.trim();
  if (!solutionId || !/^\d+$/.test(solutionId)) {
    await reply(msg, '请提供有效的方案ID\n格式: 三角洲收藏改枪方案 <方案ID>');
    return true;
  }

  const res = await api.collectSolution(token, clientID, userId, solutionId);
  if (await checkApiError(res, msg)) return true;

  if (res && (res.code === 0 || res.success === true)) {
    await reply(msg, (res as any).msg || '✅ 收藏成功！');
  } else {
    await reply(msg, `操作失败: ${(res as any)?.msg || (res as any)?.message || '未知错误'}`);
  }

  return true;
}

/** 取消收藏改枪方案 */
export async function discollectSolution (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);
  const clientID = pluginState.getConfig().clientID;

  if (!token) {
    await replyAt(msg, '请先绑定账号');
    return true;
  }
  if (!clientID) {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  const solutionId = args.trim();
  if (!solutionId || !/^\d+$/.test(solutionId)) {
    await reply(msg, '请提供有效的方案ID\n格式: 三角洲取消收藏改枪方案 <方案ID>');
    return true;
  }

  const res = await api.discollectSolution(token, clientID, userId, solutionId);
  if (await checkApiError(res, msg)) return true;

  if (res && (res.code === 0 || res.success === true)) {
    await reply(msg, (res as any).msg || '✅ 取消收藏成功！');
  } else {
    await reply(msg, `操作失败: ${(res as any)?.msg || (res as any)?.message || '未知错误'}`);
  }

  return true;
}

/** 获取收藏列表 */
export async function getCollectList (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);
  const clientID = pluginState.getConfig().clientID;

  if (!token) {
    await replyAt(msg, '请先绑定账号');
    return true;
  }
  if (!clientID) {
    await reply(msg, 'clientID 未配置');
    return true;
  }

  await reply(msg, '正在查询您的收藏列表...');

  const res = await api.getCollectList(token, clientID, userId);
  if (await checkApiError(res, msg)) return true;

  // 处理数据结构
  let collections: any[] = [];
  const data = (res as any)?.data;
  if (data && Array.isArray(data)) {
    collections = data;
  } else if (data?.list && Array.isArray(data.list)) {
    collections = data.list;
  }

  if (collections.length === 0) {
    await reply(msg, '您还没有收藏任何改枪方案');
    return true;
  }

  // 构建转发消息
  const messages: string[] = [];
  messages.push(`【我的收藏列表】 (${collections.length}个方案)`);

  collections.forEach((solution, index) => {
    let text = `#${index + 1}: ${solution.solutionCode}\n`;
    text += `方案ID: ${solution.id || solution.solutionId}\n`;
    text += `武器: ${solution.weaponName || '未知'}\n`;
    text += `模式: ${solution.type === 'sol' ? '烽火地带' : '全面战场'}\n`;
    text += `价格: ${solution.totalPrice ? solution.totalPrice.toLocaleString() : '未知'}\n`;
    text += `作者: ${solution.authorNickname || solution.author || '匿名用户'}\n`;
    text += `👍 ${solution.likes || 0} 👎 ${solution.dislikes || 0}`;
    if (solution.description || solution.desc) {
      text += `\n描述: ${solution.description || solution.desc}`;
    }
    messages.push(text);
  });

  await makeForwardMsg(msg, messages);
  return true;
}

export default {
  commands,
  uploadSolution,
  getSolutionList,
  getSolutionDetail,
  voteSolutionLike,
  voteSolutionDislike,
  updateSolution,
  deleteSolution,
  collectSolution,
  discollectSolution,
  getCollectList,
};
