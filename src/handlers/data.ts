/**
 * 数据查询处理器
 */

import type { OB11Message } from 'napcat-types';
import { pluginState } from '../core/state';
import { createApi } from '../core/api';
import { reply, replyAt, replyImage, getUserId, makeForwardMsg, isGroupMsg } from '../utils/message';
import { handleApiError as _handleApiError } from '../utils/error-handler';
import { getAccount } from '../utils/account';
import type { CommandDef } from '../utils/command';
import { render, generatePersonalDataHtml, type PersonalDataTemplateData } from '../services/render';
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
  { keywords: ['货币', 'money', '余额'], handler: 'getMoney', name: '货币查询' },
  { keywords: ['数据', 'data'], handler: 'getPersonalData', name: '数据统计', hasArgs: true },
];

/** 货币查询 */
export async function getMoney (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  const res = await api.getMoney(token);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data) {
    await reply(msg, '获取货币信息失败');
    return true;
  }

  let text = '【三角洲行动-货币信息】\n';
  const data = (res as any).data;

  if (Array.isArray(data) && data.length > 0) {
    data.forEach((item: { name: string; totalMoney: number; }) => {
      text += `${item.name}: ${item.totalMoney}\n`;
    });
  } else {
    text += '未查询到货币信息';
  }

  await reply(msg, text.trim());
  return true;
}

/** 获取物品名称映射 */
async function getObjectNames (api: any, objectIDs: string[]): Promise<Record<string, string>> {
  if (!objectIDs || objectIDs.length === 0) return {};
  try {
    const idsString = objectIDs.join(',');
    const res = await api.searchObject('', idsString);
    if (res && (res as any).success && (res as any).data?.keywords) {
      const nameMap: Record<string, string> = {};
      (res as any).data.keywords.forEach((item: any) => {
        if (item.objectID) {
          const id = String(item.objectID);
          const name = item.name || item.objectName;
          if (name) nameMap[id] = name;
        }
      });
      return nameMap;
    }
  } catch (error) {
    logger.warn(`获取物品名称失败: ${error}`);
  }
  return {};
}

/** 生成烽火地带数据文本摘要 */
function generateSolDataSummary(solDetail: any, userName: string, season: number | string, objectNameMap: Record<string, string>): string {
  const solRank = solDetail.levelScore ? dataManager.getRankByScore(solDetail.levelScore, 'sol') : '-';
  let summary = `【烽火地带 - 个人统计】\n`;
  summary += `玩家: ${userName}\n`;
  summary += `赛季: ${season === 'all' ? '全部' : season}\n`;
  summary += `等级: ${solDetail.level || '-'}\n`;
  summary += `段位: ${solRank}\n`;
  summary += `段位分: ${solDetail.levelScore || 0}\n`;
  
  if (solDetail.totalCount) summary += `总场次: ${solDetail.totalCount}\n`;
  if (solDetail.winCount) summary += `胜利场次: ${solDetail.winCount}\n`;
  if (solDetail.totalCount && solDetail.winCount) {
    const winRate = ((solDetail.winCount / solDetail.totalCount) * 100).toFixed(1);
    summary += `胜率: ${winRate}%\n`;
  }
  
  if (solDetail.totalKill) summary += `总击杀: ${solDetail.totalKill}\n`;
  if (solDetail.totalDeath) summary += `总死亡: ${solDetail.totalDeath}\n`;
  if (solDetail.totalKill && solDetail.totalDeath) {
    const kd = (solDetail.totalKill / solDetail.totalDeath).toFixed(2);
    summary += `KD: ${kd}\n`;
  }
  
  if (solDetail.mapList && solDetail.mapList.length > 0) {
    summary += `\n地图统计（前5）:\n`;
    const topMaps = solDetail.mapList
      .map((map: any) => ({
        name: dataManager.getMapName(map.mapID),
        count: map.totalCount || 0,
      }))
      .sort((a: any, b: any) => b.count - a.count)
      .slice(0, 5);
    topMaps.forEach((map: any, index: number) => {
      summary += `${index + 1}. ${map.name}: ${map.count}场\n`;
    });
  }
  
  if (solDetail.gunPlayList && solDetail.gunPlayList.length > 0) {
    summary += `\n武器统计（前5）:\n`;
    const topWeapons = solDetail.gunPlayList
      .map((weapon: any) => ({
        name: objectNameMap[String(weapon.objectID)] || `武器(${weapon.objectID})`,
        price: weapon.totalPrice || 0,
      }))
      .sort((a: any, b: any) => b.price - a.price)
      .slice(0, 5);
    topWeapons.forEach((weapon: any, index: number) => {
      summary += `${index + 1}. ${weapon.name}: ${weapon.price}\n`;
    });
  }
  
  return summary.trim();
}

