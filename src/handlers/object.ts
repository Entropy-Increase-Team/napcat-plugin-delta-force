/**
 * 物品查询处理器
 * 物品搜索
 */

import type { OB11Message } from 'napcat-types';
import { createApi } from '../core/api';
import { reply } from '../utils/message';
import { handleApiError as _handleApiError } from '../utils/error-handler';
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
  { keywords: ['物品搜索', '搜索物品'], handler: 'searchObject', name: '物品搜索', hasArgs: true },
];

/** 格式化价格 */
function formatPrice (price: number | undefined): string {
  if (!price && price !== 0) return '未知';
  if (price >= 1000000) return `${(price / 1000000).toFixed(1)}M`;
  if (price >= 1000) return `${(price / 1000).toFixed(0)}K`;
  return price.toString();
}

/** 物品搜索 */
export async function searchObject (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const argList = args.trim().split(/\s+/).filter(Boolean);

  if (argList.length === 0) {
    await reply(msg, '请输入要搜索的物品名称或ID\n例如：物品搜索 医疗包');
    return true;
  }

  // 分离名称和ID
  let name = '';
  const ids: string[] = [];

  argList.forEach(arg => {
    if (/^\d{5,}$/.test(arg)) {
      ids.push(arg);
    } else {
      name += (name ? ' ' : '') + arg;
    }
  });

  const searchType = ids.length > 0 ? `ID: ${ids.join(', ')}` : `名称: ${name}`;
  await reply(msg, `正在搜索物品 (${searchType})...`);

  const res = await api.searchObject(ids.length > 0 ? '' : name, ids.join(','));
  if (await checkApiError(res, msg)) return true;

  const items = (res as any)?.data?.keywords;
  if (!Array.isArray(items)) {
    await reply(msg, '搜索失败: 数据格式异常');
    return true;
  }

  if (items.length === 0) {
    await reply(msg, '未搜索到相关物品');
    return true;
  }

  let text = `【物品搜索结果】共 ${items.length} 条\n\n`;

  // 最多显示10条
  const displayItems = items.slice(0, 10);

  displayItems.forEach((item: any) => {
    text += `【${item.objectName}】\n`;
    text += `ID: ${item.objectID} | 价格: ${formatPrice(item.avgPrice)}\n`;
    text += `分类: ${item.primaryClass}/${item.secondClassCN || item.secondClass}\n`;
    text += `重量: ${item.weight} | 稀有度: ${item.grade}\n`;
    if (item.desc) text += `描述: ${item.desc.substring(0, 50)}${item.desc.length > 50 ? '...' : ''}\n`;
    text += '\n';
  });

  if (items.length > 10) {
    text += `... 还有 ${items.length - 10} 条结果`;
  }

  await reply(msg, text.trim());
  return true;
}

export default {
  commands,
  searchObject,
};
