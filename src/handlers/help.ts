/**
 * 帮助系统处理器
 * 使用 Puppeteer 渲染帮助图片，界面与原版一致
 */

import type { OB11Message } from 'napcat-types';
import fs from 'node:fs';
import path from 'node:path';
import { reply, replyImage, makeForwardMsg } from '../utils/message';
import { getPrefixes } from '../utils/command';
import { render } from '../services/render';
import { pluginState } from '../core/state';
import { logger } from '../utils/logger';
import type { CommandDef } from '../utils/command';

/** 命令定义 */
export const commands: CommandDef[] = [
  { keywords: ['帮助', '菜单', '功能', 'help'], handler: 'help', name: '帮助菜单' },
];

/** 帮助项 */
interface HelpItem {
  icon: number | string;
  title: string;
  desc: string;
}

/** 帮助分组 */
interface HelpGroup {
  group: string;
  list: HelpItem[];
  order?: number;
}

/** 帮助配置 */
interface HelpConfig {
  title: string;
  subTitle: string;
  colWidth: number;
  colCount: number;
  twoColumnLayout: boolean;
  // 样式配置
  fontColor: string;
  descColor: string;
  contBgColor: string;
  contBgBlur: number;
  headerBgColor: string;
  rowBgColor1: string;
  rowBgColor2: string;
  cellBgColor: string;
  footerText: string;
  titleFontSize: string;
  groupFontSize: string;
  commandFontSize: string;
  descFontSize: string;
}

/** 获取帮助配置 - 从保存的配置中读取 */
function getHelpConfig (): HelpConfig {
  const config = pluginState.getConfig();
  const style = config.help_style || {};

  return {
    title: style.title || '三角洲行动 帮助',
    subTitle: style.subTitle || 'DeltaForce-Plugin HELP',
    colWidth: 420,
    colCount: 2,
    twoColumnLayout: true,
    // 样式配置
    fontColor: style.fontColor || '#ceb78b',
    descColor: style.descColor || '#eee',
    contBgColor: style.contBgColor || 'rgba(43, 52, 61, 0.8)',
    contBgBlur: style.contBgBlur ?? 3,
    headerBgColor: style.headerBgColor || 'rgba(34, 41, 51, .4)',
    rowBgColor1: style.rowBgColor1 || 'rgba(34, 41, 51, .2)',
    rowBgColor2: style.rowBgColor2 || 'rgba(34, 41, 51, .4)',
    cellBgColor: style.cellBgColor || 'rgba(34, 41, 51, .35)',
    footerText: style.footerText || '',
    titleFontSize: style.titleFontSize || '50px',
    groupFontSize: style.groupFontSize || '18px',
    commandFontSize: style.commandFontSize || '16px',
    descFontSize: style.descFontSize || '13px',
  };
}

/** 获取帮助列表 - 优先使用保存的配置，否则使用默认列表 */
function getHelpList (): { left: HelpGroup[]; right: HelpGroup[]; fullWidth: HelpGroup[]; } {
  const config = pluginState.getConfig();

  // 如果有保存的自定义帮助列表，直接使用
  if (config.help_list && (config.help_list.left || config.help_list.right || config.help_list.fullWidth)) {
    return {
      fullWidth: config.help_list.fullWidth || [],
      left: config.help_list.left || [],
      right: config.help_list.right || [],
    };
  }

  // 否则返回默认列表
  return getDefaultHelpList();
}