/** 生成全面战场数据文本摘要 */
function generateMpDataSummary(mpDetail: any, userName: string, season: number | string): string {
  const mpRank = mpDetail.levelScore ? dataManager.getRankByScore(mpDetail.levelScore, 'mp') : '-';
  let summary = `【全面战场 - 个人统计】\n`;
  summary += `玩家: ${userName}\n`;
  summary += `赛季: ${season === 'all' ? '全部' : season}\n`;
  summary += `等级: ${mpDetail.level || '-'}\n`;
  summary += `段位: ${mpRank}\n`;
  summary += `段位分: ${mpDetail.levelScore || 0}\n`;
  
  if (mpDetail.totalCount) summary += `总场次: ${mpDetail.totalCount}\n`;
  if (mpDetail.winCount) summary += `胜利场次: ${mpDetail.winCount}\n`;
  if (mpDetail.totalCount && mpDetail.winCount) {
    const winRate = ((mpDetail.winCount / mpDetail.totalCount) * 100).toFixed(1);
    summary += `胜率: ${winRate}%\n`;
  }
  
  if (mpDetail.totalKill) summary += `总击杀: ${mpDetail.totalKill}\n`;
  if (mpDetail.totalDeath) summary += `总死亡: ${mpDetail.totalDeath}\n`;
  if (mpDetail.totalKill && mpDetail.totalDeath) {
    const kd = (mpDetail.totalKill / mpDetail.totalDeath).toFixed(2);
    summary += `KD: ${kd}\n`;
  }
  
  if (mpDetail.mapList && mpDetail.mapList.length > 0) {
    summary += `\n地图统计（前5）:\n`;
    const topMaps = mpDetail.mapList
      .map((map: any) => ({
        name: dataManager.getMapName(map.mapID),
        count: map.totalCount || 0,
      }))
      .sort((a: any, b: any) => b.count - a.count)
      .slice(0, 5);
    topMaps.forEach((map: any, index: number) => {
      summary += `${index + 1}. ${map.name}: ${map.count}场\n`;
    });
  }
  
  return summary.trim();
}

