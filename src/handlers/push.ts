/**
 * 推送处理器
 * 管理定时推送功能（日报、周报、每日密码等）
 */

import type { OB11Message } from '../types/index';
import type { CommandDef } from '../utils/command';
import { createApi } from '../core/api';
import { pluginState } from '../core/state';
import { reply, getUserId, replyAt, sendGroupMsg } from '../utils/message';
import { getAccount, getAccountList } from '../utils/account';
import { getScheduler } from '../services/scheduler';
import { logger } from '../utils/logger';
import fs from 'node:fs';
import path from 'node:path';

/** 命令定义 */
export const commands: CommandDef[] = [
  { keywords: ['开启日报推送'], handler: 'enableDailyPush', name: '开启日报推送' },
  { keywords: ['关闭日报推送'], handler: 'disableDailyPush', name: '关闭日报推送' },
  { keywords: ['开启周报推送'], handler: 'enableWeeklyPush', name: '开启周报推送' },
  { keywords: ['关闭周报推送'], handler: 'disableWeeklyPush', name: '关闭周报推送' },
  { keywords: ['开启每日密码推送'], handler: 'enableKeywordPush', name: '开启每日密码推送' },
  { keywords: ['关闭每日密码推送'], handler: 'disableKeywordPush', name: '关闭每日密码推送' },
  { keywords: ['开启特勤处推送'], handler: 'enablePlacePush', name: '开启特勤处推送' },
  { keywords: ['关闭特勤处推送'], handler: 'disablePlacePush', name: '关闭特勤处推送' },
  { keywords: ['推送状态', '推送设置'], handler: 'getPushStatus', name: '推送状态' },
];

/** 用户推送订阅信息 */
interface UserPushSubscription {
  groups: string[];  // 推送到的群
  nickname?: string; // 用户昵称
}

/** 推送配置 */
interface PushConfig {
  dailyPush: {
    enabled: boolean;
    time: string;
    groups: string[];  // 仅群开关，按群开启
    users: Record<string, UserPushSubscription>;  // 用户订阅
  };
  weeklyPush: {
    enabled: boolean;
    time: string;
    dayOfWeek: number;
    groups: string[];
    users: Record<string, UserPushSubscription>;
  };
  keywordPush: { enabled: boolean; time: string; groups: string[]; };
  placePush: { enabled: boolean; users: Record<string, { groups: string[]; }>; };
}

/** 默认推送配置 */
const DEFAULT_PUSH_CONFIG: PushConfig = {
  dailyPush: { enabled: false, time: '0 10 * * *', groups: [], users: {} },
  weeklyPush: { enabled: false, time: '0 10 * * 1', dayOfWeek: 1, groups: [], users: {} },
  keywordPush: { enabled: false, time: '0 8 * * *', groups: [] },
  placePush: { enabled: false, users: {} },
};

/** 获取推送配置文件路径 */
function getPushConfigPath (): string {
  const ctx = pluginState.getContext();
  if (!ctx?.configPath) return '';
  return path.join(path.dirname(ctx.configPath), 'push-config.json');
}

/** 加载推送配置 */
function loadPushConfig (): PushConfig {
  const configPath = getPushConfigPath();
  if (!configPath) return { ...DEFAULT_PUSH_CONFIG };

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return { ...DEFAULT_PUSH_CONFIG, ...JSON.parse(content) };
    }
  } catch (error) {
    logger.error('加载推送配置失败:', error);
  }
  return { ...DEFAULT_PUSH_CONFIG };
}

/** 保存推送配置 */
function savePushConfig (config: PushConfig): void {
  const configPath = getPushConfigPath();
  if (!configPath) return;

  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    logger.error('保存推送配置失败:', error);
  }
}

