# 网页版百炼原生转写接口设计

## 目标

网页版使用 `qwen-audio-3.1-asr-flash` 转写录音，同时保留 `qwen-plus` 的 OpenAI 兼容总结接口。分析仍由用户勾选触发，转写完成不会自动写入飞书。

## 数据流

浏览器继续在本地把录音解码为 16 kHz 单声道 WAV，并按 210 秒分段。每段以 Base64 Data URI 发送到百炼原生 `multimodal-generation/generation` 接口，请求体采用 `input.messages[].content[].input_audio`，从返回的 `output.text` 读取文字。已有分段缓存和重试逻辑保持不变。

## 兼容与错误处理

已保存的 `https://dashscope.aliyuncs.com/compatible-mode/v1` 转写地址在加载设置时自动迁移为 `https://dashscope.aliyuncs.com/api/v1`；总结地址不迁移。也支持用户日后填写工作空间专属的 `https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/api/v1`。接口没有返回 `output.text` 时停止当前录音并显示明确错误，不生成空转写或继续总结。

## 验证

离线测试覆盖旧地址迁移、工作空间地址、原生请求体及返回解析。浏览器验证确认页面加载、旧设置迁移和模型展示；跨域预检不携带密钥、录音或客户数据。真实识别效果与账号权限由用户使用一条录音验证。
