# 发布步骤（dsh-pet-speak）

仓库已在本目录初始化并完成首个提交（`b9aace4`）。
最后两步需要你的账号授权，命令如下。

## 1. 建 GitHub 仓库并推送

浏览器打开 <https://github.com/new>：

- Repository name：`dsh-pet-speak`
- 可见性：Public
- **不要**勾选 “Add a README / .gitignore / license”（本地已有）

然后在本目录执行（把 `<你的用户名>` 换掉）：

```bash
git remote add origin https://github.com/<你的用户名>/dsh-pet-speak.git
git branch -M main
git push -u origin main
```

> 推送时会弹一次凭据窗口（Git Credential Manager 或浏览器授权），那一步必须你点。

## 2. 发布到 npm

```bash
npm login          # 浏览器里完成登录
npm publish --access public
```

发布前确认：

- 包名 `dsh-pet-speak` 已查过是空的（2026-10-21 查）；
- 版本号 `0.2.0`；
- `files` 里包含 `index.js / cordis.patch.yml / scripts/*.ps1 / PET-PROTOCOL.md / README*`。

## 3. 市场登记

按 DSH 插件市场的发现规则登记（市场按 npm 包名 + `dsh.bundle.patch` 识别）。
建议在市场页填一句定位：

> 让桌宠替 AI 说话：每轮只念一句结论，ESC 可打断，支持系统语音 / 桌宠桥 / 自定义命令四种出口。

## 发布后自检

```bash
npm view dsh-pet-speak version
npx --yes dsh-pet-speak --help   # 预期报错（没有 CLI），能下载到即说明包完整
```

真正验证：在另一个 profile 里 `pnpm add dsh-pet-speak`，把 `dsh-pet-speak` 加进
`dsh.profile.bundles`，重启 DSH，看是否出声音。

## 别忘了

- 把 `package.json` 里的 `<your-account>` 换成你的 GitHub 用户名（`repository` / `homepage`）；
- 想换作者名，改 `author` 字段；
- 发版后每次改动要手动升 `version`，否则 `npm publish` 会被拒。