/** 发送群消息 */
async function sendGroupMessage (groupId: string, message: string): Promise<void> {
  const ctx = pluginState.getContext();
  if (!ctx?.actions) return;

  try {
    await ctx.actions.call(
      'send_group_msg',
      { group_id: groupId, message } as never,
      ctx.adapterName,
      ctx.pluginManager.config
    );
  } catch (error) {
    logger.error(`发送群消息失败 [${groupId}]:`, error);
  }
}

/** 每日密码推送任务 */
async function pushDailyKeyword (): Promise<void> {
  const config = loadPushConfig();
  if (!config.keywordPush.enabled || config.keywordPush.groups.length === 0) return;

  const api = createApi();
  const res = await api.getDailyKeyword();

  if (!res || (!res.success && res.code !== 0)) {
    logger.error('推送每日密码失败：API请求出错');
    return;
  }

  const data = res.data;
  let message = '【每日密码推送】\n';
  message += `日期: ${data.date || new Date().toLocaleDateString()}\n`;
  message += `密码: ${data.keyword || '暂无'}`;
  if (data.description) message += `\n说明: ${data.description}`;

  for (const groupId of config.keywordPush.groups) {
    await sendGroupMessage(groupId, message);
  }

  logger.push(`每日密码已推送到 ${config.keywordPush.groups.length} 个群`);
}

/** 获取昨日日期字符串 */
function getYesterdayStr (): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** 格式化数字 */
function formatNum (num: number | undefined): string {
  return (num || 0).toLocaleString();
}

/** 日报推送任务 */
async function pushDailyReport (): Promise<void> {
  const config = loadPushConfig();
  if (!config.dailyPush.enabled) return;

  const userEntries = Object.entries(config.dailyPush.users).filter(
    ([_, sub]) => sub.groups && sub.groups.length > 0
  );

  if (userEntries.length === 0) {
    logger.push('[日报推送] 无订阅用户，跳过');
    return;
  }

  logger.push(`[日报推送] 开始执行，共 ${userEntries.length} 个用户`);
  const api = createApi();
  const yesterdayStr = getYesterdayStr();

  for (const [userId, subscription] of userEntries) {
    try {
      const token = await getAccount(userId);
      if (!token) {
        logger.warn(`[日报推送] 用户 ${userId} 未绑定账号，跳过`);
        continue;
      }

      // 获取昨日数据
      const res = await api.getDailyRecord(token, '', yesterdayStr);
      if (!res || !(res as any).success || !(res as any).data) {
        logger.warn(`[日报推送] 用户 ${userId} API数据异常，跳过`);
        continue;
      }

      const data = (res as any).data;
      const solDetail = data?.sol?.data?.data?.solDetail;
      const mpDetail = data?.mp?.data?.data?.mpDetail;

      if (!solDetail && !mpDetail) {
        logger.push(`[日报推送] 用户 ${userId} 无日报数据，跳过`);
        continue;
      }

      // 获取用户昵称
      let userName = subscription.nickname || userId;
      try {
        const infoRes = await api.getPersonalInfo(token);
        if (infoRes && (infoRes as any).roleInfo?.charac_name) {
          userName = decodeURIComponent((infoRes as any).roleInfo.charac_name);
        }
      } catch { }

      // 构建消息
      let message = `【${userName} 的昨日战报】\n`;

      if (solDetail) {
        const hasData = solDetail.total_round && Number(solDetail.total_round) > 0;
        if (hasData) {
          message += '\n━━ 烽火地带 ━━\n';
          message += `局数: ${solDetail.total_round || 0}\n`;
          message += `撤离: ${solDetail.escape_count || 0} | 死亡: ${solDetail.death_count || 0}\n`;
          message += `击杀: ${solDetail.kill_human || 0} | 爆头: ${solDetail.headshot_kill || 0}\n`;
          message += `总收入: ${formatNum(solDetail.earn_money)}\n`;
        }
      }

      if (mpDetail) {
        const hasData = mpDetail.total_round && Number(mpDetail.total_round) > 0;
        if (hasData) {
          message += '\n━━ 全面战场 ━━\n';
          message += `局数: ${mpDetail.total_round || 0}\n`;
          message += `胜/负: ${mpDetail.win_count || 0}/${mpDetail.lose_count || 0}\n`;
          message += `击杀: ${mpDetail.kill_human || 0} | 死亡: ${mpDetail.death || 0}\n`;
        }
      }

      // 推送到所有订阅群
      for (const groupId of subscription.groups) {
        try {
          await sendGroupMsg(groupId, [
            { type: 'at', data: { qq: userId } },
            { type: 'text', data: { text: '\n' + message } },
          ]);
          logger.debug(`[日报推送] 已推送用户 ${userId} 到群 ${groupId}`);
        } catch (err) {
          logger.error(`[日报推送] 推送到群 ${groupId} 失败:`, err);
        }
      }
    } catch (err) {
      logger.error(`[日报推送] 处理用户 ${userId} 时出错:`, err);
    }
  }

  logger.push('[日报推送] 执行完毕');
}

