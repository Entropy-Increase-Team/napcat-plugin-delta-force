/**
 * 战绩/战报处理器
 * 查询战绩、日报、周报
 */

import type { OB11Message } from 'napcat-types';
import { pluginState } from '../core/state';
import { createApi } from '../core/api';
import { reply, replyAt, replyImage, getUserId, makeForwardMsg } from '../utils/message';
import { handleApiError as _handleApiError } from '../utils/error-handler';
import { render, getStaticUrl, generateRecordHtml, RecordTemplateData } from '../services/render';
import { getAccount } from '../utils/account';
import type { CommandDef } from '../utils/command';
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
  { keywords: ['战绩', 'record'], handler: 'getRecord', name: '战绩查询', hasArgs: true },
  { keywords: ['日报', 'daily'], handler: 'getDailyReport', name: '日报查询', hasArgs: true },
  { keywords: ['周报', 'weekly'], handler: 'getWeeklyReport', name: '周报查询', hasArgs: true },
  { keywords: ['昨日收益', '昨日物资'], handler: 'getYesterdayProfit', name: '昨日收益', hasArgs: true },
];

/** 撤离原因映射 */
const ESCAPE_REASONS: Record<string, string> = {
  '1': '撤离成功', '2': '被玩家击杀', '3': '被人机击杀', '10': '撤离失败',
};

/** 全面战场结果映射 */
const MP_RESULTS: Record<string, string> = {
  '1': '胜利', '2': '失败', '3': '中途退出',
};

/** 解析模式参数 */
function parseMode (args: string): string {
  const lower = args.toLowerCase();
  if (['烽火', '烽火地带', 'sol', '摸金'].some(k => lower.includes(k))) return 'sol';
  if (['全面', '全面战场', '战场', 'mp'].some(k => lower.includes(k))) return 'mp';
  return '';
}

/** 解析页码参数 */
function parsePage (args: string): number {
  const match = args.match(/(\d+)/);
  return match ? Math.max(1, parseInt(match[1])) : 1;
}