/** 数据统计 */
export async function getPersonalData (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  // 解析参数
  const argList = args.split(/\s+/).filter(Boolean);
  let mode = '';
  let season: number | string = 7;

  for (const arg of argList) {
    if (['烽火', '烽火地带', 'sol', '摸金'].includes(arg)) {
      mode = 'sol';
    } else if (['全面', '全面战场', 'mp'].includes(arg)) {
      mode = 'mp';
    } else if (['all', '全部'].includes(arg.toLowerCase())) {
      season = 'all';
    } else if (!isNaN(Number(arg))) {
      season = parseInt(arg);
    }
  }

  await reply(msg, '正在查询数据，请稍候...');

  const res = await api.getPersonalData(token, mode, season);
  if (await checkApiError(res, msg)) return true;

  if (!res) {
    await reply(msg, '查询失败');
    return true;
  }

  // 解析数据结构
  let solDetail: any = null;
  let mpDetail: any = null;

  if (mode) {
    // 单模式查询
    const singleModeData = (res as any).data?.data?.data;
    if (singleModeData?.solDetail) solDetail = singleModeData.solDetail;
    if (singleModeData?.mpDetail) mpDetail = singleModeData.mpDetail;
  } else {
    // 全模式查询
    const allModesData = (res as any).data;
    if (allModesData?.sol?.data?.data?.solDetail) {
      solDetail = allModesData.sol.data.data.solDetail;
    }
    if (allModesData?.mp?.data?.data?.mpDetail) {
      mpDetail = allModesData.mp.data.data.mpDetail;
    }
  }

  if (!solDetail && !mpDetail) {
    await reply(msg, '暂未查询到该账号的游戏数据');
    return true;
  }

  // 获取用户信息
  let userName = msg.sender?.card || msg.sender?.nickname || '干员';
  let userAvatar = '';
  try {
    const personalInfoRes = await api.getPersonalInfo(token);
    if (personalInfoRes && (personalInfoRes as any).data && (personalInfoRes as any).roleInfo) {
      const userData = (personalInfoRes as any).data.userData;
      const roleInfo = (personalInfoRes as any).roleInfo;
      const gameUserName = decodeURIComponent(userData?.charac_name || roleInfo?.charac_name || '');
      if (gameUserName) userName = gameUserName;
      const picUrl = decodeURIComponent(userData?.picurl || roleInfo?.picurl || '');
      if (picUrl) {
        if (/^[0-9]+$/.test(picUrl)) {
          userAvatar = `https://wegame.gtimg.com/g.2001918-r.ea725/helper/df/skin/${picUrl}.webp`;
        } else {
          userAvatar = picUrl;
        }
      }
    }
  } catch (error) {
    logger.warn(`获取用户信息失败: ${error}`);
  }

  const now = new Date();
  const currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const qqAvatarUrl = `http://q.qlogo.cn/headimg_dl?dst_uin=${userId}&spec=640&img_type=jpg`;

  // 渲染图片
  const forwardMsgs: string[] = [];
  const hasBothModes = solDetail && mpDetail;

  // 渲染烽火地带
  if (solDetail) {
    const solRank = solDetail.levelScore ? dataManager.getRankByScore(solDetail.levelScore, 'sol') : '-';
    const solRankImage = solRank !== '-' ? dataManager.getRankImagePath(solRank, 'sol') : null;

    // 获取物品名称
    const collectionIDs = (solDetail.redCollectionDetail || []).map((item: any) => String(item.objectID));
    const weaponIDs = (solDetail.gunPlayList || []).map((weapon: any) => String(weapon.objectID));
    const allObjectIDs = [...new Set([...collectionIDs, ...weaponIDs])];
    const objectNameMap = await getObjectNames(api, allObjectIDs);

    // 处理地图列表（按基础地图名分组）
    const mapOrder = ['零号大坝', '长弓溪谷', '巴克什', '航天基地', '潮汐监狱'];
    const solMapListRaw = (solDetail.mapList || []).map((map: any) => {
      const mapName = dataManager.getMapName(map.mapID);
      const baseMapName = mapName.replace(/-?(常规|机密|绝密|水淹|适应)$/, '');
      const mapImage = dataManager.getMapImagePath(mapName, 'sol');
      return { ...map, mapName, baseMapName, mapImage };
    });

    const mapGroups: Record<string, any[]> = {};
    solMapListRaw.forEach((map: any) => {
      if (!mapGroups[map.baseMapName]) mapGroups[map.baseMapName] = [];
      mapGroups[map.baseMapName].push(map);
    });

    const solMapList = mapOrder
      .filter(baseName => mapGroups[baseName] && mapGroups[baseName].length > 0)
      .flatMap(baseName => {
        const maps = mapGroups[baseName];
        maps.sort((a: any, b: any) => b.totalCount - a.totalCount);
        return maps;
      });

    // 处理武器列表
    const solGunPlayList = (solDetail.gunPlayList || []).map((weapon: any) => ({
      ...weapon,
      weaponName: objectNameMap[String(weapon.objectID)] || `武器(${weapon.objectID})`,
    })).sort((a: any, b: any) => (b.totalPrice || 0) - (a.totalPrice || 0)).slice(0, 10);

    // 处理收藏品列表
    const solRedCollection = (solDetail.redCollectionDetail || []).map((item: any) => ({
      ...item,
      objectName: objectNameMap[String(item.objectID)] || item.objectName || `物品(${item.objectID})`,
    })).sort((a: any, b: any) => (b.price || 0) - (a.price || 0)).slice(0, 10);

    const solTemplateData: PersonalDataTemplateData = {
      userName,
      userAvatar,
      qqAvatarUrl,
      season: season === 'all' ? '全部' : season,
      currentDate,
      mode: 'sol',
      solDetail: {
        ...solDetail,
        mapList: solMapList,
        gunPlayList: solGunPlayList,
        redCollectionDetail: solRedCollection,
      },
      solRank,
      solRankImage,
    };

    try {
      const solHtml = generatePersonalDataHtml(solTemplateData);
      const result = await render({
        template: solHtml,
        selector: '.container',
        width: 1600,
        height: 1200,
        fullPage: true,
        waitForTimeout: 500,
      });

      if (result.success && result.data) {
        if (hasBothModes) {
          forwardMsgs.push(`【烽火地带 - 个人统计】\n[CQ:image,file=base64://${result.data}]`);
        } else {
          await replyImage(msg, result.data);
          return true;
        }
      } else {
        const textSummary = generateSolDataSummary(solDetail, userName, season, objectNameMap);
        if (!hasBothModes) {
          await makeForwardMsg(msg, [textSummary], { nickname: '数据统计' });
          return true;
        }
        forwardMsgs.push(textSummary);
      }
    } catch (error) {
      logger.error(`烽火地带渲染失败: ${error}`);
      const textSummary = generateSolDataSummary(solDetail, userName, season, objectNameMap);
      if (!hasBothModes) {
        await makeForwardMsg(msg, [textSummary], { nickname: '数据统计' });
        return true;
      }
      forwardMsgs.push(textSummary);
    }
  }

  // 渲染全面战场
  if (mpDetail) {
    const mpRank = mpDetail.levelScore ? dataManager.getRankByScore(mpDetail.levelScore, 'mp') : '-';
    const mpRankImage = mpRank !== '-' ? dataManager.getRankImagePath(mpRank, 'mp') : null;

    // 处理地图列表
    const mpMapList = (mpDetail.mapList || []).map((map: any) => {
      const mapName = dataManager.getMapName(map.mapID);
      const mapImage = dataManager.getMapImagePath(mapName, 'mp');
      return { ...map, mapName, mapImage };
    }).sort((a: any, b: any) => b.totalCount - a.totalCount).slice(0, 10);

    const mpTemplateData: PersonalDataTemplateData = {
      userName,
      userAvatar,
      qqAvatarUrl,
      season: season === 'all' ? '全部' : season,
      currentDate,
      mode: 'mp',
      mpDetail: {
        ...mpDetail,
        mapList: mpMapList,
      },
      mpRank,
      mpRankImage,
    };

    try {
      const mpHtml = generatePersonalDataHtml(mpTemplateData);
      const result = await render({
        template: mpHtml,
        selector: '.container',
        width: 1600,
        height: 1200,
        fullPage: true,
        waitForTimeout: 500,
      });

      if (result.success && result.data) {
        if (hasBothModes) {
          forwardMsgs.push(`【全面战场 - 个人统计】\n[CQ:image,file=base64://${result.data}]`);
        } else {
          await replyImage(msg, result.data);
          return true;
        }
      } else {
        const textSummary = generateMpDataSummary(mpDetail, userName, season);
        if (!hasBothModes) {
          await makeForwardMsg(msg, [textSummary], { nickname: '数据统计' });
          return true;
        }
        forwardMsgs.push(textSummary);
      }
    } catch (error) {
      logger.error(`全面战场渲染失败: ${error}`);
      const textSummary = generateMpDataSummary(mpDetail, userName, season);
      if (!hasBothModes) {
        await makeForwardMsg(msg, [textSummary], { nickname: '数据统计' });
        return true;
      }
      forwardMsgs.push(textSummary);
    }
  }

  // 发送合并转发消息
  if (hasBothModes && forwardMsgs.length > 0) {
    const forwardResult = await makeForwardMsg(msg, forwardMsgs);
    if (!forwardResult) {
      await reply(msg, '发送合并消息失败，请稍后重试');
    }
  }

  return true;
}

export default {
  commands,
  getMoney,
  getPersonalData,
};
