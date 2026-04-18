# TXT QR

离线文本传输工具。

## 产物

- 单文件页面：`../text-transfer.html`
- 构建输出：`dist/text-transfer.html`
- GitHub Pages 发布页：`docs/index.html`

## 使用

1. 在电脑浏览器打开 `text-transfer.html`。
2. `发送` 模式里粘贴文本，点击“生成二维码”。
3. 如果是短文本，手机系统相机直接扫即可看到内容。
4. 如果是长文本，手机打开同一个 `text-transfer.html`，切到 `接收` 模式后连续扫码，收齐后会自动拼接。

## 接收端注意

- 页面优先调用摄像头连续识别。
- 若浏览器不允许 `file://` 页面访问摄像头，可改为：

```bash
cd /Users/guopeixin/code
python3 -m http.server 8000
```

然后让电脑和手机通过内网访问同一个地址，例如 `http://电脑IP:8000/text-transfer.html`。

- 如果仍不方便开摄像头，可把二维码截图后用“识别图片”导入。

## 开发

```bash
cd /Users/guopeixin/code/text-transfer-tool
npm install
npm run build
```

执行 `npm run build` 后会同时更新：

- `dist/text-transfer.html`：本地构建产物（已忽略，不提交）
- `docs/index.html`：GitHub Pages 首页（提交到仓库）
- `../text-transfer.html`：仓库外的单文件副本，便于本地直接打开
