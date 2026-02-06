/**
 * 价格查询处理器
 * 物品价格、利润排行等
 */

import type { OB11Message } from '../types/index';
import type { CommandDef } from '../utils/command';
import { createApi } from '../core/api';
import { pluginState } from '../core/state';
import { reply, getUserId, formatNumber, makeForwardMsg } from '../utils/message';
import { handleApiError as _handleApiError } from '../utils/error-handler';
import { logger } from '../utils/logger';

/** 命令定义 */
export const commands: CommandDef[] = [
  { keywords: ['当前价格', '最新价格', '价格'], handler: 'getCurrentPrice', name: '当前价格', hasArgs: true },
  { keywords: ['价格历史', '历史价格'], handler: 'getPriceHistory', name: '历史价格', hasArgs: true },
  { keywords: ['材料价格', '制造材料'], handler: 'getMaterialPrice', name: '材料价格', hasArgs: true },
  { keywords: ['利润排行', '利润榜'], handler: 'getProfitRank', name: '利润排行', hasArgs: true },
  { keywords: ['最高利润', '利润排行v2', '利润榜v2'], handler: 'getProfitRankV2', name: '最高利润', hasArgs: true },
  { keywords: ['特勤处利润', '特勤利润'], handler: 'getSpecialOpsProfit', name: '特勤处利润', hasArgs: true },
  { keywords: ['利润历史'], handler: 'getProfitHistory', name: '利润历史', hasArgs: true },
];

/** 错误检查包装 */
async function checkApiError (res: any, msg: OB11Message): Promise<boolean> {
  const result = _handleApiError(res);
  if (result.handled && result.message) {
    await reply(msg, result.message);
    return true;
  }
  return result.handled;
}

/** 解析物品查询参数 */
async function parseItemQuery (api: any, query: string, maxResults = 5): Promise<{ objectIds: string[]; idToNameMap: Map<string, string>; }> {
  const objectIds: string[] = [];
  const items: any[] = [];
  const queries = query.split(/[,，]/).map(q => q.trim()).filter(Boolean);

  if (queries.length > 1) {
    for (const singleQuery of queries) {
      if (/^\d+$/.test(singleQuery)) {
        objectIds.push(singleQuery);
        const searchRes = await api.searchObject('', singleQuery);
        if (searchRes?.data?.keywords?.length > 0) {
          items.push(...searchRes.data.keywords);
        } else {
          items.push({ objectID: singleQuery, objectName: `物品ID: ${singleQuery}` });
        }
      } else {
        const searchRes = await api.searchObject(singleQuery, '');
        if (searchRes?.data?.keywords?.length > 0) {
          const firstMatch = searchRes.data.keywords[0];
          objectIds.push(String(firstMatch.objectID));
          items.push(firstMatch);
        }
      }
    }
  } else {
    const singleQuery = queries[0];
    if (/^\d+$/.test(singleQuery)) {
      objectIds.push(singleQuery);
      const searchRes = await api.searchObject('', singleQuery);
      if (searchRes?.data?.keywords?.length > 0) {
        items.push(...searchRes.data.keywords);
      } else {
        items.push({ objectID: singleQuery, objectName: `物品ID: ${singleQuery}` });
      }
    } else {
      const searchRes = await api.searchObject(singleQuery, '');
      if (searchRes?.data?.keywords?.length > 0) {
        const selectedItems = searchRes.data.keywords.slice(0, maxResults);
        objectIds.push(...selectedItems.map((item: any) => String(item.objectID)));
        items.push(...selectedItems);
      }
    }
  }

  const idToNameMap = new Map<string, string>();
  items.forEach(item => {
    if (item.objectID && item.objectName) {
      idToNameMap.set(String(item.objectID), item.objectName);
    }
  });

  return { objectIds, idToNameMap };
}