/** 获取默认帮助列表 */
function getDefaultHelpList (): { left: HelpGroup[]; right: HelpGroup[]; fullWidth: HelpGroup[]; } {
  const prefix = getPrefixes()[0] || '^';

  return {
    fullWidth: [
      {
        order: 1,
        group: `所有命令统一使用 ${prefix} 前缀，例如 ${prefix}帮助`,
        list: [],
      },
    ],
    left: [
      {
        order: 1,
        group: '账号相关',
        list: [
          { icon: 80, title: `${prefix}账号`, desc: '查看已绑定token列表' },
          { icon: 71, title: `${prefix}账号切换 [序号]`, desc: '激活指定序号账号' },
          { icon: 86, title: `${prefix}绑定 [token]`, desc: '绑定token' },
          { icon: 48, title: `${prefix}解绑 [序号]`, desc: '解绑指定序号token' },
          { icon: 47, title: `${prefix}删除 [序号]`, desc: '删除QQ/微信登录数据' },
          { icon: 49, title: `${prefix}(微信/QQ)刷新`, desc: '刷新微信/QQ token' },
          { icon: 64, title: `${prefix}(QQ/微信)登陆`, desc: '通过QQ/微信扫码登录' },
          { icon: 62, title: `${prefix}(WeGame/wegame微信)登陆`, desc: '登录WeGame（QQ/微信扫码）' },
          { icon: 61, title: `${prefix}安全中心登陆`, desc: '通过安全中心扫码登录' },
          { icon: 71, title: `${prefix}(QQ/微信)授权登陆 [code]`, desc: '通过授权码登录' },
          { icon: 52, title: `${prefix}网页登陆`, desc: '通过网页方式登录' },
          { icon: 80, title: `${prefix}ck登陆 [cookies]`, desc: '通过cookie登录' },
          { icon: 78, title: `${prefix}信息`, desc: '查询个人详细信息' },
          { icon: 71, title: `${prefix}UID`, desc: '查询个人UID' },
        ],
      },
      {
        order: 2,
        group: '游戏数据',
        list: [
          { icon: 41, title: `${prefix}藏品 [类型]`, desc: '查询个人仓库中的皮肤、饰品等' },
          { icon: 48, title: `${prefix}货币`, desc: '查询游戏内货币信息' },
          { icon: 55, title: `${prefix}数据 [模式] [赛季]`, desc: '查询个人统计数据' },
          { icon: 66, title: `${prefix}战绩 [模式] [页码]`, desc: '查询战绩（全面/烽火）' },
          { icon: 78, title: `${prefix}地图统计 [模式] [赛季/地图名]`, desc: '查询地图统计数据' },
          { icon: 53, title: `${prefix}流水 [类型/all] [页码/all]`, desc: '查询交易流水' },
          { icon: 79, title: `${prefix}出红记录 [物品名]`, desc: '查询藏品解锁记录' },
          { icon: 42, title: `${prefix}昨日收益 [模式]`, desc: '查询昨日收益和物资统计' },
        ],
      },
      {
        order: 3,
        group: '价格/利润查询',
        list: [
          { icon: 61, title: `${prefix}价格历史 | ${prefix}当前价格 [物品名/ID]`, desc: '查询物品历史/当前价格' },
          { icon: 61, title: `${prefix}材料价格 [物品ID]`, desc: '查询制造材料最低价格' },
          { icon: 61, title: `${prefix}利润历史 [物品名/ID/场所]`, desc: '查询制造利润历史记录' },
          { icon: 61, title: `${prefix}利润排行 [类型] [场所] [数量]`, desc: '查询利润排行榜V1' },
          { icon: 61, title: `${prefix}最高利润 [类型] [场所] [物品ID]`, desc: '查询最高利润排行榜V2' },
          { icon: 62, title: `${prefix}特勤处利润 [类型]`, desc: '查询特勤处四个场所利润TOP3' },
        ],
      },
      {
        order: 4,
        group: '语音播放',
        list: [
          { icon: 87, title: `${prefix}语音`, desc: '随机播放语音' },
          { icon: 87, title: `${prefix}语音 [角色名/标签]`, desc: '播放指定角色/标签语音' },
          { icon: 87, title: `${prefix}语音 [角色] [场景]`, desc: '播放指定场景语音' },
          { icon: 87, title: `${prefix}语音 [角色] [场景] [动作]`, desc: '播放指定动作语音' },
          { icon: 78, title: `${prefix}语音列表 | ${prefix}语音分类`, desc: '查看可用角色/分类信息' },
          { icon: 79, title: `${prefix}标签列表 | ${prefix}语音统计`, desc: '查看特殊标签/音频统计' },
        ],
      },
      {
        order: 5,
        group: '鼠鼠音乐',
        list: [
          { icon: 87, title: `${prefix}鼠鼠音乐 [关键词]`, desc: '随机播放/搜索播放音乐' },
          { icon: 88, title: `${prefix}鼠鼠音乐列表 [页码]`, desc: '查看热度排行榜' },
          { icon: 98, title: `${prefix}鼠鼠语音`, desc: '播放鼠鼠语音' },
          { icon: 89, title: `${prefix}鼠鼠歌单 [名称]`, desc: '查看指定歌单' },
          { icon: 90, title: `${prefix}点歌 [序号]`, desc: '播放列表中的歌曲' },
          { icon: 45, title: `${prefix}歌词`, desc: '查看鼠鼠音乐歌词' },
        ],
      },
    ],
    right: [
      {
        order: 1,
        group: '战报与推送',
        list: [
          { icon: 86, title: `${prefix}日报 [模式]`, desc: '查询日报数据（全面/烽火）' },
          { icon: 86, title: `${prefix}周报 [模式] [日期] [展示]`, desc: '查询每周战报' },
          { icon: 46, title: `${prefix}每日密码`, desc: '查询今日密码' },
          { icon: 86, title: `${prefix}开启/关闭日报推送`, desc: '在本群开启/关闭日报推送' },
          { icon: 37, title: `${prefix}开启/关闭周报推送`, desc: '在本群开启/关闭周报推送' },
          { icon: 86, title: `${prefix}开启/关闭每日密码推送`, desc: '开启/关闭每日密码推送' },
          { icon: 86, title: `${prefix}开启/关闭特勤处推送`, desc: '开启/关闭特勤处制造完成推送' },
          { icon: 86, title: `${prefix}订阅 战绩 [模式]`, desc: '订阅战绩（sol/mp/both）' },
          { icon: 80, title: `${prefix}取消订阅 战绩`, desc: '取消战绩订阅' },
          { icon: 78, title: `${prefix}订阅状态 战绩`, desc: '查看订阅和推送状态' },
          { icon: 61, title: `${prefix}开启/关闭私信订阅推送 战绩 [筛选]`, desc: '开启/关闭私信推送' },
          { icon: 61, title: `${prefix}开启/关闭本群订阅推送 战绩 [筛选]`, desc: '开启/关闭本群推送' },
          { icon: 79, title: '筛选条件', desc: '百万撤离/百万战损/天才少年' },
        ],
      },
      {
        order: 2,
        group: '社区改枪码',
        list: [
          { icon: 86, title: `${prefix}改枪码上传 [改枪码] [描述] [模式] [是否公开] [配件信息]`, desc: '上传改枪方案' },
          { icon: 86, title: `${prefix}改枪码列表 [武器名]`, desc: '查询改枪方案列表' },
          { icon: 86, title: `${prefix}改枪码详情 [方案ID]`, desc: '查询改枪方案详情' },
          { icon: 86, title: `${prefix}改枪码点赞 | ${prefix}改枪码点踩 [方案ID]`, desc: '点赞/点踩改枪方案' },
          { icon: 86, title: `${prefix}改枪码收藏 | ${prefix}改枪码取消收藏 [方案ID]`, desc: '收藏/取消收藏改枪方案' },
          { icon: 86, title: `${prefix}改枪码收藏列表`, desc: '查看已收藏的改枪方案' },
          { icon: 86, title: `${prefix}改枪码更新 | ${prefix}改枪码删除 [方案ID] [参数]`, desc: '更新/删除已上传的改枪方案' },
          { icon: 78, title: '网站上传修改', desc: 'https://df.shallow.ink/solutions' },
        ],
      },
      {
        order: 3,
        group: '实用工具',
        list: [
          { icon: 61, title: `${prefix}ai锐评 [模式]`, desc: '使用AI锐评烽火地带和全面战场数据' },
          { icon: 61, title: `${prefix}ai评价 [模式] [预设] [音色]`, desc: '使用其他AI预设来评价战绩' },
          { icon: 78, title: `${prefix}ai预设列表`, desc: '查看所有可用的AI评价预设' },
          { icon: 41, title: `${prefix}违规记录`, desc: '登录QQ安全中心后可查询历史违规' },
          { icon: 48, title: `${prefix}特勤处状态`, desc: '查询特勤处制造状态' },
          { icon: 71, title: `${prefix}特勤处信息 [场所]`, desc: '查询特勤处设施升级信息' },
          { icon: 86, title: `${prefix}物品搜索 [名称/ID]`, desc: '搜索游戏内物品' },
          { icon: 48, title: `${prefix}大红收藏 [赛季数字]`, desc: '生成大红收集海报' },
          { icon: 40, title: `${prefix}文章列表 | ${prefix}文章详情 [ID]`, desc: '查看文章列表/详情' },
          { icon: 71, title: `${prefix}健康状态`, desc: '查询游戏健康状态信息' },
          { icon: 78, title: `${prefix}干员 [名称]`, desc: '查询干员详细信息' },
          { icon: 78, title: `${prefix}干员列表`, desc: '查询所有干员列表（按兵种分组）' },
        ],
      },
      {
        order: 4,
        group: 'TTS语音合成',
        list: [
          { icon: 87, title: `${prefix}tts [角色] [情感] 文本`, desc: '合成并发送语音' },
          { icon: 87, title: `${prefix}tts 麦晓雯 开心 你好呀！`, desc: '示例：使用指定角色和情感' },
          { icon: 78, title: `${prefix}tts状态`, desc: '查看TTS服务状态' },
          { icon: 78, title: `${prefix}tts角色列表`, desc: '查看所有可用的角色预设' },
          { icon: 78, title: `${prefix}tts角色详情 [角色ID]`, desc: '查看指定角色的详细信息' },
          { icon: 64, title: `${prefix}tts上传`, desc: '上传上次合成的语音文件' },
        ],
      },
    ],
  };
}

