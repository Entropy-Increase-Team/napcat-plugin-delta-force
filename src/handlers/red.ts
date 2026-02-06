/**
 * 红色藏品处理器
 * 查询藏品解锁记录
 */

import type { OB11Message } from '../types/index';
import type { CommandDef } from '../utils/command';
import { createApi } from '../core/api';
import { pluginState } from '../core/state';
import { reply, replyImage, getUserId, makeForwardMsg } from '../utils/message';
import { formatNumber } from '../utils/format';
import { handleApiError as _handleApiError } from '../utils/error-handler';
import { getAccount } from '../utils/account';
import { render, generateRedRecordHtml } from '../services/render';
import { dataManager } from '../services/data-manager';
import { logger } from '../utils/logger';

/** 命令定义 */
export const commands: CommandDef[] = [
  { keywords: ['大红收藏', '大红藏品', '大红海报', '藏品海报'], handler: 'getRedCollection', name: '大红收藏', hasArgs: true },
  { keywords: ['出红记录', '大红记录', '藏品记录'], handler: 'getRedRecord', name: '藏品记录', hasArgs: true },
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

/** URL解码 */
function decode (str: string): string {
  try {
    return decodeURIComponent(str || '');
  } catch (e) {
    return str || '';
  }
}

/** 获取物品名称映射 */
async function getItemNameMap (api: any, itemIds: any[]): Promise<Map<string, string>> {
  const itemMap = new Map<string, string>();
  const uniqueIds = [...new Set(itemIds)].map(id => String(id));

  try {
    const batchRes = await api.searchObject('', uniqueIds.join(',')) as any;
    const isSuccess = batchRes?.success || batchRes?.code === 0 || batchRes?.code === '0';
    if (isSuccess && batchRes?.data?.keywords) {
      batchRes.data.keywords.forEach((item: any) => {
        itemMap.set(String(item.objectID), item.objectName);
      });
    }
  } catch (error) {
    logger.error('批量查询物品名称失败:', error);
  }

  return itemMap;
}

/** 获取物品价格映射 */
async function getItemPriceMap (api: any, itemIds: any[]): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  const uniqueIds = [...new Set(itemIds)].map(id => String(id));

  try {
    const batchRes = await api.searchObject('', uniqueIds.join(',')) as any;
    const isSuccess = batchRes?.success || batchRes?.code === 0 || batchRes?.code === '0';
    if (isSuccess && batchRes?.data?.keywords) {
      batchRes.data.keywords.forEach((item: any) => {
        priceMap.set(String(item.objectID), item.avgPrice || 0);
      });
    }
  } catch (error) {
    // 静默处理
  }

  return priceMap;
}

