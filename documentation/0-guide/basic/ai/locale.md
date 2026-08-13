# 眼镜语言（pt-BR）

AIUI 不会安装系统语言包。要让**眼镜本身**用巴西葡萄牙语交流（而不只是一个专用智能体），需要分别配置 **四层**：Hi Rokid 系统语言、语音输入、模型提示词，以及语音播报。

可运行的眼镜语音循环见 [`samples/pt-br`](../../../../samples/pt-br)。

## 1. 眼镜系统语言（必需）

配套应用（Hi Rokid）负责菜单、HUD 框架、地区设置和内置助手。G1.9.9 起提供葡萄牙语界面。

在已配对的手机上：

1. 将 Hi Rokid 更新到 G1.9.9 或更高版本。
2. 打开 **Language settings**，选择 **Português**。
3. 如果应用提供地区选项，一并设置 **region**。
4. 检查眼镜固件更新，让 HUD 跟随应用语言。

智能体可以读取该语言，但不能替换它：

```javascript
const language = navigator.language;
const languages = navigator.languages;
const region = navigator.region;
```

用这些值做文案回退。在用户改完应用语言之前，即使智能体用 pt-BR 回复，`navigator.language` 仍可能是英语或中文。

## 2. 语音识别

在 `start()` 之前设置 BCP 47 语言标签。如果 `lang` 为空，宿主会选择默认语言。

```javascript
const recognition = new SpeechRecognition();
recognition.lang = 'pt-BR';
recognition.start();
```

如果宿主 ASR 没有葡萄牙语模型，识别结果仍可能是其他语言。请在真机上检查转写文本，再确认该标签是否生效。

## 3. 模型回复

在 `AGENTS.md` 和 `LanguageModel` 的 `initialPrompts` 中强制回复语言。这是 AIUI 智能体内最可靠的 pt-BR 开关。把模型当成眼镜的声音，而不是一个独立应用：

```javascript
const session = await LanguageModel.create({
  initialPrompts: [
    {
      role: 'system',
      content:
        'Você é a voz dos óculos Rokid. Fale sempre em português brasileiro (pt-BR). Seja curto.',
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

## 5. 发布眼镜语音循环

在电脑上：

```bash
aix pack ./samples/pt-br -o pt-br.aix --engine '^0.14.0'
```

在 [Craft Global](https://js.rokid.com/craft?region=global) 中，不要导入 `/tree/main/samples/pt-br`。Craft 会把该路径当成 git ref，并报 `GitHub ref not found: main/samples/pt-br`。请粘贴：

```text
https://github.com/pedrobastosribeiro/Rokid_AIUI/tree/cursor/pt-br-craft-e686
```

该分支的仓库根目录已包含 `app.json`。然后在 Craft 中打包，上传到 [AIUI Studio Global](https://aiui-global.rokid.com/) 中名为 **Óculos Rokid** 的 AIUI Agent，并在眼镜上执行 **Settings → Developer → AIUI → Update Glasses Resource Package**。

## 继续阅读

- **[语音识别](/AIUI/guide/basic-ai-asr)**：采集用户语音。
- **[语音播报](/AIUI/guide/basic-ai-tts)**：播报模型回复。
- **[大语言模型](/AIUI/guide/basic-ai-llm)**：创建会话并发送提示词。