/** 周报推送任务 */
async function pushWeeklyReport (): Promise<void> {
  const config = loadPushConfig();
  if (!config.weeklyPush.enabled) return;

  const userEntries = Object.entries(config.weeklyPush.users).filter(
    ([_, sub]) => sub.groups && sub.groups.length > 0
  );

  if (userEntries.length === 0) {
    logger.push('[周报推送] 无订阅用户，跳过');
    return;
  }

  logger.push(`[周报推送] 开始执行，共 ${userEntries.length} 个用户`);
  const api = createApi();

  for (const [userId, subscription] of userEntries) {
    try {
      const token = await getAccount(userId);
      if (!token) {
        logger.warn(`[周报推送] 用户 ${userId} 未绑定账号，跳过`);
        continue;
      }

      // 获取周报数据
      const res = await api.getWeeklyRecord(token, '', true, '');
      if (!res || !(res as any).success || !(res as any).data) {
        logger.warn(`[周报推送] 用户 ${userId} API数据异常，跳过`);
        continue;
      }

      const data = (res as any).data;
      const solData = data?.sol?.data?.data;
      const mpData = data?.mp?.data?.data;

      if (!solData && !mpData) {
        logger.push(`[周报推送] 用户 ${userId} 无周报数据，跳过`);
        continue;
      }

      // 获取用户昵称
      let userName = subscription.nickname || userId;
      try {
        const infoRes = await api.getPersonalInfo(token);
        if (infoRes && (infoRes as any).roleInfo?.charac_name) {
          userName = decodeURIComponent((infoRes as any).roleInfo.charac_name);
        }
      } catch { }

      // 构建消息
      let message = `【${userName} 的本周战报】\n`;

      if (solData && solData.total_sol_num > 0) {
        message += '\n━━ 烽火地带 ━━\n';
        message += `局数: ${solData.total_sol_num || 0}\n`;
        message += `撤离: ${solData.total_exacuation_num || 0} | 死亡: ${solData.total_Death_Count || 0}\n`;
        message += `击杀玩家: ${solData.total_Kill_Player || 0} | 击杀AI: ${solData.total_Kill_AI || 0}\n`;
        message += `总收入: ${formatNum(solData.Gained_Price)} | 消耗: ${formatNum(solData.consume_Price)}\n`;
        if (solData.rise_Price) {
          message += `净利润: ${formatNum(solData.rise_Price)}\n`;
        }
      }

      if (mpData && mpData.total_num > 0) {
        const winRate = mpData.total_num > 0
          ? `${((mpData.win_num / mpData.total_num) * 100).toFixed(1)}%`
          : '0%';
        message += '\n━━ 全面战场 ━━\n';
        message += `局数: ${mpData.total_num || 0} | 胜率: ${winRate}\n`;
        message += `击杀: ${mpData.Kill_Num || 0} | 连杀: ${mpData.continuous_Kill_Num || 0}\n`;
        message += `总积分: ${formatNum(mpData.total_score)}\n`;
      }

      // 推送到所有订阅群
      for (const groupId of subscription.groups) {
        try {
          await sendGroupMsg(groupId, [
            { type: 'at', data: { qq: userId } },
            { type: 'text', data: { text: '\n' + message } },
          ]);
          logger.debug(`[周报推送] 已推送用户 ${userId} 到群 ${groupId}`);
        } catch (err) {
          logger.error(`[周报推送] 推送到群 ${groupId} 失败:`, err);
        }
      }
    } catch (err) {
      logger.error(`[周报推送] 处理用户 ${userId} 时出错:`, err);
    }
  }

  logger.push('[周报推送] 执行完毕');
}