/** 计算图标 CSS */
/** 获取图标 CSS（精灵图） */
function getIconCss (icon: number): string {
  if (!icon) return 'display:none';
  const x = (icon - 1) % 10;
  const y = Math.floor((icon - 1) / 10);
  return `background-position:-${x * 50}px -${y * 50}px`;
}

/** 将背景色的 alpha 值乘以透明度系数 */
function applyAlpha (colorStr: string, opacity: number): string {
  if (!colorStr || isNaN(opacity)) return colorStr;
  const rgbaM = colorStr.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
  if (rgbaM) {
    return `rgba(${rgbaM[1]}, ${rgbaM[2]}, ${rgbaM[3]}, ${(parseFloat(rgbaM[4]) * opacity).toFixed(2)})`;
  }
  const rgbM = colorStr.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgbM) {
    return `rgba(${rgbM[1]}, ${rgbM[2]}, ${rgbM[3]}, ${opacity})`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(colorStr)) {
    const r = parseInt(colorStr.slice(1, 3), 16);
    const g = parseInt(colorStr.slice(3, 5), 16);
    const b = parseInt(colorStr.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return colorStr;
}

/** 判断是否为自定义图标 */
function isCustomIcon (icon: number | string): icon is string {
  return typeof icon === 'string' && icon.startsWith('custom:');
}

/** 获取自定义图标 URL */
function getCustomIconUrl (icon: string): string {
  const name = icon.slice(7);
  return `${getApiUrlPrefix()}/help/custom-icon-file?name=${encodeURIComponent(name)}`;
}

/** 生成分组 HTML */
function generateGroupHtml (group: HelpGroup, colCount: number): string {
  let html = '<div class="cont-box">';
  html += `<div class="help-group">${group.group}</div>`;

  if (group.list && group.list.length > 0) {
    html += '<div class="help-table"><div class="tr">';

    group.list.forEach((item, idx) => {
      let iconStyle: string;
      if (isCustomIcon(item.icon)) {
        iconStyle = `background-image: url("${getCustomIconUrl(item.icon)}"); background-size: contain; background-position: center; background-repeat: no-repeat;`;
      } else {
        iconStyle = getIconCss(item.icon as number);
      }
      html += `
        <div class="td">
          <span class="help-icon" style="${iconStyle}"></span>
          <strong class="help-title">${item.title}</strong>
          <span class="help-desc">${item.desc}</span>
        </div>
      `;

      const isRowEnd = (idx + 1) % colCount === 0;
      const isNotLast = idx < group.list.length - 1;
      if (isRowEnd && isNotLast) {
        html += '</div><div class="tr">';
      }
    });

    const padding = (colCount - (group.list.length % colCount)) % colCount;
    for (let i = 0; i < padding; i++) {
      html += '<div class="td"></div>';
    }

    html += '</div></div>';
  }

  html += '</div>';
  return html;
}

/** 获取静态资源 URL 前缀 */
function getStaticUrlPrefix (): string {
  // 静态资源通过 /plugin/{pluginId}/files/static/ 访问
  return `http://127.0.0.1:6099/plugin/${pluginState.pluginName}/files/static`;
}

/** 获取 API 路由 URL 前缀（无认证） */
function getApiUrlPrefix (): string {
  return `http://127.0.0.1:6099/plugin/${pluginState.pluginName}/api`;
}

/** 帮助图片缓存 */
let helpImageCache: { data: string; timestamp: number; } | null = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 1天

/** 清除帮助图片缓存（配置更新时调用） */
export function clearHelpCache (): void {
  helpImageCache = null;
  logger.debug('帮助图片缓存已清除');
}

/** 生成完整帮助 HTML */
function generateHelpHtml (): string {
  const config = getHelpConfig();
  const helpList = getHelpList();

  // 使用 HTTP 静态资源服务
  const staticPrefix = getStaticUrlPrefix();

  const sidePadding = 30;
  const columnGap = 20;
  const tableWidth = config.colCount * config.colWidth;
  const width = config.twoColumnLayout
    ? tableWidth * 2 + columnGap + sidePadding
    : config.colCount * config.colWidth + sidePadding;

  // 资源路径 - 检查自定义图片是否存在（保存在 dataPath/custom-images/）
  const customImgDir = path.join(pluginState.dataPath, 'custom-images');
  const hasCustomBg = fs.existsSync(path.join(customImgDir, 'bg.jpg'));
  const hasCustomIcon = fs.existsSync(path.join(customImgDir, 'icon.png'));
  const apiPrefix = getApiUrlPrefix();

  const bgPath = hasCustomBg
    ? `${apiPrefix}/help/custom-image?type=bg`
    : `${staticPrefix}/help/imgs/default/bg.jpg`;
  const iconPath = hasCustomIcon
    ? `${apiPrefix}/help/custom-image?type=icon`
    : `${staticPrefix}/help/imgs/default/icon.png`;
  const fontPath = `${staticPrefix}/fonts`;

  let html = `<!DOCTYPE html>
<html lang="zh-cn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <style>
    @font-face {
      font-family: 'ProjectD';
      src: url("${fontPath}/p-med.ttf") format('truetype');
      font-weight: 400;
    }
    @font-face {
      font-family: 'ProjectD';
      src: url("${fontPath}/p-bold.ttf") format('truetype');
      font-weight: 700;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      -webkit-user-select: none;
      user-select: none;
    }
    body {
      font-size: 18px;
      color: #1e1f20;
      font-family: 'ProjectD', "Microsoft YaHei", "PingFang SC", sans-serif;
      transform: scale(1);
      transform-origin: 0 0;
      width: ${width}px;
      background-image: url("${bgPath}");
      background-repeat: no-repeat;
      background-size: cover;
    }
    #container {
      width: ${width}px;
      padding: 20px 15px 10px 15px;
      background-size: contain;
    }
    .head-box {
      border-radius: 15px;
      padding: 10px 20px;
      position: relative;
      color: ${config.fontColor};
      margin: 60px 0 0 0;
      padding-bottom: 0;
    }
    .head-box .title {
      font-family: 'ProjectD', "Microsoft YaHei", "PingFang SC", sans-serif;
      font-weight: 700;
      font-size: ${config.titleFontSize};
      text-shadow: 0 0 1px #000, 1px 1px 3px rgba(0, 0, 0, 0.9);
    }
    .head-box .label {
      font-size: 16px;
      text-shadow: 0 0 1px #000, 1px 1px 3px rgba(0, 0, 0, 0.9);
    }
    .cont-box {
      border-radius: 15px;
      margin-top: 20px;
      margin-bottom: 20px;
      overflow: hidden;
      box-shadow: 0 5px 10px 0 rgba(0, 0, 0, 0.15);
      position: relative;
      background: ${config.contBgColor};
      backdrop-filter: blur(${config.contBgBlur}px);
    }
    .help-group {
      font-size: ${config.groupFontSize};
      font-weight: bold;
      padding: 15px 15px 10px 20px;
      color: ${config.fontColor};
      background: ${config.headerBgColor};
    }
    .help-table {
      text-align: center;
      border-collapse: collapse;
      margin: 0;
      border-radius: 0 0 10px 10px;
      display: table;
      overflow: hidden;
      width: 100%;
      color: #fff;
    }
    .help-table .tr {
      display: table-row;
    }
    .help-table .tr:nth-child(odd) {
      background: ${config.rowBgColor1};
    }
    .help-table .tr:nth-child(even) {
      background: ${config.rowBgColor2};
    }
    .help-table .td, .help-table .th {
      font-size: 14px;
      display: table-cell;
      box-shadow: 0 0 1px 0 #888 inset;
      padding: 12px 0 12px 50px;
      line-height: 24px;
      position: relative;
      text-align: left;
      width: ${100 / config.colCount}%;
      background: ${config.cellBgColor};
    }
    .help-icon {
      width: 40px;
      height: 40px;
      display: block;
      position: absolute;
      border-radius: 5px;
      left: 6px;
      top: 12px;
      transform: scale(0.85);
      background-image: url("${iconPath}");
      background-size: 500px auto;
    }
    .help-title {
      display: block;
      color: ${config.fontColor};
      font-size: ${config.commandFontSize};
      line-height: 24px;
    }
    .help-desc {
      display: block;
      font-size: ${config.descFontSize};
      line-height: 18px;
      color: ${config.descColor};
    }
    .copyright {
      font-size: 14px;
      text-align: center;
      color: #fff;
      position: relative;
      padding-left: 10px;
      text-shadow: 1px 1px 1px #000;
      margin: 10px 0;
    }
    .help-content-wrapper {
      display: flex;
      gap: ${columnGap}px;
      width: 100%;
    }
    .help-column {
      flex: 1;
      min-width: 0;
    }
    .help-column .cont-box {
      width: 100%;
    }
  </style>
</head>
<body>
  <div id="container">
    <div class="info-box">
      <div class="head-box">
        <div class="title">${config.title}</div>
        <div class="label">${config.subTitle}</div>
      </div>
    </div>
`;

  // 生成顶部全宽分组
  for (const group of helpList.fullWidth.filter(g => (g.order || 999) < 50)) {
    html += generateGroupHtml(group, config.colCount * 2);
  }

  // 两列布局
  html += '<div class="help-content-wrapper">';

  html += '<div class="help-column">';
  for (const group of helpList.left.sort((a, b) => (a.order || 999) - (b.order || 999))) {
    html += generateGroupHtml(group, config.colCount);
  }
  html += '</div>';

  html += '<div class="help-column">';
  for (const group of helpList.right.sort((a, b) => (a.order || 999) - (b.order || 999))) {
    html += generateGroupHtml(group, config.colCount);
  }
  html += '</div>';

  html += '</div>';

  for (const group of helpList.fullWidth.filter(g => (g.order || 999) >= 50)) {
    html += generateGroupHtml(group, config.colCount * 2);
  }

  const footerContent = config.footerText || 'Created By Lengxi & Napcat-plugin-Delta-Force';
  html += `
    <div class="copyright">
      ${footerContent}
    </div>
  </div>
</body>
</html>`;

  return html;
}

/** 帮助命令 */
export async function help (msg: OB11Message): Promise<boolean> {
  try {
    // 检查缓存是否有效
    const now = Date.now();
    if (helpImageCache && (now - helpImageCache.timestamp) < CACHE_DURATION) {
      await replyImage(msg, helpImageCache.data);
      return true;
    }

    // 生成帮助图片
    const htmlContent = generateHelpHtml();

    const result = await render({
      template: htmlContent,
      data: {},
      selector: '#container',
      width: 1800,
      height: 800,
      fullPage: false,
      waitForTimeout: 300,
    });

    if (result.success && result.data) {
      // 更新缓存
      helpImageCache = { data: result.data, timestamp: now };
      await replyImage(msg, result.data);
    } else {
      logger.error('帮助渲染失败:', result.error);
      await sendTextHelp(msg);
    }
  } catch (error) {
    logger.error('帮助渲染异常:', error);
    await sendTextHelp(msg);
  }

  return true;
}

/** 文本版帮助（降级方案） */
async function sendTextHelp (msg: OB11Message): Promise<void> {
  const prefix = getPrefixes()[0] || '三角洲';
  const messages: string[] = [];

  messages.push(`🎮 三角洲行动 - 帮助菜单`);

  messages.push(`📋 账号管理\n${prefix}登录 - 扫码登录\n${prefix}账号 - 账号列表\n${prefix}账号切换 <序号> - 切换账号\n${prefix}信息 - 个人信息\n${prefix}uid - 查询UID`);

  messages.push(`📊 数据查询\n${prefix}数据 [模式] - 数据统计\n${prefix}货币 - 货币查询\n${prefix}战绩 [模式] - 战绩查询`);

  messages.push(`📰 战报推送\n${prefix}日报 - 日报查询\n${prefix}周报 - 周报查询\n${prefix}每日密码 - 今日密码`);

  messages.push(`🔧 实用工具\n${prefix}ai锐评 - AI评价\n${prefix}特勤处状态 - 特勤处查询\n${prefix}干员 <名称> - 干员查询`);

  messages.push(`🎵 娱乐功能\n${prefix}语音 [角色名] - 播放语音\n${prefix}鼠鼠音乐 - 播放音乐\n${prefix}tts [角色] [情感] 文本 - TTS语音`);

  messages.push(`插件反馈群：1085402468 | API交流群：932459332`);

  await makeForwardMsg(msg, messages, { nickname: '帮助菜单' });
}

export default {
  commands,
  help,
};