/** 获取物品当前价格 */
export async function getCurrentPrice (msg: OB11Message, args: string): Promise<boolean> {
  const query = args.trim();
  if (!query) {
    await reply(msg, '请输入要查询的物品名称或ID\n示例: 当前价格 M4A1\n支持多物品: 当前价格 低级燃料,燃料电池');
    return true;
  }

  await reply(msg, '正在查询物品当前价格...');
  const api = createApi();

  try {
    const { objectIds, idToNameMap } = await parseItemQuery(api, query, 5);
    if (objectIds.length === 0) {
      await reply(msg, '未找到相关物品，请检查物品名称');
      return true;
    }

    const res = await api.getCurrentPrice(objectIds);
    if (await checkApiError(res, msg)) return true;

    if (!res.data || (Array.isArray(res.data) && res.data.length === 0)) {
      await reply(msg, '未获取到价格数据');
      return true;
    }

    const prices = res.data.prices || res.data;
    if (prices.length === 1) {
      const item = prices[0];
      const price = parseFloat(item.avgPrice).toLocaleString();
      const itemName = idToNameMap.get(String(item.objectID)) || `物品ID: ${item.objectID}`;
      await reply(msg, `【${itemName}】\n当前均价: ${price}`);
    } else {
      let text = '【物品当前价格】\n';
      prices.forEach((item: any) => {
        const price = parseFloat(item.avgPrice).toLocaleString();
        const itemName = idToNameMap.get(String(item.objectID)) || `物品ID: ${item.objectID}`;
        text += `\n${itemName}: ${price}`;
      });
      await reply(msg, text);
    }
  } catch (error: any) {
    logger.error('查询当前价格失败:', error);
    await reply(msg, '查询当前价格时发生错误，请稍后重试');
  }

  return true;
}

/** 获取物品历史价格 */
export async function getPriceHistory (msg: OB11Message, args: string): Promise<boolean> {
  const query = args.trim();
  if (!query) {
    await reply(msg, '请输入要查询的物品名称或ID\n示例: 价格历史 M4A1');
    return true;
  }

  await reply(msg, '正在查询物品历史价格...');
  const api = createApi();

  try {
    const { objectIds, idToNameMap } = await parseItemQuery(api, query, 3);
    if (objectIds.length === 0) {
      await reply(msg, '未找到相关物品，请检查物品名称');
      return true;
    }

    let resultText = `【物品历史价格】\n`;

    for (const objectId of objectIds) {
      const objectName = idToNameMap.get(objectId) || `物品ID: ${objectId}`;

      try {
        const res = await api.getPriceHistoryV2(objectId);
        if (await checkApiError(res, msg)) continue;

        if (!res.data || !res.data.history) {
          resultText += `\n${objectName}: 暂无历史数据`;
          continue;
        }

        const { history, stats } = res.data;
        resultText += `\n--- ${objectName} ---\n`;
        resultText += `数据期间: 7天\n`;
        resultText += `当前价格: ${stats.latestPrice?.toLocaleString()}\n`;
        resultText += `平均价格: ${stats.avgPrice?.toLocaleString()}\n`;
        resultText += `最高价格: ${stats.maxPrice?.toLocaleString()}\n`;
        resultText += `最低价格: ${stats.minPrice?.toLocaleString()}\n`;
        resultText += `价格波动: ${stats.priceRange?.toLocaleString()}`;
      } catch (error) {
        resultText += `\n${objectName}: 查询失败`;
      }
    }

    await reply(msg, resultText.trim());
  } catch (error: any) {
    logger.error('查询历史价格失败:', error);
    await reply(msg, '查询历史价格时发生错误，请稍后重试');
  }

  return true;
}

/** 获取制造材料价格 */
export async function getMaterialPrice (msg: OB11Message, args: string): Promise<boolean> {
  const query = args.trim();
  await reply(msg, '正在查询制造材料价格...');

  const api = createApi();

  try {
    let objectIds: string[] = [];
    let idToNameMap = new Map<string, string>();

    if (query) {
      const result = await parseItemQuery(api, query, 5);
      objectIds = result.objectIds;
      idToNameMap = result.idToNameMap;

      if (objectIds.length === 0) {
        await reply(msg, '未找到相关物品，请检查物品名称');
        return true;
      }
    }

    let resultText = '【制造材料价格】\n';

    if (objectIds.length > 0) {
      for (const objectId of objectIds) {
        const objectName = idToNameMap.get(objectId) || `物品ID: ${objectId}`;
        const res = await api.getMaterialPrice(objectId);
        if (await checkApiError(res, msg)) continue;

        if (!res.data || !res.data.materials || res.data.materials.length === 0) {
          resultText += `\n${objectName}: 暂无材料数据`;
          continue;
        }

        resultText += `\n--- ${objectName} ---`;
        res.data.materials.slice(0, 8).forEach((material: any) => {
          const price = parseFloat(material.minPrice).toLocaleString();
          resultText += `\n${material.objectName}: ${price}`;
        });
      }
    } else {
      const res = await api.getMaterialPrice();
      if (await checkApiError(res, msg)) return true;

      if (!res.data || !res.data.materials || res.data.materials.length === 0) {
        await reply(msg, '未获取到制造材料价格数据');
        return true;
      }

      res.data.materials.slice(0, 20).forEach((material: any) => {
        const price = parseFloat(material.minPrice).toLocaleString();
        resultText += `\n${material.objectName}: ${price}`;
      });
    }

    await reply(msg, resultText.trim());
  } catch (error: any) {
    logger.error('查询材料价格失败:', error);
    await reply(msg, '查询材料价格时发生错误，请稍后重试');
  }

  return true;
}