// ==================== 特勤处推送 ====================

/** 待推送的特勤处任务 */
interface PlaceTask {
  userId: string;
  placeId: string;
  objectName: string;
  pushToGroups: string[];
  finishTimestamp: number;
}

/** 内存中的待推送任务清单 */
const placeTasks = new Map<string, PlaceTask>();

/** 已通知过期的用户（避免重复通知） */
const expireNotified = new Set<string>();

/** 高频推送器定时器 */
let placeTaskTimer: ReturnType<typeof setInterval> | null = null;

/** 低频调度器定时器 */
let placeSchedulerTimer: ReturnType<typeof setInterval> | null = null;

/** 特勤处低频调度器：同步API状态并调度任务 */
async function pollPlaceStatus (): Promise<void> {
  const config = loadPushConfig();
  if (!config.placePush.enabled) return;

  const userEntries = Object.entries(config.placePush.users).filter(
    ([_, sub]) => sub.groups && sub.groups.length > 0
  );

  if (userEntries.length === 0) return;

  logger.debug('[特勤处调度器] 开始同步API状态...');
  const api = createApi();

  for (const [userId, subscription] of userEntries) {
    try {
      const token = await getAccount(userId);
      if (!token) continue;

      const res = await api.getPlaceStatus(token);

      // 检查 token 过期
      if (!res || !(res as any).success) {
        const data = (res as any)?.data;
        if (data?.ret === 101 || (res as any)?.error?.includes('请先完成QQ或微信登录')) {
          await handlePlaceTokenExpired(userId, subscription.groups);
        }
        continue;
      }

      // 清除过期通知标记
      expireNotified.delete(userId);

      const places = (res as any).data?.places;
      if (!places || !Array.isArray(places)) continue;

      // 当前API返回的生产中任务
      const apiTasks = new Map<string, { id: string; objectName: string; leftTime: number; }>();
      places.filter((p: any) => p.objectDetail && p.leftTime > 0).forEach((p: any) => {
        apiTasks.set(p.id, {
          id: p.id,
          objectName: p.objectDetail.objectName,
          leftTime: p.leftTime,
        });
      });

      // 获取该用户当前已调度的任务
      const userTaskKeys = Array.from(placeTasks.keys()).filter(k => k.startsWith(`${userId}:`));
      const scheduledPlaceIds = new Set(userTaskKeys.map(k => k.split(':')[1]));

      // 新增或更新任务
      for (const [placeId, task] of apiTasks) {
        const key = `${userId}:${placeId}`;
        const finishTimestamp = Date.now() + (task.leftTime * 1000);

        placeTasks.set(key, {
          userId,
          placeId,
          objectName: task.objectName,
          pushToGroups: subscription.groups,
          finishTimestamp,
        });

        scheduledPlaceIds.delete(placeId);
      }

      // 清理API中已不存在的任务
      for (const placeId of scheduledPlaceIds) {
        placeTasks.delete(`${userId}:${placeId}`);
      }
    } catch (err) {
      logger.error(`[特勤处调度器] 处理用户 ${userId} 时出错:`, err);
    }
  }
}

