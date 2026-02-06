/**
 * 格式化工具函数
 */

/**
 * 格式化时长
 * @param value 时长值
 * @param unit 单位 'seconds' | 'minutes'
 * @returns 格式化后的字符串
 */
export function formatDuration (value: number | string | undefined, unit: 'seconds' | 'minutes' = 'seconds'): string {
  const numValue = parseInt(String(value), 10);
  if (isNaN(numValue) || numValue < 0) return '-';
  if (numValue === 0) return '0分钟';

  let totalMinutes = unit === 'seconds' ? Math.floor(numValue / 60) : numValue;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  }
  return `${minutes}分钟`;
}

/**
 * 格式化日期时间
 * @param timestamp 时间戳 (秒或毫秒)
 * @param format 格式类型
 * @returns 格式化后的字符串
 */
export function formatDate (
  timestamp: number | string | undefined,
  format: 'full' | 'date' | 'time' | 'relative' = 'full'
): string {
  if (!timestamp) return '未知';

  let ts = Number(timestamp);
  if (isNaN(ts)) return '未知';

  // 判断是秒还是毫秒时间戳
  if (ts < 10000000000) {
    ts = ts * 1000;
  }

  try {
    const date = new Date(ts);
    if (isNaN(date.getTime())) return '未知';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    switch (format) {
      case 'date':
        return `${year}-${month}-${day}`;
      case 'time':
        return `${hours}:${minutes}:${seconds}`;
      case 'relative':
        return getRelativeTime(date);
      case 'full':
      default:
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
  } catch {
    return '未知';
  }
}

/**
 * 获取相对时间
 * @param date 日期对象
 * @returns 相对时间字符串
 */
function getRelativeTime (date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 30) return `${days}天前`;

  return formatDate(date.getTime(), 'date');
}

/**
 * 格式化数字 (添加千分位)
 * @param num 数字
 * @returns 格式化后的字符串
 */
export function formatNumber (num: number | string | undefined): string {
  if (num === undefined || num === null) return '-';
  const n = Number(num);
  if (isNaN(n)) return String(num);
  return n.toLocaleString();
}

/**
 * 格式化百分比
 * @param value 百分比值 (可以是小数或已经是百分比)
 * @param decimals 小数位数
 * @returns 格式化后的字符串
 */
export function formatPercent (value: number | string | undefined, decimals: number = 1): string {
  if (value === undefined || value === null) return '-';

  let num = Number(value);
  if (isNaN(num)) return String(value);

  // 如果是小数形式，转换为百分比
  if (num > 0 && num < 1) {
    num = num * 100;
  }

  return `${num.toFixed(decimals)}%`;
}

/**
 * 格式化金额 (游戏内货币)
 * @param amount 金额
 * @param unit 单位 (默认自动选择)
 * @returns 格式化后的字符串
 */
export function formatMoney (amount: number | string | undefined, unit?: 'K' | 'M' | 'auto'): string {
  if (amount === undefined || amount === null) return '-';

  const num = Number(amount);
  if (isNaN(num)) return String(amount);

  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  if (unit === 'K' || (unit === 'auto' && absNum >= 1000 && absNum < 1000000)) {
    return `${sign}${(absNum / 1000).toFixed(1)}K`;
  }

  if (unit === 'M' || (unit === 'auto' && absNum >= 1000000)) {
    return `${sign}${(absNum / 1000000).toFixed(2)}M`;
  }

  return formatNumber(num);
}

/**
 * URL 解码
 * @param str 编码字符串
 * @returns 解码后的字符串
 */
export function decodeUrl (str: string | undefined): string {
  if (!str) return '';
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

/**
 * 截断字符串
 * @param str 原字符串
 * @param maxLength 最大长度
 * @param suffix 后缀 (默认 '...')
 * @returns 截断后的字符串
 */
export function truncate (str: string | undefined, maxLength: number, suffix: string = '...'): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * 生成 QQ 头像 URL
 * @param qq QQ 号
 * @param size 尺寸 (640 | 100 | 40)
 * @returns 头像 URL
 */
export function getQQAvatarUrl (qq: string | number, size: number = 640): string {
  return `http://q.qlogo.cn/headimg_dl?dst_uin=${qq}&spec=${size}&img_type=jpg`;
}

/**
 * 生成游戏头像 URL
 * @param picUrl 头像 ID 或 URL
 * @returns 完整头像 URL
 */
export function getGameAvatarUrl (picUrl: string | undefined): string {
  if (!picUrl) return '';

  // 如果已经是 URL，直接返回
  if (picUrl.startsWith('http')) return picUrl;

  // 如果是纯数字 ID，拼接 CDN 地址
  if (/^\d+$/.test(picUrl)) {
    return `https://wegame.gtimg.com/g.2001918-r.ea725/helper/df/skin/${picUrl}.webp`;
  }

  return picUrl;
}

export default {
  formatDuration,
  formatDate,
  formatNumber,
  formatPercent,
  formatMoney,
  decodeUrl,
  truncate,
  getQQAvatarUrl,
  getGameAvatarUrl,
};
