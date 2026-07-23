# Git 日常工作流

这个目录是独立 Git 仓库，不依赖上层 `mygame` 仓库。

## 进入仓库并查看状态

```bash
cd "/Users/nanami/Documents/ecnu/mygame/cards/内嵌RP运行时模板"
git status
git log --oneline --decorate -8
```

`git status` 中没有内容代表工作区干净。修改前可以用 `git diff` 查看尚未暂存的差异。

## 本地预览

在上层工作区启动静态服务器：

```bash
cd "/Users/nanami/Documents/ecnu/mygame"
python3 -m http.server 8774
```

浏览器打开：

```text
http://127.0.0.1:8774/cards/内嵌RP运行时模板/ui/
```

## 测试与构建

```bash
cd "/Users/nanami/Documents/ecnu/mygame/cards/内嵌RP运行时模板"
node tools/test-runtime.mjs
node tools/build-template.mjs
node tools/audit-template.mjs
node tools/render-preview.mjs
```

构建结果：

- `release/内嵌RP运行时模板-v0.1-debug.json`
- `qa/template-card-preview.html`

## 提交自己的修改

```bash
git status
git diff
git add ui docs tools README.md
git diff --cached
git commit -m "feat: 描述这次修改"
```

只想提交某个文件时，不要使用 `git add .`：

```bash
git add ui/styles/debug-console.css
git commit -m "style: refine preset manager"
```

## 撤销与找回

撤销某个尚未暂存的文件修改：

```bash
git restore ui/styles/debug-console.css
```

取消暂存但保留修改：

```bash
git restore --staged ui/styles/debug-console.css
```

查看某次提交：

```bash
git show <commit-id>
```

不要使用 `git reset --hard`。需要回到某个稳定版本时，优先新建分支：

```bash
git switch -c detail-polish
```

完成细节后可以回到主分支：

```bash
git switch main
```