/** 特勤处高频推送器：检查并推送到期任务 */
async function checkPlaceTasks (): Promise<void> {
  const config = loadPushConfig();
  if (!config.placePush.enabled) return;

  const now = Date.now();

  for (const [key, task] of placeTasks) {
    if (task.finishTimestamp <= now) {
      logger.debug(`[特勤处推送器] 发现到期任务: ${key}`);

      const msg = `您的 ${task.objectName} 已在特勤处生产完成！`;

      for (const groupId of task.pushToGroups) {
        try {
          await sendGroupMsg(groupId, [
            { type: 'at', data: { qq: task.userId } },
            { type: 'text', data: { text: ' ' + msg } },
          ]);
        } catch (err) {
          logger.error(`[特勤处推送器] 推送到群 ${groupId} 失败:`, err);
        }
      }

      placeTasks.delete(key);
    }
  }
}

/** 处理特勤处 token 过期 */
async function handlePlaceTokenExpired (userId: string, groups: string[]): Promise<void> {
  if (expireNotified.has(userId)) return;

  expireNotified.add(userId);
  logger.push(`[特勤处调度器] 检测到用户 ${userId} token过期，发送通知`);

  const msg = '您的三角洲行动登录已过期，特勤处推送功能已暂停。\n请使用 三角洲登录 重新登录以恢复推送功能。';

  for (const groupId of groups) {
    try {
      await sendGroupMsg(groupId, [
        { type: 'at', data: { qq: userId } },
        { type: 'text', data: { text: ' ' + msg } },
      ]);
    } catch (err) {
      logger.error(`[特勤处调度器] 发送过期通知到群 ${groupId} 失败:`, err);
    }
  }
}

/** 启动特勤处推送定时器 */
function startPlacePushTimers (): void {
  const config = loadPushConfig();
  if (!config.placePush.enabled || Object.keys(config.placePush.users).length === 0) {
    return;
  }

  // 高频推送器：每10秒检查一次
  if (!placeTaskTimer) {
    placeTaskTimer = setInterval(() => {
      checkPlaceTasks().catch(err => {
        logger.error('[特勤处推送器] 检查任务时出错:', err);
      });
    }, 10000);
    logger.push('[特勤处推送器] 已启动');
  }

  // 低频调度器：每5分钟同步一次
  if (!placeSchedulerTimer) {
    placeSchedulerTimer = setInterval(() => {
      pollPlaceStatus().catch(err => {
        logger.error('[特勤处调度器] 轮询状态时出错:', err);
      });
    }, 5 * 60 * 1000);
    logger.push('[特勤处调度器] 已启动');

    // 立即执行一次
    pollPlaceStatus().catch(() => { });
  }
}

/** 停止特勤处推送定时器 */
function stopPlacePushTimers (): void {
  if (placeTaskTimer) {
    clearInterval(placeTaskTimer);
    placeTaskTimer = null;
    logger.push('[特勤处推送器] 已停止');
  }
  if (placeSchedulerTimer) {
    clearInterval(placeSchedulerTimer);
    placeSchedulerTimer = null;
    logger.push('[特勤处调度器] 已停止');
  }
  placeTasks.clear();
}

/** 初始化推送任务 */
export function initPushTasks (): void {
  const config = loadPushConfig();
  const scheduler = getScheduler();

  // 每日密码推送（cron 格式：分钟 小时 日 月 星期）
  scheduler.register({
    id: 'daily_keyword',
    name: '每日密码推送',
    cron: config.keywordPush.time,
    handler: pushDailyKeyword,
    enabled: config.keywordPush.enabled && config.keywordPush.groups.length > 0,
  });

  // 日报推送
  scheduler.register({
    id: 'daily_report',
    name: '日报推送',
    cron: config.dailyPush.time,
    handler: pushDailyReport,
    enabled: config.dailyPush.enabled && Object.keys(config.dailyPush.users).length > 0,
  });

  // 周报推送（使用标准 cron 格式）
  scheduler.register({
    id: 'weekly_report',
    name: '周报推送',
    cron: config.weeklyPush.time,
    handler: pushWeeklyReport,
    enabled: config.weeklyPush.enabled && Object.keys(config.weeklyPush.users).length > 0,
  });

  // 启动特勤处推送定时器
  startPlacePushTimers();

  logger.push('推送任务已初始化');
}