/** 获取利润排行 */
export async function getProfitRank (msg: OB11Message, args: string): Promise<boolean> {
  const argArray = args.split(/\s+/).filter(Boolean);

  let type = 'hour';
  let place = '';
  let limit = 10;

  for (const arg of argArray) {
    if (['hour', 'total', 'hourprofit', 'totalprofit'].includes(arg.toLowerCase())) {
      type = arg.toLowerCase();
    } else if (['tech', 'workbench', 'pharmacy', 'armory', 'storage', 'control', 'shoot', 'training'].includes(arg.toLowerCase())) {
      place = arg.toLowerCase();
    } else if (!isNaN(parseInt(arg))) {
      const num = parseInt(arg);
      if (num > 0 && num <= 50) limit = num;
    }
  }

  const typeText: Record<string, string> = { hour: '小时利润', total: '总利润', hourprofit: '小时利润', totalprofit: '总利润' };
  await reply(msg, `正在查询利润排行榜 (${typeText[type]}${place ? `, 场所: ${place}` : ''}, 显示前${limit}名)...`);

  const api = createApi();

  try {
    const params: Record<string, any> = { type, limit };
    if (place) params.place = place;

    const res = await api.getProfitRankV1(params);
    if (await checkApiError(res, msg)) return true;

    if (!res.data) {
      await reply(msg, 'API返回数据为空');
      return true;
    }

    let allItems: any[] = [];
    if (res.data.groups) {
      for (const [groupName, items] of Object.entries(res.data.groups)) {
        if (!place || groupName === place) {
          allItems = allItems.concat(items as any[]);
        }
      }
    } else if (res.data.items) {
      allItems = res.data.items;
    }

    if (allItems.length === 0) {
      await reply(msg, `当前查询条件下没有利润排行数据`);
      return true;
    }

    if (type === 'hour' || type === 'hourprofit') {
      allItems.sort((a, b) => (b.hourProfit || 0) - (a.hourProfit || 0));
    } else {
      allItems.sort((a, b) => (b.profit || b.totalProfit || 0) - (a.profit || a.totalProfit || 0));
    }

    // 构建合并转发消息
    const messages: string[] = [];

    // 标题消息
    messages.push(`【${typeText[type]}排行榜${place ? ` - ${place}` : ''}】\n共 ${allItems.length} 个物品`);

    // 每5个物品一条消息
    const itemsPerMsg = 5;
    const items = allItems.slice(0, limit);

    for (let i = 0; i < items.length; i += itemsPerMsg) {
      const group = items.slice(i, i + itemsPerMsg);
      let text = '';

      group.forEach((item, idx) => {
        const rank = i + idx + 1;
        const hourProfit = parseFloat(item.hourProfit || 0).toLocaleString();
        const totalProfit = parseFloat(item.profit || item.totalProfit || 0).toLocaleString();

        if (text) text += '\n';
        text += `${rank}. ${item.objectName}`;
        text += `\n   场所: ${item.placeName || item.placeType} Lv.${item.level}`;
        text += `\n   时利润: ${hourProfit} | 总利润: ${totalProfit}`;
      });

      messages.push(text.trim());
    }

    // 使用说明
    messages.push(`【使用说明】\n参数: [类型] [场所] [数量]\n类型: hour/total\n场所: tech/workbench/pharmacy/armory`);

    await makeForwardMsg(msg, messages, { nickname: '利润排行', userId: 66600000 });
  } catch (error: any) {
    logger.error('查询利润排行失败:', error);
    await reply(msg, '查询利润排行时发生错误，请稍后重试');
  }

  return true;
}

