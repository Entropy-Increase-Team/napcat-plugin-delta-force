/**
 * 数据管理服务
 * 管理游戏数据缓存：地图、干员、段位、计算器数据等
 */

import { pluginState } from '../core/state';
import { createApi } from '../core/api';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/** 数据缓存 */
interface DataCache {
  /** 地图数据: id => name */
  maps: Map<string, string>;
  /** 干员数据: id => name */
  operators: Map<string, string>;
  /** 烽火段位数据: score => name */
  rankScoreSol: Record<string, string>;
  /** 全面段位数据: score => name */
  rankScoreTdm: Record<string, string>;
  backgrounds: string[];
  lastUpdate: number;
  // 计算器数据
  weaponsSol: any;
  weaponsMp: any;
  armors: any;
  bullets: any;
  equipment: any;
  battlefieldWeapons: any;
  meleeWeapons: any;
}

/** 缓存有效期 (1小时) */
const CACHE_TTL = 3600000;

/** 数据管理器类 */
class DataManager {
  private cache: DataCache = {
    maps: new Map(),
    operators: new Map(),
    rankScoreSol: {},
    rankScoreTdm: {},
    backgrounds: [],
    lastUpdate: 0,
    // 计算器数据
    weaponsSol: null,
    weaponsMp: null,
    armors: null,
    bullets: null,
    equipment: null,
    battlefieldWeapons: null,
    meleeWeapons: null,
  };

  private initialized = false;

  /** 初始化数据管理器 */
  async init (): Promise<void> {
    if (this.initialized) return;

    try {
      // 加载本地缓存
      this.loadLocalCache();

      // 加载计算器 JSON 数据
      this.loadCalculatorData();

      // 尝试从 API 更新数据
      await this.refreshFromApi();

      // 加载背景图片列表
      this.loadBackgrounds();

      this.initialized = true;
      pluginState.log('info', '数据管理器初始化完成');
    } catch (error) {
      pluginState.log('error', '数据管理器初始化失败:', error);
    }
  }

  /** 加载计算器 JSON 数据 */
  private loadCalculatorData (): void {
    const dataDir = path.join(pluginState.pluginPath, 'resources', 'data');

    const loadJson = (filename: string): any => {
      try {
        const filePath = path.join(dataDir, filename);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          return JSON.parse(content);
        }
      } catch (error) {
        pluginState.log('warn', `加载 ${filename} 失败:`, error);
      }
      return null;
    };

    this.cache.weaponsSol = loadJson('weapons_sol.json');
    this.cache.weaponsMp = loadJson('weapons_mp.json');
    this.cache.armors = loadJson('armors.json');
    this.cache.bullets = loadJson('bullets.json');
    this.cache.equipment = loadJson('equipment.json');
    this.cache.battlefieldWeapons = loadJson('battlefield_weapons.json');
    this.cache.meleeWeapons = loadJson('melee_weapons.json');

    const loadedCount = [
      this.cache.weaponsSol,
      this.cache.weaponsMp,
      this.cache.armors,
      this.cache.bullets,
      this.cache.equipment,
      this.cache.battlefieldWeapons,
      this.cache.meleeWeapons,
    ].filter(Boolean).length;