/** 停止所有推送任务 */
export function stopPushTasks (): void {
  stopPlacePushTimers();
  logger.push('推送任务已停止');
}

// ==================== 命令处理函数 ====================

/** 开启日报推送 */
export async function enableDailyPush (msg: OB11Message): Promise<boolean> {
  if (!msg.group_id) {
    await reply(msg, '该指令只能在群聊中使用');
    return true;
  }

  const userId = getUserId(msg);
  const groupId = String(msg.group_id);

  // 检查用户是否已绑定账号
  const token = await getAccount(userId);
  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请先使用 三角洲登录 进行绑定后再开启日报推送');
    return true;
  }

  const config = loadPushConfig();

  // 初始化用户订阅
  if (!config.dailyPush.users[userId]) {
    config.dailyPush.users[userId] = { groups: [] };
  }

  // 添加群到用户订阅
  if (!config.dailyPush.users[userId].groups.includes(groupId)) {
    config.dailyPush.users[userId].groups.push(groupId);
  }

  config.dailyPush.enabled = true;
  savePushConfig(config);

  // 更新调度器
  const scheduler = getScheduler();
  scheduler.enable('daily_report');

  await replyAt(msg, `✅ 已为您在本群开启日报推送\n推送时间: ${config.dailyPush.time} (cron)`);
  return true;
}

/** 关闭日报推送 */
export async function disableDailyPush (msg: OB11Message): Promise<boolean> {
  if (!msg.group_id) {
    await reply(msg, '该指令只能在群聊中使用');
    return true;
  }

  const userId = getUserId(msg);
  const groupId = String(msg.group_id);
  const config = loadPushConfig();

  // 检查用户是否有订阅
  if (!config.dailyPush.users[userId]) {
    await reply(msg, '⚠️ 您尚未在本群开启日报推送');
    return true;
  }

  const idx = config.dailyPush.users[userId].groups.indexOf(groupId);
  if (idx < 0) {
    await reply(msg, '⚠️ 您尚未在本群开启日报推送');
    return true;
  }

  // 移除群
  config.dailyPush.users[userId].groups.splice(idx, 1);

  // 如果用户没有群了，删除用户配置
  if (config.dailyPush.users[userId].groups.length === 0) {
    delete config.dailyPush.users[userId];
  }

  // 如果没有用户了，禁用功能
  if (Object.keys(config.dailyPush.users).length === 0) {
    config.dailyPush.enabled = false;
    const scheduler = getScheduler();
    scheduler.disable('daily_report');
  }

  savePushConfig(config);
  await reply(msg, '✅ 已为您在本群关闭日报推送');
  return true;
}

/** 开启周报推送 */
export async function enableWeeklyPush (msg: OB11Message): Promise<boolean> {
  if (!msg.group_id) {
    await reply(msg, '该指令只能在群聊中使用');
    return true;
  }

  const userId = getUserId(msg);
  const groupId = String(msg.group_id);

  // 检查用户是否已绑定账号
  const token = await getAccount(userId);
  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请先使用 三角洲登录 进行绑定后再开启周报推送');
    return true;
  }

  const config = loadPushConfig();

  // 初始化用户订阅
  if (!config.weeklyPush.users[userId]) {
    config.weeklyPush.users[userId] = { groups: [] };
  }

  // 添加群到用户订阅
  if (!config.weeklyPush.users[userId].groups.includes(groupId)) {
    config.weeklyPush.users[userId].groups.push(groupId);
  }

  config.weeklyPush.enabled = true;
  savePushConfig(config);

  // 更新调度器
  const scheduler = getScheduler();
  scheduler.enable('weekly_report');

  await replyAt(msg, `✅ 已为您在本群开启周报推送\n推送时间: ${config.weeklyPush.time} (cron)`);
  return true;
}

