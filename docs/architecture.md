# 项目架构

## 设计原则

PowerLessToy 使用 pnpm workspace 管理多个独立 Chrome 扩展。每个扩展可以单独开发、构建和发布，共享代码统一放在 `packages/shared`。

## 目录职责

```text
apps/<extension>/
├── manifest.json      # Chrome Manifest V3 清单
├── package.json       # 扩展包信息与未来构建命令
├── README.md          # 扩展边界与目录说明
├── assets/icons/      # 图标资源
├── src/background/    # 后台 Service Worker
├── src/content/       # 页面内脚本
├── src/options/       # 设置页面
├── src/popup/         # 工具栏弹窗
└── tests/             # 单元与集成测试
```

## 扩展边界

### Bookmark Organizer

负责替代 Chrome 新标签页，并按分类、分组和可选环境标识管理用户维护的链接。MVP 不读取或修改 Chrome 原生书签；实现时只申请新标签页入口与本地持久化确实需要的能力。

### Element Remover

负责进入页面元素选择模式、标记用户选中的元素并将其从当前页面移除。未来需要明确一次性移除与持久化规则后，再申请 `activeTab`、`scripting`、`storage` 等权限。

### Message Center

负责接收、存储和展示消息。消息来源和传输方式尚未定义，因此当前不绑定任何外部服务或额外权限。

## 共享代码规则

只有两个或更多扩展实际复用的代码才进入 `packages/shared`。在需求实现前，不提前抽象业务模块。

## 权限规则

清单目前保持最小权限。实现功能时遵循按需申请原则，避免在骨架阶段声明宽泛的网站访问权限。