/** 获取大红收藏/出红记录 */
export async function getRedCollection (msg: OB11Message, args: string): Promise<boolean> {
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await reply(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  // 判断数据源类型
  const isRecordSource = args.match(/^(出红记录|大红记录|藏品记录)/);

  if (isRecordSource) {
    await reply(msg, '正在获取您的藏品解锁记录，请稍候...');
  } else {
    await reply(msg, '正在获取大红收藏数据，请稍候...');
  }

  const api = createApi();

  try {
    // 获取个人信息
    const personalInfoRes = await api.getPersonalInfo(token);
    if (await checkApiError(personalInfoRes, msg)) return true;

    if (!personalInfoRes || !personalInfoRes.data || !personalInfoRes.roleInfo) {
      await reply(msg, '获取个人信息失败：API返回数据格式异常');
      return true;
    }

    const { userData, careerData } = personalInfoRes.data;
    const { roleInfo } = personalInfoRes;
    const userName = decode(userData?.charac_name || roleInfo?.charac_name) || '未知';

    if (isRecordSource) {
      // 使用出红记录数据源
      const res = await api.getRedList(token) as any;
      if (await checkApiError(res, msg)) return true;

      // 检查 API 返回 (兼容 success 和 code)
      const isSuccess = res?.success || res?.code === 0 || res?.code === '0';
      if (!res || !isSuccess || !res.data?.records) {
        await reply(msg, '获取藏品记录失败：数据格式错误');
        return true;
      }

      const records = res.data.records;
      if (!records.list || records.list.length === 0) {
        await reply(msg, '您还没有任何藏品解锁记录');
        return true;
      }

      const itemIds = records.list.map((item: any) => item.itemId);
      const itemMap = await getItemNameMap(api, itemIds);
      const priceMap = await getItemPriceMap(api, itemIds);

      // 统计数据
      const itemStats = new Map<string, { name: string; count: number; totalValue: number; }>();

      records.list.forEach((record: any) => {
        const itemId = String(record.itemId);
        const itemName = itemMap.get(itemId) || `未知物品(${itemId})`;
        const itemPrice = priceMap.get(itemId) || 0;
        const num = record.num || 1;

        if (itemStats.has(itemId)) {
          const stat = itemStats.get(itemId)!;
          stat.count += num;
          stat.totalValue += itemPrice * num;
        } else {
          itemStats.set(itemId, { name: itemName, count: num, totalValue: itemPrice * num });
        }
      });

      const redGodCount = itemStats.size;
      let redTotalCount = 0;
      let redTotalValue = 0;

      itemStats.forEach(stat => {
        redTotalCount += stat.count;
        redTotalValue += stat.totalValue;
      });

      // 按价值排序
      const sortedRecords = Array.from(itemStats.values()).sort((a, b) => b.totalValue - a.totalValue);

      // 构建合并转发消息
      const forwardMessages: string[] = [];

      // 第一条：汇总信息
      let summaryText = `【${userName} 的藏品记录】\n\n`;
      summaryText += `收藏种类: ${redGodCount} 种\n`;
      summaryText += `收藏总数: ${redTotalCount} 件\n`;
      summaryText += `总估值: ${formatNumber(redTotalValue)}`;
      forwardMessages.push(summaryText);

      // 每10个物品一条消息
      const chunkSize = 10;
      for (let i = 0; i < sortedRecords.length; i += chunkSize) {
        const chunk = sortedRecords.slice(i, i + chunkSize);
        let chunkText = `--- 藏品明细 (${i + 1}-${Math.min(i + chunkSize, sortedRecords.length)}/${sortedRecords.length}) ---`;

        chunk.forEach((item, index) => {
          const globalIndex = i + index + 1;
          chunkText += `\n\n${globalIndex}. ${item.name} x${item.count}`;
          chunkText += `\n   估值: ${formatNumber(item.totalValue)}`;
        });

        forwardMessages.push(chunkText);
      }

      // 发送合并转发消息
      await makeForwardMsg(msg, forwardMessages, { userId: 66600000, nickname: '三角洲助手' });
    } else {
      // 使用收藏品详情数据源
      const seasonMatch = args.match(/(\d+)$/);
      const seasonId = seasonMatch ? seasonMatch[1] : 'all';

      const [personalDataRes, titleRes] = await Promise.all([
        api.getPersonalData(token, '', seasonId),
        api.getTitle(token),
      ]);

      if (await checkApiError(personalDataRes, msg)) return true;
      if (await checkApiError(titleRes, msg)) return true;

      if (!personalDataRes.success || !personalDataRes.data) {
        await reply(msg, '获取个人数据失败：API返回数据格式异常');
        return true;
      }

      // 解析个人数据结构
      let solDetail = null;
      const allModesData = personalDataRes.data;
      if (allModesData?.sol?.data?.data?.solDetail) {
        solDetail = allModesData.sol.data.data.solDetail;
      }

      if (!solDetail) {
        await reply(msg, '没有找到烽火地带游戏数据，请确保您已经进行过烽火地带模式的对局');
        return true;
      }

      const title = titleRes.data?.title || '血色会计';
      const subtitle = titleRes.data?.subtitle || '"能把肾上腺素换算成子弹汇率的鬼才"';
      const redTotalMoney = solDetail.redTotalMoney || 0;
      const redTotalCount = solDetail.redTotalCount || 0;
      const redCollectionDetail = solDetail.redCollectionDetail || [];

      if (redCollectionDetail.length === 0) {
        await reply(msg, '您还没有任何大红收藏品，快去游戏中获取一些稀有收藏品吧！');
        return true;
      }

      const uniqueObjectIds = new Set(redCollectionDetail.map((item: any) => item.objectID));
      const redGodCount = uniqueObjectIds.size;

      // 按价格排序
      const sortedCollections = redCollectionDetail.sort((a: any, b: any) => (b.price || 0) - (a.price || 0));

      // 获取物品名称
      const objectIds = sortedCollections.slice(0, 10).map((item: any) => item.objectID);
      const objectNames: Record<string, string> = {};

      try {
        const searchRes = await api.searchObject('', objectIds.join(','));
        if (searchRes && searchRes.data && searchRes.data.keywords) {
          searchRes.data.keywords.forEach((obj: any) => {
            objectNames[obj.objectID] = obj.objectName;
          });
        }
      } catch (error) {
        // 静默处理
      }

      // 构建合并转发消息
      const forwardMessages: string[] = [];

      // 第一条：汇总信息
      let summaryText = `【${userName} 的大红收藏馆】\n\n`;
      summaryText += `称号: ${title}\n`;
      summaryText += `${subtitle}\n\n`;
      summaryText += `收藏种类: ${redGodCount} 种\n`;
      summaryText += `收藏总数: ${redTotalCount} 件\n`;
      summaryText += `总估值: ${formatNumber(redTotalMoney)}`;
      forwardMessages.push(summaryText);

      // 获取所有物品名称
      const allObjectIds = sortedCollections.map((item: any) => item.objectID);
      const allObjectNames: Record<string, string> = {};
      try {
        const allSearchRes = await api.searchObject('', allObjectIds.join(','));
        if (allSearchRes?.data?.keywords) {
          allSearchRes.data.keywords.forEach((obj: any) => {
            allObjectNames[obj.objectID] = obj.objectName;
          });
        }
      } catch (error) {
        // 静默处理，使用已有的 objectNames
        Object.assign(allObjectNames, objectNames);
      }

      // 每10个物品一条消息
      const chunkSize = 10;
      for (let i = 0; i < sortedCollections.length; i += chunkSize) {
        const chunk = sortedCollections.slice(i, i + chunkSize);
        let chunkText = `--- 珍藏明细 (${i + 1}-${Math.min(i + chunkSize, sortedCollections.length)}/${sortedCollections.length}) ---`;

        chunk.forEach((item: any, index: number) => {
          const globalIndex = i + index + 1;
          const name = allObjectNames[item.objectID] || objectNames[item.objectID] || `物品${item.objectID}`;
          chunkText += `\n\n${globalIndex}. ${name} x${item.count || 1}`;
          chunkText += `\n   价值: ${formatNumber(item.price || 0)}`;
        });

        forwardMessages.push(chunkText);
      }

      // 发送合并转发消息
      await makeForwardMsg(msg, forwardMessages, { userId: 66600000, nickname: '三角洲助手' });
    }
  } catch (error: any) {
    logger.error('查询藏品记录失败:', error);
    await reply(msg, `查询失败: ${error.message}\n\n请检查：\n1. 账号是否已登录或过期\n2. 是否已绑定游戏角色\n3. 网络连接是否正常`);
  }

  return true;
}

/** 出红记录统一入口 */
export async function getRedRecord (msg: OB11Message, args: string): Promise<boolean> {
  const argTrimmed = args.trim();

  // 如果没有参数或者参数是数字（赛季），查询全部记录
  if (!argTrimmed || /^\d+$/.test(argTrimmed)) {
    return getRedCollection(msg, `出红记录 ${argTrimmed}`.trim());
  }

  // 有物品名称参数，按名称查询
  return getRedByName(msg, argTrimmed);
}

/** 解析用户信息（与原版 red.js parseUserInfo 一致） */
function parseUserInfo (personalInfoRes: any): { userName: string; userAvatar: string; userRank: string; userRankImage: string | null; } {
  let userName = '未知';
  let userAvatar = '';
  let userRank = '未知段位';
  let userRankImage: string | null = null;

  if (personalInfoRes && personalInfoRes.data && personalInfoRes.roleInfo) {
    const { userData, careerData } = personalInfoRes.data;
    const { roleInfo } = personalInfoRes;

    userName = decode(userData?.charac_name || roleInfo?.charac_name) || '未知';
    userAvatar = decode(userData?.picurl || roleInfo?.picurl) || '';

    // 头像处理：如果是纯数字，转换为 wegame 头像 URL
    if (userAvatar && /^[0-9]+$/.test(userAvatar)) {
      userAvatar = `https://wegame.gtimg.com/g.2001918-r.ea725/helper/df/skin/${userAvatar}.webp`;
    }

    // 解析段位信息（与原版一致：使用 rankpoint 分数来获取段位）
    if (careerData?.rankpoint) {
      const fullRank = dataManager.getRankByScore(careerData.rankpoint, 'sol');
      userRank = fullRank.replace(/\s*\(\d+\)/, ''); // 移除分数部分
      userRankImage = dataManager.getRankImagePath(userRank, 'sol');
    } else if (careerData?.sol?.data?.data?.rank) {
      // 备用方案：直接从 rank 对象获取
      const rankInfo = careerData.sol.data.data.rank;
      userRank = rankInfo.rankName || '未知段位';
      if (rankInfo.bigRank !== undefined && rankInfo.smallRank !== undefined) {
        userRankImage = `imgs/rank/sol/${rankInfo.bigRank}_${rankInfo.smallRank}.webp`;
      }
    }
  }

  return { userName, userAvatar, userRank, userRankImage };
}

/** 获取地图背景路径（与原版 red.js 一致，支持降级匹配） */
function getMapBgPath (mapName: any): string {
  if (!mapName || typeof mapName !== 'string') return '';

  const modePrefix = '烽火'; // 藏品只在烽火地带
  const parts = mapName.split('-');

  if (parts.length >= 2) {
    // 有难度级别的情况：baseMapName-difficulty (如: 长弓溪谷-困难)
    const baseMapName = parts[0];
    const difficulty = parts.slice(1).join('-');

    // 尝试精确匹配，不存在时降级到常规
    // 实际渲染时由 render.ts 处理文件存在性检查
    return `imgs/map/${modePrefix}-${baseMapName}-${difficulty}.png`;
  } else {
    // 只有基础地图名称的情况
    const cleanMapName = parts[0];
    return `imgs/map/${modePrefix}-${cleanMapName}.jpg`;
  }
}

/** 按物品名称查询藏品记录 */
async function getRedByName (msg: OB11Message, itemName: string): Promise<boolean> {
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await reply(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  if (!itemName) {
    await reply(msg, '请指定要查询的物品名称');
    return true;
  }

  await reply(msg, `正在搜索物品"${itemName}"的藏品记录...`);

  const api = createApi();

  try {
    // 搜索物品获取objectID
    const searchRes = await api.searchObject(itemName, '');
    if (await checkApiError(searchRes, msg)) return true;

    const items = searchRes?.data?.keywords;
    if (!Array.isArray(items) || items.length === 0) {
      await reply(msg, `未找到名为"${itemName}"的物品，请检查名称是否正确`);
      return true;
    }

    const targetItem = items[0];
    const objectId = targetItem.objectID;

    if (!objectId) {
      await reply(msg, '获取物品ID失败，无法查询记录');
      return true;
    }

    // 获取记录和用户信息
    const [recordRes, personalInfoRes] = await Promise.all([
      api.getRedRecord(token, String(objectId)),
      api.getPersonalInfo(token),
    ]);

    if (await checkApiError(recordRes, msg)) return true;

    // 检查 API 返回 (兼容 success 和 code)
    const isRecordSuccess = recordRes?.success || recordRes?.code === 0 || recordRes?.code === '0';
    if (!recordRes || !isRecordSuccess || !recordRes.data) {
      await reply(msg, '获取藏品记录失败：数据格式错误');
      return true;
    }

    const itemData = recordRes.data.itemData;
    if (!itemData || !itemData.list || itemData.list.length === 0) {
      await reply(msg, `物品"${targetItem.objectName}"暂无解锁记录`);
      return true;
    }

    // 解析用户信息
    const { userName, userAvatar, userRank, userRankImage } = parseUserInfo(personalInfoRes);
    const qqAvatarUrl = `http://q.qlogo.cn/headimg_dl?dst_uin=${msg.user_id}&spec=640&img_type=jpg`;

    // 按时间正序排列（最早的在前）
    const sortedRecords = itemData.list.sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime());

    // 获取首次解锁记录
    const firstRecord = sortedRecords[0];
    const firstUnlockMapName = String(dataManager.getMapName(firstRecord.mapid) || '未知地图');
    const firstUnlockMapBg = getMapBgPath(firstUnlockMapName);

    // 取最新20条记录（按时间倒序，最新的在前）
    const latestRecords = sortedRecords.slice(-20).reverse();

    // 构建记录列表数据
    const records = latestRecords.map((record: any) => {
      const mapName = String(dataManager.getMapName(record.mapid) || '未知地图');
      return {
        time: record.time,
        map: mapName,
        count: record.num || 1,
      };
    });

    // 物品图片URL
    const itemImageUrl = `https://playerhub.df.qq.com/playerhub/60004/object/${objectId}.png`;

    // 尝试渲染图片
    const html = generateRedRecordHtml({
      userName,
      userRank,
      userRankImage: userRankImage || undefined,
      userAvatar: userAvatar || qqAvatarUrl,
      qqAvatarUrl,
      itemName: targetItem.objectName,
      itemType: targetItem.objectType || (targetItem.grade ? `GRADE ${targetItem.grade}` : ''),
      itemImageUrl,
      firstUnlockTime: firstRecord.time,
      firstUnlockMap: firstUnlockMapName,
      firstUnlockMapBg: firstUnlockMapBg || undefined,
      records,
      recordCount: itemData.total || records.length,
    });

    const result = await render({ template: html, selector: '.red-record-container', width: 1280, height: 3000 });

    if (result.success && result.data) {
      // 渲染成功，发送图片（replyImage 内部会加 base64:// 前缀）
      await replyImage(msg, result.data);
    } else {
      // 渲染失败，回退到合并转发消息
      logger.warn('图片渲染失败，回退到文本模式:', result.error);

      // 构建合并转发消息数组
      const forwardMessages: string[] = [];

      // 第一条：标题信息
      let titleText = `【${userName} - ${targetItem.objectName} 解锁记录】\n\n`;
      titleText += `首次解锁: ${firstRecord.time}\n`;
      titleText += `首次地图: ${firstUnlockMapName}\n`;
      titleText += `总解锁次数: ${itemData.total || sortedRecords.length}`;
      forwardMessages.push(titleText);

      // 每5-10条记录一条消息
      const chunkSize = 8;
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize);
        let chunkText = `--- 记录 (${i + 1}-${Math.min(i + chunkSize, records.length)}/${records.length}) ---`;

        chunk.forEach((record, index) => {
          const globalIndex = i + index + 1;
          chunkText += `\n\n${globalIndex}. ${record.time}`;
          chunkText += `\n   地图: ${record.map}`;
          if (record.count > 1) {
            chunkText += `\n   数量: x${record.count}`;
          }
        });

        forwardMessages.push(chunkText);
      }

      // 发送合并转发消息
      await makeForwardMsg(msg, forwardMessages, { nickname: '藏品记录' });
    }
  } catch (error: any) {
    logger.error('指定藏品记录查询失败:', error);
    await reply(msg, '查询失败，请稍后重试');
  }

  return true;
}