/** 获取利润排行 V2 (最高利润) */
export async function getProfitRankV2 (msg: OB11Message, args: string): Promise<boolean> {
  const argArray = args.split(/\s+/).filter(Boolean);

  let type = 'hour';
  let place = '';
  let id = '';

  for (const arg of argArray) {
    if (['hour', 'total', 'hourprofit', 'totalprofit', 'profit'].includes(arg.toLowerCase())) {
      type = arg.toLowerCase();
    } else if (['tech', 'workbench', 'pharmacy', 'armory', 'storage', 'control', 'shoot', 'training'].includes(arg.toLowerCase())) {
      place = arg.toLowerCase();
    } else if (/^\d+$/.test(arg)) {
      id = arg;
    }
  }

  const typeText: Record<string, string> = { hour: '小时利润', total: '总利润', hourprofit: '小时利润', totalprofit: '总利润', profit: '总利润' };
  await reply(msg, `正在查询最高利润排行榜...`);

  const api = createApi();

  try {
    const params: Record<string, any> = { type };
    if (place) params.place = place;
    if (id) params.id = id;

    const res = await api.getProfitRankV2(params);
    if (await checkApiError(res, msg)) return true;

    if (!res.data || !res.data.groups) {
      await reply(msg, 'API返回数据为空');
      return true;
    }

    let allItems: any[] = [];
    for (const [groupName, items] of Object.entries(res.data.groups)) {
      if (!place || groupName === place) {
        allItems = allItems.concat(items as any[]);
      }
    }

    if (allItems.length === 0) {
      await reply(msg, '该场所暂无利润数据');
      return true;
    }

    if (type === 'hour' || type === 'hourprofit') {
      allItems.sort((a, b) => (b.today?.hourProfit || 0) - (a.today?.hourProfit || 0));
    } else {
      allItems.sort((a, b) => (b.today?.profit || 0) - (a.today?.profit || 0));
    }

    // 构建合并转发消息
    const messages: string[] = [];

    // 标题消息
    messages.push(`【最高${typeText[type]}排行榜】\n今日vs昨日对比`);

    // 每5个物品一条消息
    const itemsPerMsg = 5;
    const items = allItems.slice(0, 10);

    for (let i = 0; i < items.length; i += itemsPerMsg) {
      const group = items.slice(i, i + itemsPerMsg);
      let text = '';

      group.forEach((item, idx) => {
        const rank = i + idx + 1;
        const today = item.today || {};
        const yesterday = item.yesterday || {};
        const profitChange = (today.profit || 0) - (yesterday.profit || 0);

        if (text) text += '\n';
        text += `${rank}. ${item.objectName}`;
        text += `\n   场所: ${item.placeName} Lv.${item.level}`;
        text += `\n   今日利润: ${today.profit?.toLocaleString()} (时: ${today.hourProfit?.toLocaleString()})`;
        text += `\n   变化: ${profitChange >= 0 ? '+' : ''}${profitChange.toLocaleString()}`;
      });

      messages.push(text.trim());
    }

    await makeForwardMsg(msg, messages, { nickname: '最高利润排行', userId: 66600000 });
  } catch (error: any) {
    logger.error('查询最高利润排行失败:', error);
    await reply(msg, '查询最高利润排行时发生错误，请稍后重试');
  }

  return true;
}

/** 获取特勤处利润 */
export async function getSpecialOpsProfit (msg: OB11Message, args: string): Promise<boolean> {
  let type = 'hour';
  if (args && ['hour', 'total', 'hourprofit', 'totalprofit', 'profit'].includes(args.toLowerCase())) {
    type = args.toLowerCase();
  }

  const typeText: Record<string, string> = { hour: '小时利润', total: '总利润', hourprofit: '小时利润', totalprofit: '总利润', profit: '总利润' };
  await reply(msg, `正在查询特勤处四个场所的${typeText[type]}排行...`);

  const places = [
    { key: 'tech', name: '技术中心' },
    { key: 'workbench', name: '工作台' },
    { key: 'pharmacy', name: '制药台' },
    { key: 'armory', name: '防具台' },
  ];

  const api = createApi();

  try {
    // 构建合并转发消息
    const messages: string[] = [];

    // 标题消息
    messages.push(`【特勤处${typeText[type]}总览】\n各场所TOP3排行`);

    for (const place of places) {
      try {
        const res = await api.getProfitRankV2({ type, place: place.key });

        if (res && res.data && res.data.groups && res.data.groups[place.key]) {
          let items = res.data.groups[place.key] as any[];

          if (type === 'hour' || type === 'hourprofit') {
            items.sort((a: any, b: any) => (b.today?.hourProfit || 0) - (a.today?.hourProfit || 0));
          } else {
            items.sort((a: any, b: any) => (b.today?.profit || 0) - (a.today?.profit || 0));
          }

          let text = `【${place.name}】`;
          items.slice(0, 3).forEach((item: any, index: number) => {
            const rank = ['🥇', '🥈', '🥉'][index];
            const today = item.today || {};
            const profit = type === 'hour' || type === 'hourprofit' ? today.hourProfit : today.profit;
            text += `\n${rank} ${item.objectName}: ${profit?.toLocaleString()}`;
          });
          messages.push(text);
        } else {
          messages.push(`【${place.name}】\n暂无数据`);
        }
      } catch (error) {
        messages.push(`【${place.name}】\n查询失败`);
      }
    }

    // 使用说明
    messages.push(`【使用说明】\n特勤处利润 [hour/total]`);

    await makeForwardMsg(msg, messages, { nickname: '特勤处利润', userId: 66600000 });
  } catch (error: any) {
    logger.error('查询特勤处利润失败:', error);
    await reply(msg, '查询特勤处利润时发生错误，请稍后重试');
  }

  return true;
}