/** 格式化时长 */
function formatDuration (seconds: number): string {
  if (!seconds && seconds !== 0) return '未知';
  if (seconds === 0) return '0秒';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}小时${m}分${s}秒`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

/** 格式化日期 */
function formatDate (timestamp: number): string {
  const d = new Date(timestamp * 1000);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 获取当前日期字符串 */
function getTodayStr (): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** 战绩查询 */
export async function getRecord (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  const mode = parseMode(args) || 'sol';
  const page = parsePage(args);
  const modeName = mode === 'sol' ? '烽火地带' : '全面战场';
  const typeId = mode === 'sol' ? 4 : 5;

  await reply(msg, `正在查询 ${modeName} 第${page}页战绩...`);

  const res = await api.getRecord(token, typeId, page);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data || !Array.isArray((res as any).data)) {
    await reply(msg, '查询失败: 数据格式异常');
    return true;
  }

  const records = (res as any).data;
  if (records.length === 0) {
    await reply(msg, `${modeName} 第${page}页没有更多战绩记录`);
    return true;
  }

  // 构建模板数据
  const resPath = getStaticUrl() + '/';
  const templateData: RecordTemplateData = {
    modeName,
    page,
    records: [],
  };

  // 转换每条战绩记录（每页最多10条）
  const maxRecords = 10;
  for (let i = 0; i < Math.min(records.length, maxRecords); i++) {
    const r = records[i];
    const time = r.dtEventTime || formatDate(r.start_time || r.startTime || 0);
    const mapId = String(r.MapId || r.MapID || r.mapId || '');
    const mapName = dataManager.getMapName(mapId) || '未知地图';
    const mapBg = `${resPath}imgs/maps/${mapId}.png`;
    const operatorId = String(r.ArmedForceId || r.OperatorId || r.operatorId || '');
    const operatorName = dataManager.getOperatorName(operatorId) || '未知干员';

    if (mode === 'sol') {
      // 烽火地带
      const duration = formatDuration(Number(r.DurationS) || r.duration || 0);
      const escapeReason = String(r.EscapeFailReason || '10');
      const status = ESCAPE_REASONS[escapeReason] || '未知';
      let statusClass = 'fail';
      if (escapeReason === '1') statusClass = 'success';
      else if (escapeReason === '10') statusClass = 'exit';

      const killPlayer = r.KillCount || 0;
      const killPlayerAI = r.KillPlayerAICount || 0;
      const killAI = r.KillAICount || 0;
      const finalPrice = Number(r.FinalPrice || 0);

      // 计算净收益
      const enterPrice = Number(r.EnterPrice || 0);
      const income = finalPrice - enterPrice;
      const incomeStr = income >= 0 ? `+${income.toLocaleString()}` : income.toLocaleString();

      // 击杀明细 HTML
      const killsHtml = `<span class="kill-item kill-player">玩家 ${killPlayer}</span>` +
        `<span class="kill-separator">/</span>` +
        `<span class="kill-item kill-ai-player">人机 ${killPlayerAI}</span>` +
        `<span class="kill-separator">/</span>` +
        `<span class="kill-item kill-ai">AI ${killAI}</span>`;

      // 队友信息
      const teammates: any[] = [];
      if (r.Teammates && Array.isArray(r.Teammates)) {
        r.Teammates.forEach((t: any) => {
          const tOperator = dataManager.getOperatorName(String(t.ArmedForceId || t.OperatorId || '')) || '未知';
          const tEscapeReason = String(t.EscapeFailReason || '10');
          const tStatus = ESCAPE_REASONS[tEscapeReason] || '未知';
          let tStatusClass = 'fail';
          if (tEscapeReason === '1') tStatusClass = 'success';
          else if (tEscapeReason === '10') tStatusClass = 'exit';

          teammates.push({
            operator: tOperator,
            status: tStatus,
            statusClass: tStatusClass,
            value: Number(t.FinalPrice || 0).toLocaleString(),
            kills: `${t.KillCount || 0}/${t.KillPlayerAICount || 0}/${t.KillAICount || 0}`,
            duration: formatDuration(Number(t.DurationS) || 0),
            rescue: t.RescueNum || 0,
          });
        });
      }

      templateData.records.push({
        recordNum: (page - 1) * maxRecords + i + 1,
        time,
        map: mapName,
        operator: operatorName,
        mapBg,
        status,
        statusClass,
        duration,
        value: finalPrice.toLocaleString(),
        income: incomeStr,
        incomeClass: income >= 0 ? 'income-positive' : 'income-negative',
        killsHtml,
        teammates: teammates.slice(0, 2), // 最多显示2个队友，避免图片过大
      });
    } else {
      // 全面战场
      const duration = formatDuration(Number(r.gametime) || r.duration || 0);
      const matchResult = String(r.MatchResult || '2');
      const status = MP_RESULTS[matchResult] || '未知';
      let statusClass = 'fail';
      if (matchResult === '1') statusClass = 'success';
      else if (matchResult === '3') statusClass = 'exit';

      const kills = r.KillNum || 0;
      const deaths = r.Death || 0;
      const assists = r.Assist || 0;
      const score = Number(r.TotalScore || 0);
      const rescue = r.RescueNum || 0;

      templateData.records.push({
        recordNum: (page - 1) * maxRecords + i + 1,
        time,
        map: mapName,
        operator: operatorName,
        mapBg,
        status,
        statusClass,
        duration,
        kda: `${kills}/${deaths}/${assists}`,
        score: score.toLocaleString(),
        rescue,
      });
    }
  }

  // 生成 HTML 并渲染为图片
  const html = generateRecordHtml(templateData);

  logger.render(`[战绩] 准备渲染 ${templateData.records.length} 条记录`);

  const result = await render({
    template: html,
    selector: '.container',
    width: 620,
    fullPage: true, // 自动计算高度
    quality: 85, // 压缩质量
    waitForTimeout: 300,
  });

  if (result.success && result.data) {
    // replyImage 内部会自动添加 base64:// 前缀，这里只传原始数据
    await replyImage(msg, result.data);
  } else {
    // 渲染失败，回退到合并转发消息
    logger.warn(`[战绩] 图片渲染失败: ${result.error || '未知错误'}`);
    const messages: string[] = [];
    // 第一条消息：模式名称和页码信息
    messages.push(`【${modeName} 战绩】第${page}页`);
    // 每条记录作为单独的消息
    templateData.records.forEach((r, i) => {
      if (mode === 'sol') {
        messages.push(`${i + 1}. [${r.time}] ${r.map}\n${r.status} | 价值:${r.value} | 时长:${r.duration}`);
      } else {
        messages.push(`${i + 1}. [${r.time}] ${r.map}\n${r.status} | KDA:${r.kda} | 分数:${r.score} | 时长:${r.duration}`);
      }
    });
    await makeForwardMsg(msg, messages, { nickname: '战绩查询' });
  }

  return true;
}

/** 日报查询 */
export async function getDailyReport (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  const mode = parseMode(args);
  await reply(msg, '正在查询今日战报...');

  const res = await api.getDailyRecord(token, mode || undefined, getTodayStr());
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data) {
    await reply(msg, '暂无日报数据，不打两把吗？');
    return true;
  }

  // 解析数据
  const data = (res as any).data;
  let solDetail, mpDetail;

  if (mode) {
    const detail = data?.data?.data;
    if (mode === 'sol') solDetail = detail?.solDetail;
    else mpDetail = detail?.mpDetail;
  } else {
    solDetail = data?.sol?.data?.data?.solDetail;
    mpDetail = data?.mp?.data?.data?.mpDetail;
  }

  if (!solDetail && !mpDetail) {
    await reply(msg, '暂无日报数据，不打两把吗？');
    return true;
  }

  // 简化输出
  let text = '【今日战报】\n';

  if (solDetail) {
    text += '\n━━ 烽火地带 ━━\n';
    text += `局数: ${solDetail.total_round || 0}\n`;
    text += `撤离: ${solDetail.escape_count || 0} | 死亡: ${solDetail.death_count || 0}\n`;
    text += `击杀: ${solDetail.kill_human || 0} | 爆头: ${solDetail.headshot_kill || 0}\n`;
    text += `收入: ${solDetail.earn_money || 0}\n`;
  }

  if (mpDetail) {
    text += '\n━━ 全面战场 ━━\n';
    text += `局数: ${mpDetail.total_round || 0}\n`;
    text += `胜/负: ${mpDetail.win_count || 0}/${mpDetail.lose_count || 0}\n`;
    text += `击杀: ${mpDetail.kill_human || 0} | 死亡: ${mpDetail.death || 0}\n`;
  }

  await reply(msg, text.trim());
  return true;
}

/** 周报查询 */
export async function getWeeklyReport (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  const mode = parseMode(args);
  await reply(msg, '正在查询本周战报...');

  const res = await api.getWeeklyRecord(token, mode || undefined, true, '', true);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data) {
    await reply(msg, '暂无周报数据');
    return true;
  }

  const resData = (res as any).data;

  // 根据是否指定模式，数据结构不同
  let solData: any = null;
  let mpData: any = null;

  if (mode) {
    const detailData = resData?.data?.data;
    if (mode === 'sol') solData = detailData;
    else if (mode === 'mp') mpData = detailData;
  } else {
    solData = resData?.sol?.data?.data;
    mpData = resData?.mp?.data?.data;
  }

  const messages: string[] = [];

  // 烽火地带数据
  if (solData && solData.total_sol_num && Number(solData.total_sol_num) > 0) {
    const gainedPrice = Number(solData.Gained_Price) || 0;
    const consumePrice = Number(solData.consume_Price) || 0;
    const risePrice = Number(solData.rise_Price) || 0;
    let profitRatio = '0';
    if (gainedPrice > 0 && consumePrice > 0) profitRatio = (gainedPrice / consumePrice).toFixed(2);
    else if (gainedPrice > 0) profitRatio = '∞';

    let sol = `━━ 烽火地带 周报 ━━\n`;
    sol += `总局数: ${solData.total_sol_num || 0}\n`;
    sol += `撤离: ${solData.total_exacuation_num || 0} | 死亡: ${solData.total_Death_Count || 0}\n`;
    sol += `击杀玩家: ${solData.total_Kill_Player || 0} | 击杀AI: ${solData.total_Kill_AI || 0} | 击杀Boss: ${solData.total_Kill_Boss || 0}\n`;
    sol += `百万出金: ${solData.GainedPrice_overmillion_num || 0} 次\n`;
    sol += `总收入: ${gainedPrice.toLocaleString()} | 消耗: ${consumePrice.toLocaleString()}\n`;
    sol += `净利润: ${risePrice.toLocaleString()} | 赚损比: ${profitRatio}\n`;
    if (solData.total_Quest_num) sol += `任务完成: ${solData.total_Quest_num} 次\n`;
    if (solData.use_Keycard_num) sol += `使用钥匙卡: ${solData.use_Keycard_num} 次\n`;
    if (solData.Total_Mileage) sol += `总里程: ${(solData.Total_Mileage / 100000).toFixed(2)} km\n`;
    if (solData.total_Online_Time) {
      const h = Math.floor(solData.total_Online_Time / 3600);
      const m = Math.floor((solData.total_Online_Time % 3600) / 60);
      sol += `游戏时长: ${h}小时${m}分钟\n`;
    }
    if (solData.total_Rescue_num) sol += `救援次数: ${solData.total_Rescue_num}\n`;
    messages.push(sol.trim());

    // 高价值物资
    if (solData.CarryOut_highprice_list) {
      try {
        const items = solData.CarryOut_highprice_list.split('#').map((s: string) => {
          try { return JSON.parse(s.replace(/'/g, '"').replace(/([a-zA-Z0-9_]+):/g, '"$1":')); }
          catch { return null; }
        }).filter(Boolean).sort((a: any, b: any) => b.iPrice - a.iPrice);
        if (items.length > 0) {
          let itemText = '━━ 高价值物资 ━━\n';
          items.slice(0, 5).forEach((item: any, i: number) => {
            itemText += `${i + 1}. ${item.auctontype || '物品'} - ${Number(item.iPrice).toLocaleString()}\n`;
          });
          messages.push(itemText.trim());
        }
      } catch { /* ignore */ }
    }
  }

  // 全面战场数据
  if (mpData && mpData.total_num && Number(mpData.total_num) > 0) {
    const totalNum = Number(mpData.total_num) || 0;
    const winNum = Number(mpData.win_num) || 0;
    const winRate = totalNum > 0 ? ((winNum / totalNum) * 100).toFixed(1) + '%' : '0%';

    let mp = `━━ 全面战场 周报 ━━\n`;
    mp += `总局数: ${totalNum} | 胜率: ${winRate}\n`;
    mp += `胜: ${winNum} | 负: ${totalNum - winNum}\n`;
    mp += `击杀: ${mpData.Kill_Num || 0} | 连杀: ${mpData.continuous_Kill_Num || 0}\n`;
    mp += `总积分: ${Number(mpData.total_score || 0).toLocaleString()}\n`;
    if (mpData.Rescue_Teammate_Count) mp += `救援队友: ${mpData.Rescue_Teammate_Count}\n`;
    if (mpData.by_Rescue_num) mp += `被救援: ${mpData.by_Rescue_num}\n`;
    messages.push(mp.trim());
  }

  if (messages.length === 0) {
    await reply(msg, '暂无周报数据');
    return true;
  }

  messages.unshift('【本周战报】');
  await makeForwardMsg(msg, messages, { nickname: '周报查询' });
  return true;
}

/** 昨日收益 */
export async function getYesterdayProfit (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  // 获取昨日日期
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, '0');
  const day = String(yesterday.getDate()).padStart(2, '0');
  const yesterdayDate = `${year}${month}${day}`;

  await reply(msg, '正在查询昨日收益数据...');

  // 不传 mode 参数，查询全部数据
  const res = await api.getDailyRecord(token, '', yesterdayDate);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data) {
    await reply(msg, '暂无昨日数据');
    return true;
  }

  // 获取烽火地带数据（数据路径：res.data.sol.data.data.solDetail）
  const solDetail = (res as any).data?.sol?.data?.data?.solDetail;

  if (!solDetail || !solDetail.userCollectionTop || !solDetail.userCollectionTop.list) {
    await reply(msg, '暂无昨日收益数据，快去摸金吧！');
    return true;
  }

  const recentGain = solDetail.recentGain || 0;
  const gainDate = solDetail.recentGainDate || '昨日';
  const topItems = solDetail.userCollectionTop?.list || [];

  // 构建消息
  let text = `【昨日收益】烽火地带\n`;
  text += `日期: ${gainDate}\n`;
  text += `总收益: ${parseFloat(String(recentGain)).toLocaleString()} 金币\n`;

  if (topItems.length > 0) {
    text += `\n━━ 高价值物资 TOP${Math.min(topItems.length, 5)} ━━\n`;
    topItems.slice(0, 5).forEach((item: any, idx: number) => {
      const name = item.objectName || '未知物品';
      const price = parseFloat(item.price || 0).toLocaleString();
      const count = item.count || 1;
      text += `${idx + 1}. ${name} x${count} (${price})\n`;
    });
  }

  // 其他统计信息
  if (solDetail.totalFight || solDetail.totalEscape) {
    text += `\n━━ 战斗统计 ━━\n`;
    if (solDetail.totalFight) text += `总对局: ${solDetail.totalFight}\n`;
    if (solDetail.totalEscape) text += `撤离次数: ${solDetail.totalEscape}\n`;
    if (solDetail.totalKill) text += `击杀数: ${solDetail.totalKill}\n`;
    if (solDetail.totalGainedPrice) text += `获得物资: ${parseFloat(String(solDetail.totalGainedPrice)).toLocaleString()}\n`;
  }

  await reply(msg, text.trim());
  return true;
}

export default { commands, getRecord, getDailyReport, getWeeklyReport, getYesterdayProfit };