/** 关闭周报推送 */
export async function disableWeeklyPush (msg: OB11Message): Promise<boolean> {
  if (!msg.group_id) {
    await reply(msg, '该指令只能在群聊中使用');
    return true;
  }

  const userId = getUserId(msg);
  const groupId = String(msg.group_id);
  const config = loadPushConfig();

  // 检查用户是否有订阅
  if (!config.weeklyPush.users[userId]) {
    await reply(msg, '⚠️ 您尚未在本群开启周报推送');
    return true;
  }

  const idx = config.weeklyPush.users[userId].groups.indexOf(groupId);
  if (idx < 0) {
    await reply(msg, '⚠️ 您尚未在本群开启周报推送');
    return true;
  }

  // 移除群
  config.weeklyPush.users[userId].groups.splice(idx, 1);

  // 如果用户没有群了，删除用户配置
  if (config.weeklyPush.users[userId].groups.length === 0) {
    delete config.weeklyPush.users[userId];
  }

  // 如果没有用户了，禁用功能
  if (Object.keys(config.weeklyPush.users).length === 0) {
    config.weeklyPush.enabled = false;
    const scheduler = getScheduler();
    scheduler.disable('weekly_report');
  }

  savePushConfig(config);
  await reply(msg, '✅ 已为您在本群关闭周报推送');
  return true;
}

/** 开启每日密码推送 */
export async function enableKeywordPush (msg: OB11Message): Promise<boolean> {
  if (!msg.group_id) {
    await reply(msg, '该指令只能在群聊中使用');
    return true;
  }

  const config = loadPushConfig();
  const groupId = String(msg.group_id);

  if (!config.keywordPush.groups.includes(groupId)) {
    config.keywordPush.groups.push(groupId);
  }
  config.keywordPush.enabled = true;
  savePushConfig(config);

  // 更新调度器任务
  const scheduler = getScheduler();
  scheduler.enable('daily_keyword');

  await reply(msg, `✅ 本群已开启每日密码推送\n推送时间: ${config.keywordPush.time} (cron)`);
  return true;
}

/** 关闭每日密码推送 */
export async function disableKeywordPush (msg: OB11Message): Promise<boolean> {
  if (!msg.group_id) {
    await reply(msg, '该指令只能在群聊中使用');
    return true;
  }

  const config = loadPushConfig();
  const groupId = String(msg.group_id);
  const idx = config.keywordPush.groups.indexOf(groupId);

  if (idx >= 0) {
    config.keywordPush.groups.splice(idx, 1);
    savePushConfig(config);

    // 如果没有群了，禁用任务
    if (config.keywordPush.groups.length === 0) {
      const scheduler = getScheduler();
      scheduler.disable('daily_keyword');
    }

    await reply(msg, '✅ 本群已关闭每日密码推送');
  } else {
    await reply(msg, '⚠️ 本群尚未开启每日密码推送');
  }
  return true;
}

/** 开启特勤处推送 */
export async function enablePlacePush (msg: OB11Message): Promise<boolean> {
  if (!msg.group_id) {
    await reply(msg, '该指令只能在群聊中使用');
    return true;
  }

  const userId = getUserId(msg);
  const groupId = String(msg.group_id);

  // 检查用户是否已绑定账号
  const token = await getAccount(userId);
  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请先使用 三角洲登录 进行绑定后再开启特勤处推送');
    return true;
  }

  // 验证 token 是否有效
  const api = createApi();
  const testRes = await api.getPlaceStatus(token);
  if (!testRes || !(testRes as any).success) {
    const data = (testRes as any)?.data;
    if (data?.ret === 101 || (testRes as any)?.error?.includes('请先完成QQ或微信登录')) {
      await replyAt(msg, '您的登录已过期，请先使用 三角洲登录 重新登录后再开启特勤处推送');
      return true;
    }
    await replyAt(msg, '检测到您的账号状态异常，请先确保能正常查询特勤处状态后再开启推送');
    return true;
  }

  const config = loadPushConfig();

  // 初始化用户配置
  if (!config.placePush.users[userId]) {
    config.placePush.users[userId] = { groups: [] };
  }

  // 添加群组
  if (!config.placePush.users[userId].groups.includes(groupId)) {
    config.placePush.users[userId].groups.push(groupId);
  }

  config.placePush.enabled = true;
  savePushConfig(config);

  // 启动定时器（如果尚未启动）
  startPlacePushTimers();

  await reply(msg, '✅ 已为您在本群开启特勤处生产完成推送');
  return true;
}

