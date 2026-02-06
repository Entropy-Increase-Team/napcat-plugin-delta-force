# NapCat 三角洲行动插件

基于 NapCat 框架的三角洲行动游戏数据查询插件。

> 原项目: [delta-force-plugin](https://github.com/Dnyo666/delta-force-plugin)  
> 本项目为迁移到 NapCat 框架的版本 by 冷曦

## 功能特性

- 个人信息查询 (`#三角洲信息`)
- UID 查询 (`#三角洲uid`)
- 战绩统计查询
- 日报/周报查询
- 账号管理（登录、切换、解绑）
- 工具计算（伤害、战备、维修）
- 更多功能持续迁移中...

## 前置要求

1. **NapCat 框架** - 插件基于 NapCat 运行
2. **napcat-plugin-puppeteer** - 用于图片渲染，需要先安装并启用

## 安装方法

1. 将 `napcat-plugin-delta-force` 目录复制到 NapCat 的插件目录
2. 在 WebUI 中启用插件
3. 配置 `config/config.yaml` 文件

## 配置说明

首次运行会自动生成配置文件，位于插件数据目录下的 `config.yaml`。

主要配置项：

```yaml
delta_force:
  # API 密钥 (在管理网页创建)
  api_key: "sk-xxxxxxx"
  
  # 客户端 ID (从管理网页复制)
  clientID: "xxxxxx"
  
  # API 地址模式: auto | default | eo | esa
  api_mode: "auto"
  
  # Puppeteer 插件 ID
  puppeteer_plugin_id: "napcat-plugin-puppeteer"
```

## 命令列表

| 命令 | 说明 |
|------|------|
| `#三角洲信息` / `^信息` | 查询个人信息卡片 |
| `#三角洲uid` / `^uid` | 查询游戏 UID |

更多命令持续添加中...

## 依赖说明

本插件需要 `napcat-plugin-puppeteer` 插件提供渲染服务：

- 通过无认证接口 `/plugin/napcat-plugin-puppeteer/api/render` 调用
- 确保 Puppeteer 插件已启动并正常运行

## 目录结构

```
napcat-plugin-delta-force/
├── index.mjs              # 主入口
├── package.json           # 包配置
├── config/
│   └── config_default.yaml # 默认配置
├── resources/
│   └── Template/          # HTML 模板
└── src/
    ├── core/              # 核心模块
    │   ├── state.ts       # 状态管理
    │   └── api.ts         # API 封装
    ├── services/          # 服务层
    │   ├── render.ts      # 渲染服务
    │   └── data-manager.ts # 数据管理
    ├── handlers/          # 消息处理器
    │   └── info.ts        # 信息查询
    ├── utils/             # 工具函数
    │   ├── account.ts     # 账号工具
    │   ├── error-handler.ts # 错误处理
    │   └── format.ts      # 格式化
    └── types/
        └── index.ts       # 类型定义
```

## 开发说明

本插件采用模块化设计：

- **core**: 核心模块（状态、API）
- **services**: 服务层（渲染、数据）
- **handlers**: 消息处理器
- **utils**: 工具函数

### 添加新命令

1. 在 `handlers/` 目录创建新的处理器文件
2. 导出命令定义和处理函数
3. 在 `index.mjs` 中注册命令

## 许可证

AGPL-3.0

## 致谢

- 原项目作者 [@Dnyo666](https://github.com/Dnyo666)
- NapCat 框架开发团队
- 插件反馈群: 631348711
- API交流群: 932459332