/** 获取利润历史 */
export async function getProfitHistory (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();

  if (!args || !args.trim()) {
    await reply(msg, '请提供查询参数\n格式：三角洲利润历史 <物品名称/ID/场所>\n示例：三角洲利润历史 轻型护甲\n场所可选：tech/workbench/pharmacy/armory');
    return true;
  }

  const query = args.trim();
  await reply(msg, `正在查询 "${query}" 的利润历史...`);

  // 判断是场所名还是物品名/ID
  const placeMap: Record<string, string> = {
    tech: '技术中心', 技术中心: 'tech',
    workbench: '工作台', 工作台: 'workbench',
    pharmacy: '制药台', 制药台: 'pharmacy',
    armory: '防具台', 防具台: 'armory',
  };

  const params: { objectId?: string; objectName?: string; place?: string; } = {};

  // 检查是否是场所名
  const lowerQuery = query.toLowerCase();
  if (placeMap[lowerQuery] || placeMap[query]) {
    params.place = placeMap[lowerQuery] || placeMap[query];
    if (params.place.length > 10) params.place = lowerQuery; // 如果是中文名转换为英文key
  } else if (/^\d+$/.test(query)) {
    params.objectId = query;
  } else {
    params.objectName = query;
  }

  try {
    const res = await api.getProfitHistory(params);
    if (await checkApiError(res, msg)) return true;

    if (!res || !(res as any).data) {
      await reply(msg, '未找到相关利润历史数据');
      return true;
    }

    const data = (res as any).data;

    // 如果是场所查询，返回该场所所有物品的利润历史
    if (params.place && Array.isArray(data)) {
      let text = `【${placeMap[params.place] || params.place} 利润历史】\n`;

      if (data.length === 0) {
        text += '暂无数据';
      } else {
        data.slice(0, 10).forEach((item: any, index: number) => {
          text += `\n${index + 1}. ${item.objectName || '未知'}`;
          if (item.profit) text += ` - 利润: ${item.profit.toLocaleString()}`;
          if (item.hourProfit) text += ` (时: ${item.hourProfit.toLocaleString()})`;
        });
      }

      await reply(msg, text);
      return true;
    }

    // 单个物品的利润历史
    if (data.history && Array.isArray(data.history)) {
      let text = `【${data.objectName || query} 利润历史】\n`;
      text += `场所: ${data.placeName || '未知'} Lv.${data.level || '?'}\n`;

      if (data.history.length === 0) {
        text += '暂无历史数据';
      } else {
        data.history.slice(0, 7).forEach((h: any) => {
          text += `${h.date || '未知日期'}: ${h.profit?.toLocaleString() || '-'}`;
          if (h.hourProfit) text += ` (时: ${h.hourProfit.toLocaleString()})`;
          text += '\n';
        });
      }

      await reply(msg, text.trim());
    } else {
      // 简单数据格式
      let text = `【${query} 利润历史】\n`;
      text += JSON.stringify(data, null, 2).substring(0, 500);
      await reply(msg, text);
    }
  } catch (error: any) {
    logger.error('查询利润历史失败:', error);
    await reply(msg, '查询利润历史时发生错误，请稍后重试');
  }

  return true;
}