    pluginState.logDebug(`计算器数据加载完成: ${loadedCount}/7 个文件`);
  }

  /** 从 YAML 文件加载 Map 数据（支持数组和对象格式） */
  private loadYamlMap (filePath: string, target: Map<string, string>): void {
    if (!fs.existsSync(filePath)) return;
    const data = YAML.parse(fs.readFileSync(filePath, 'utf-8'));
    target.clear();
    if (!data) return;
    const entries = Array.isArray(data) ? data : Object.entries(data);
    for (const [id, name] of entries) {
      target.set(String(id), String(name));
    }
  }

  /** 加载本地缓存 */
  private loadLocalCache (): void {
    const dataDir = path.join(pluginState.dataPath, 'cache');
    try {
      this.loadYamlMap(path.join(dataDir, 'maps.yaml'), this.cache.maps);
      this.loadYamlMap(path.join(dataDir, 'operators.yaml'), this.cache.operators);

      const rankFile = path.join(dataDir, 'rankscore.yaml');
      if (fs.existsSync(rankFile)) {
        const rankData = YAML.parse(fs.readFileSync(rankFile, 'utf-8'));
        if (rankData?.sol && typeof rankData.sol === 'object') this.cache.rankScoreSol = rankData.sol;
        if (rankData?.tdm && typeof rankData.tdm === 'object') this.cache.rankScoreTdm = rankData.tdm;
      }

      pluginState.logDebug('本地缓存加载完成');
    } catch (error) {
      pluginState.log('warn', '加载本地缓存失败:', error);
    }
  }

  /** 保存本地缓存 */
  private saveLocalCache (): void {
    const dataDir = path.join(pluginState.dataPath, 'cache');

    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // 保存地图数据 (转换为对象格式)
      const mapsData = Object.fromEntries(this.cache.maps);
      fs.writeFileSync(path.join(dataDir, 'maps.yaml'), YAML.stringify(mapsData));

      // 保存干员数据 (转换为对象格式)
      const operatorsData = Object.fromEntries(this.cache.operators);
      fs.writeFileSync(path.join(dataDir, 'operators.yaml'), YAML.stringify(operatorsData));

      // 保存段位数据
      const rankData = { sol: this.cache.rankScoreSol, tdm: this.cache.rankScoreTdm };
      fs.writeFileSync(path.join(dataDir, 'rankscore.yaml'), YAML.stringify(rankData));

      pluginState.logDebug('本地缓存保存完成');
    } catch (error) {
      pluginState.log('warn', '保存本地缓存失败:', error);
    }
  }

  /** 从 API 刷新数据 */
  async refreshFromApi (): Promise<void> {
    const api = createApi();

    try {
      // 获取地图数据 (API 返回 [{ id, name }, ...])
      const mapsRes = await api.getMaps();
      const mapsSuccess = mapsRes && (mapsRes.success || mapsRes.code === 0);
      if (mapsSuccess && Array.isArray(mapsRes.data)) {
        this.cache.maps.clear();
        for (const item of mapsRes.data) {
          this.cache.maps.set(String(item.id), item.name);
        }
        pluginState.logDebug(`地图数据同步成功 (${this.cache.maps.size}条)`);
      }

      // 获取干员数据 (API 返回 [{ id, name }, ...])
      const operatorsRes = await api.getOperators();
      const opSuccess = operatorsRes && (operatorsRes.success || operatorsRes.code === 0);
      if (opSuccess && Array.isArray(operatorsRes.data)) {
        this.cache.operators.clear();
        for (const item of operatorsRes.data) {
          this.cache.operators.set(String(item.id), item.name);
        }
        pluginState.logDebug(`干员数据同步成功 (${this.cache.operators.size}条)`);
      }

      // 获取段位数据 (API 返回 { sol: [{ score, name }], tdm: [{ score, name }] })
      const rankRes = await api.getRankScore();
      const rankSuccess = rankRes && (rankRes.success || rankRes.code === 0);
      if (rankSuccess && rankRes.data) {
        // 转换为 { [score]: name } 格式（与原版一致）
        this.cache.rankScoreSol = {};
        this.cache.rankScoreTdm = {};

        if (Array.isArray(rankRes.data.sol)) {
          for (const item of rankRes.data.sol) {
            this.cache.rankScoreSol[String(item.score)] = item.name;
          }
        }
        if (Array.isArray(rankRes.data.tdm)) {
          for (const item of rankRes.data.tdm) {
            this.cache.rankScoreTdm[String(item.score)] = item.name;
          }
        }
        pluginState.logDebug(`段位数据同步成功 (sol: ${Object.keys(this.cache.rankScoreSol).length}, tdm: ${Object.keys(this.cache.rankScoreTdm).length})`);
      }

      this.cache.lastUpdate = Date.now();
      this.saveLocalCache();
      pluginState.logDebug('API 数据刷新完成');
    } catch (error) {
      pluginState.log('warn', '从 API 刷新数据失败，使用本地缓存:', error);
    }
  }

  /** 加载背景图片列表 */
  private loadBackgrounds (): void {
    try {
      const bgDir = path.join(pluginState.pluginPath, 'resources', 'background');
      if (fs.existsSync(bgDir)) {
        const files = fs.readdirSync(bgDir);
        this.cache.backgrounds = files
          .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
          .map(f => path.join(bgDir, f));
      }
    } catch (error) {
      pluginState.logDebug('加载背景图片失败:', error);
    }
  }

  /** 获取地图名称 */
  getMapName (mapId: string | number): string {
    const id = String(mapId);
    const name = this.cache.maps.get(id);
    return name || `未知地图(${id})`;
  }

  /** 获取干员名称 */
  getOperatorName (operatorId: string | number): string {
    const id = String(operatorId);
    const name = this.cache.operators.get(id);
    return name || `未知干员(${id})`;
  }

  /** 根据分数获取段位（与原版 Data.js getRankByScore 一致） */
  getRankByScore (score: number | string, mode: 'sol' | 'tdm' | 'mp' = 'sol'): string {
    // tdm 和 mp 都使用 tdm 段位数据
    const modeData = mode === 'sol' ? this.cache.rankScoreSol : this.cache.rankScoreTdm;

    if (!modeData || Object.keys(modeData).length === 0) {
      return `未知段位 (${score})`;
    }

    const numScore = parseInt(String(score));
    if (isNaN(numScore)) {
      return `分数无效(${score})`;
    }

    // 获取所有分数阈值并从高到低排序
    const thresholds = Object.keys(modeData).map(s => parseInt(s)).sort((a, b) => b - a);

    // 找到第一个小于等于目标分数的阈值
    for (const threshold of thresholds) {
      if (numScore >= threshold) {
        const rankName = modeData[String(threshold)];

        // 检查是否是最高段位（统帅/三角洲巅峰）需要计算星级
        const isHighestRank = (mode === 'sol' && threshold === 6000) || (mode !== 'sol' && threshold === 5000);

        if (isHighestRank && numScore > threshold) {
          // 计算星级：超出部分每50分一颗星
          const extraScore = numScore - threshold;
          const stars = Math.floor(extraScore / 50);
          if (stars > 0) {
            return `${rankName}${stars}星 (${numScore})`;
          }
        }

        return `${rankName} (${numScore})`;
      }
    }

    // 如果分数低于所有阈值，返回最低段位
    const lowestThreshold = thresholds[thresholds.length - 1];
    const lowestRank = modeData[String(lowestThreshold)];
    return `${lowestRank} (${numScore})`;
  }

  /** 获取地图图片路径（与原版 Data.js 一致） */
  getMapImagePath (mapName: string, mode: 'sol' | 'mp' = 'sol'): string | null {
    if (!mapName || mapName.includes('未知') || mapName.includes('无')) {
      return null;
    }

    // 清理地图名称，移除可能的括号内容
    let cleanName = mapName.trim().replace(/\s*\([^)]*\)/, '');

    // 根据模式构建路径
    const prefix = mode === 'sol' ? '烽火-' : '全面-';

    // 全面战场模式：从地图名称中提取"-"前面的部分
    // 例如："烬区-攻防" -> "烬区"，匹配"全面-烬区.jpg"
    if (mode === 'mp') {
      if (cleanName.includes('-')) {
        cleanName = cleanName.split('-')[0].trim();
      }
      const extension = '.jpg';
      return `imgs/map/${prefix}${cleanName}${extension}`;
    }

    // 烽火地带模式：优先匹配地图名称中的具体难度，然后按优先级查找
    if (mode === 'sol') {
      const mapDir = path.join(pluginState.pluginPath, 'resources', 'imgs', 'map');
      let baseName = cleanName;
      let difficulty = '';

      // 提取基础地图名称和难度
      if (cleanName.includes('-')) {
        const parts = cleanName.split('-');
        baseName = parts[0].trim();
        difficulty = parts.slice(1).join('-').trim(); // 支持"适应"等难度
      }

      // 如果地图名称中包含难度信息，优先匹配对应难度的图片
      if (difficulty) {
        const specificPath = path.join(mapDir, `${prefix}${baseName}-${difficulty}.png`);
        if (fs.existsSync(specificPath)) {
          return `imgs/map/${prefix}${baseName}-${difficulty}.png`;
        }
      }

      // 如果没有找到具体难度的图片，按优先级尝试：常规 -> 机密 -> 绝密
      const difficulties = ['常规', '机密', '绝密'];
      for (const diff of difficulties) {
        const imagePath = path.join(mapDir, `${prefix}${baseName}-${diff}.png`);
        if (fs.existsSync(imagePath)) {
          return `imgs/map/${prefix}${baseName}-${diff}.png`;
        }
      }

      // 如果都没有找到，尝试直接使用基础名称
      const directPath = path.join(mapDir, `${prefix}${baseName}.png`);
      if (fs.existsSync(directPath)) {
        return `imgs/map/${prefix}${baseName}.png`;
      }
    }

    return null;
  }

  /** 获取段位图片路径（与原版 Data.js 一致） */
  getRankImagePath (rankName: string, mode: 'sol' | 'mp' = 'sol'): string | null {
    if (!rankName || rankName.includes('未知')) {
      return null;
    }

    // 移除分数和星级部分
    const cleanRankName = rankName.replace(/\s*\(\d+\)/, '').replace(/\d+星/, '').trim();

    // 段位映射表（与原版完全一致）
    const rankMappings: Record<string, Record<string, string>> = {
      sol: {
        '青铜 V': '1_5', '青铜 IV': '1_4', '青铜 III': '1_3', '青铜 II': '1_2', '青铜 I': '1_1',
        '白银 V': '2_5', '白银 IV': '2_4', '白银 III': '2_3', '白银 II': '2_2', '白银 I': '2_1',
        '黄金 V': '3_5', '黄金 IV': '3_4', '黄金 III': '3_3', '黄金 II': '3_2', '黄金 I': '3_1',
        '铂金 V': '4_5', '铂金 IV': '4_4', '铂金 III': '4_3', '铂金 II': '4_2', '铂金 I': '4_1',
        '钻石 V': '5_5', '钻石 IV': '5_4', '钻石 III': '5_3', '钻石 II': '5_2', '钻石 I': '5_1',
        '黑鹰 V': '6_5', '黑鹰 IV': '6_4', '黑鹰 III': '6_3', '黑鹰 II': '6_2', '黑鹰 I': '6_1',
        '三角洲巅峰': '7',
      },
      mp: {
        '列兵 V': '1_5', '列兵 IV': '1_4', '列兵 III': '1_3', '列兵 II': '1_2', '列兵 I': '1_1',
        '上等兵 V': '2_5', '上等兵 IV': '2_4', '上等兵 III': '2_3', '上等兵 II': '2_2', '上等兵 I': '2_1',
        '军士长 V': '3_5', '军士长 IV': '3_4', '军士长 III': '3_3', '军士长 II': '3_2', '军士长 I': '3_1',
        '尉官 V': '4_5', '尉官 IV': '4_4', '尉官 III': '4_3', '尉官 II': '4_2', '尉官 I': '4_1',
        '校官 V': '5_5', '校官 IV': '5_4', '校官 III': '5_3', '校官 II': '5_2', '校官 I': '5_1',
        '将军 V': '6_5', '将军 IV': '6_4', '将军 III': '6_3', '将军 II': '6_2', '将军 I': '6_1',
        '统帅': '7',
      },
    };

    // tdm 等同于 mp
    const modeKey = mode === 'mp' ? 'mp' : 'sol';
    const mappings = rankMappings[modeKey];

    if (!mappings) {
      return null;
    }

    const rankCode = mappings[cleanRankName];
    if (!rankCode) {
      pluginState.logDebug(`[数据管理器] 未找到段位映射: ${cleanRankName} (模式: ${modeKey})`);
      return null;
    }

    return `imgs/rank/${modeKey}/${rankCode}.webp`;
  }

  /** 获取随机背景图片 */
  getRandomBackground (): string {
    if (this.cache.backgrounds.length === 0) {
      return '';
    }
    const idx = Math.floor(Math.random() * this.cache.backgrounds.length);
    const bgPath = this.cache.backgrounds[idx];
    return `file:///${bgPath.replace(/\\/g, '/')}`;
  }

  /** 检查是否需要刷新 */
  needsRefresh (): boolean {
    return Date.now() - this.cache.lastUpdate > CACHE_TTL;
  }

  /** 获取所有地图 (返回 { id, name } 数组) */
  getAllMaps (): { id: string; name: string; }[] {
    return Array.from(this.cache.maps.entries()).map(([id, name]) => ({ id, name }));
  }

  /** 获取所有干员 (返回 { id, name } 数组) */
  getAllOperators (): { id: string; name: string; }[] {
    return Array.from(this.cache.operators.entries()).map(([id, name]) => ({ id, name }));
  }

  // ==================== 计算器数据访问接口 ====================

  /** 获取计算器完整数据 */
  getCalculatorData (): any {
    return {
      weapons: this.cache.weaponsSol,
      weaponsSol: this.cache.weaponsSol,
      weaponsMp: this.cache.weaponsMp,
      armors: this.cache.armors,
      bullets: this.cache.bullets,
      equipment: this.cache.equipment,
      battlefieldWeapons: this.cache.battlefieldWeapons,
      meleeWeapons: this.cache.meleeWeapons,
    };
  }

  /** 获取装备价格数据 */
  getEquipmentData (category?: string): any {
    if (!this.cache.equipment) return category ? [] : {};
    if (category) {
      return this.cache.equipment?.equipment?.[category] || [];
    }
    return this.cache.equipment;
  }

  /** 获取战场武器数据 */
  getBattlefieldWeapons (category?: string): any {
    if (!this.cache.battlefieldWeapons) return category ? [] : {};
    if (category) {
      return this.cache.battlefieldWeapons?.battlefield_weapons?.[category] || [];
    }
    return this.cache.battlefieldWeapons;
  }

  /** 根据口径获取子弹列表 */
  getBulletsByCaliber (caliber: string): any[] {
    if (!this.cache.bullets?.bullets) return [];
    return this.cache.bullets.bullets[caliber] || [];
  }

  /** 根据名称获取护甲数据 */
  getArmorByName (armorName: string): any {
    if (!this.cache.armors?.armors) return null;

    for (const categoryKey in this.cache.armors.armors) {
      const categoryArmors = this.cache.armors.armors[categoryKey];
      if (Array.isArray(categoryArmors)) {
        const armor = categoryArmors.find((a: any) =>
          a.name === armorName || a.name.includes(armorName)
        );
        if (armor) {
          return {
            ...armor,
            category: categoryKey,
            protectionLevel: armor.protectionLevel || armor.protection_level,
            repairLoss: armor.repairLoss || armor.repair_loss,
            repairPrice: armor.repairPrice || armor.repair_price,
            repairEfficiencies: armor.repairEfficiencies || armor.repair_efficiencies,
          };
        }
      }
    }
    return null;
  }

  /** 获取护甲列表 */
  getArmorList (): any[] {
    if (!this.cache.armors?.armors) return [];
    const armors: any[] = [];
    if (this.cache.armors.armors.body_armor) {
      armors.push(...this.cache.armors.armors.body_armor);
    }
    if (this.cache.armors.armors.helmets) {
      armors.push(...this.cache.armors.armors.helmets);
    }
    return armors.sort((a, b) => a.protectionLevel - b.protectionLevel);
  }

  /** 根据名称获取武器数据 */
  getWeaponByName (weaponName: string, mode: string = 'sol'): any {
    const dataFile = mode === 'mp' ? this.cache.weaponsMp : this.cache.weaponsSol;
    if (!dataFile?.weapons) return null;

    for (const categoryKey in dataFile.weapons) {
      const categoryWeapons = dataFile.weapons[categoryKey];
      if (Array.isArray(categoryWeapons)) {
        const weapon = categoryWeapons.find((w: any) => w.name === weaponName);
        if (weapon) {
          return {
            ...weapon,
            category: categoryKey,
            decayDistances: weapon.decayDistances || weapon.decay_distances || [],
            decayMultipliers: weapon.decayMultipliers || weapon.decay_factors || [],
          };
        }
      }
    }
    return null;
  }

  /** 获取武器类别列表 */
  getWeaponCategories (mode: string = 'sol'): { key: string; displayName: string; count: number; }[] {
    const dataFile = mode === 'mp' ? this.cache.battlefieldWeapons : this.cache.weaponsSol;
    const weaponData = mode === 'mp' ? dataFile?.battlefield_weapons : dataFile?.weapons;

    if (!weaponData) return [];

    const categoryNames: Record<string, string> = {
      'assault_rifles': '突击步枪',
      'submachine_guns': '冲锋枪',
      'shotguns': '霰弹枪',
      'light_machine_guns': '轻机枪',
      'marksman_rifles': '精确射手步枪',
      'sniper_rifles': '狙击步枪',
      'pistols': '手枪',
      'special': '特殊武器',
      'rifles': '突击步枪',
      'lmgs': '轻机枪',
      'dmrs': '精确射手步枪',
      'snipers': '狙击步枪',
    };

    const categories: { key: string; displayName: string; count: number; }[] = [];
    for (const [category, weapons] of Object.entries(weaponData)) {
      if (Array.isArray(weapons) && weapons.length > 0) {
        categories.push({
          key: category,
          displayName: categoryNames[category] || category,
          count: weapons.length,
        });
      }
    }
    return categories;
  }

  /** 根据类别获取武器列表 */
  getWeaponsByCategory (mode: string, category: string): any[] {
    const dataFile = mode === 'mp' ? this.cache.battlefieldWeapons : this.cache.weaponsSol;
    const weaponData = mode === 'mp' ? dataFile?.battlefield_weapons : dataFile?.weapons;

    if (!weaponData?.[category]) return [];
    return weaponData[category] || [];
  }

  /** 获取所有武器列表 (用于模糊搜索) */
  getWeaponsByMode (mode: string = 'sol'): any[] {
    const dataFile = mode === 'mp' ? this.cache.weaponsSol : this.cache.weaponsSol;
    if (!dataFile?.weapons) return [];

    const allWeapons: any[] = [];
    for (const [category, weapons] of Object.entries(dataFile.weapons)) {
      if (Array.isArray(weapons)) {
        allWeapons.push(...weapons.map(weapon => ({
          ...weapon,
          category,
        })));
      }
    }
    return allWeapons;
  }

  /** 获取胸挂装备列表 */
  getChestEquipment (): any[] {
    return this.cache.equipment?.equipment?.chest_rigs || [];
  }

  /** 获取背包装备列表 */
  getBackpackEquipment (): any[] {
    return this.cache.equipment?.equipment?.backpacks || [];
  }
}

/** 导出单例 */
export const dataManager = new DataManager();
export default dataManager;
