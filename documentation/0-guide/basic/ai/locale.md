# 语音智能体本地化（pt-BR）

AIUI 不会安装系统语言包。要让眼镜用某种语言（例如巴西葡萄牙语）对话，需要分别配置 **三层**：宿主应用语言、语音输入/输出，以及模型提示词。

本文以 **`pt-BR`** 作为第一个可落地的本地化示例。可运行实现见 [`samples/pt-br`](https://github.com/jsar-project/AIUI/tree/main/samples/pt-br)。

## 1. 宿主语言

配套应用（Hi Rokid）负责运行时语言。G1.9.9 起提供葡萄牙语界面和地区设置。

智能体可以读取该语言，但不能替换它：

```javascript
const language = navigator.language;
const languages = navigator.languages;
const region = navigator.region;
```

用这些值做文案回退。在用户改完应用语言之前，不要假设当前就是 `pt-BR`。

## 2. 语音识别

在 `start()` 之前设置 BCP 47 语言标签。如果 `lang` 为空，宿主会选择默认语言。

```javascript
const recognition = new SpeechRecognition();
recognition.lang = 'pt-BR';
recognition.start();
```

如果宿主 ASR 没有葡萄牙语模型，识别结果仍可能是其他语言。请在真机上检查转写文本，再确认该标签是否生效。

## 3. 模型回复

在 `AGENTS.md` 和 `LanguageModel` 的 `initialPrompts` 中强制回复语言。这是目前最可靠的 pt-BR 开关：

```javascript
const session = await LanguageModel.create({
  initialPrompts: [
    {
      role: 'system',
      content:
        'Você é um assistente de voz nos óculos Rokid. Responda sempre em português brasileiro (pt-BR). Seja curto.',
    },
  ],
});
```

`LanguageModel.availability()` 不会列出模型。如果不传 `model`，将使用宿主的 `defaultModel`。

## 4. 语音播报

可以设置 `utterance.lang = 'pt-BR'`，但当前运行时可能忽略 `lang`、`pitch`、`rate`、`volume` 和 `voice`。仍然建议设置该字段，同时保证模型输出是葡萄牙语，这样回退音色至少在读葡萄牙语文本。

```javascript
const utterance = new SpeechSynthesisUtterance(reply);
utterance.lang = 'pt-BR';
speechSynthesis.speak(utterance);
```

如果端侧 TTS 仍是错误语言，请改用支持 pt-BR 的云端 TTS。可参考 [Minimax TTS 示例](https://github.com/jsar-project/AIUI/tree/main/samples/tts)。

## 5. 发布 pt-BR 示例

```bash
aix pack ./samples/pt-br -o pt-br.aix --engine '^0.14.0'
```

然后在 [AIUI Studio Global](https://aiui-global.rokid.com/) 上传安装包，更新眼镜资源包，并用智能体名称唤醒。

## 继续阅读

- **[语音识别](/AIUI/guide/basic-ai-asr)**：采集用户语音。
- **[语音播报](/AIUI/guide/basic-ai-tts)**：播报模型回复。
- **[大语言模型](/AIUI/guide/basic-ai-llm)**：创建会话并发送提示词。