/** 关闭特勤处推送 */
export async function disablePlacePush (msg: OB11Message): Promise<boolean> {
  if (!msg.group_id) {
    await reply(msg, '该指令只能在群聊中使用');
    return true;
  }

  const userId = getUserId(msg);
  const groupId = String(msg.group_id);
  const config = loadPushConfig();

  // 检查用户是否有配置
  if (!config.placePush.users[userId]) {
    await reply(msg, '⚠️ 您尚未在本群开启特勤处推送');
    return true;
  }

  const idx = config.placePush.users[userId].groups.indexOf(groupId);
  if (idx < 0) {
    await reply(msg, '⚠️ 您尚未在本群开启特勤处推送');
    return true;
  }

  // 移除群组
  config.placePush.users[userId].groups.splice(idx, 1);

  // 如果用户没有任何群了，删除用户配置并清理该用户的待推送任务
  if (config.placePush.users[userId].groups.length === 0) {
    delete config.placePush.users[userId];
    // 清理该用户的待推送任务
    for (const key of placeTasks.keys()) {
      if (key.startsWith(`${userId}:`)) {
        placeTasks.delete(key);
      }
    }
  }

  // 如果没有用户了，禁用功能并停止定时器
  if (Object.keys(config.placePush.users).length === 0) {
    config.placePush.enabled = false;
    stopPlacePushTimers();
  }

  savePushConfig(config);
  await reply(msg, '✅ 已为您在本群关闭特勤处推送');
  return true;
}

/** 查看推送状态 */
export async function getPushStatus (msg: OB11Message): Promise<boolean> {
  const config = loadPushConfig();
  const groupId = msg.group_id ? String(msg.group_id) : '';
  const userId = getUserId(msg);

  let text = '【推送功能状态】\n\n';

  // 日报推送（用户级）
  const dailyEnabled = config.dailyPush.users[userId]?.groups.includes(groupId) ?? false;
  text += `📊 日报推送: ${dailyEnabled ? '✅ 已开启' : '❌ 未开启'}\n`;
  text += `   Cron: ${config.dailyPush.time}\n\n`;

  // 周报推送（用户级）
  const weeklyEnabled = config.weeklyPush.users[userId]?.groups.includes(groupId) ?? false;
  text += `📈 周报推送: ${weeklyEnabled ? '✅ 已开启' : '❌ 未开启'}\n`;
  text += `   Cron: ${config.weeklyPush.time}\n\n`;

  // 每日密码推送（群级）
  const keywordEnabled = config.keywordPush.groups.includes(groupId);
  text += `🔑 每日密码推送: ${keywordEnabled ? '✅ 已开启' : '❌ 未开启'}\n`;
  text += `   Cron: ${config.keywordPush.time}\n\n`;

  // 特勤处推送（用户级）
  const placeEnabled = config.placePush.users[userId]?.groups.includes(groupId) ?? false;
  text += `🏭 特勤处推送: ${placeEnabled ? '✅ 已开启' : '❌ 未开启'}\n`;
  text += `   (生产完成时通知)\n\n`;

  text += '使用 开启/关闭[功能]推送 来管理\n';
  text += 'Cron格式: 分 时 日 月 周 (如 0 8 * * * 表示每天8点)';

  await reply(msg, text);
  return true;
}
