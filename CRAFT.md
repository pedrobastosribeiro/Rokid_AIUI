# Import no Craft Global

O Craft trata o caminho depois de `/tree/` como **um único git ref**.
Por isso esta URL **falha**:

```text
https://github.com/pedrobastosribeiro/Rokid_AIUI/tree/main/samples/pt-br
```

Erro típico: `GitHub ref not found: main/samples/pt-br`.

Cole **esta** URL (o agente está na raiz do branch):

```text
https://github.com/pedrobastosribeiro/Rokid_AIUI/tree/cursor/pt-br-craft-e686
```

No celular, selecione tudo no campo, cole, e arraste o texto até confirmar que termina em `pt-br-craft-e686`.

Não faça merge deste branch na `main`. Ele existe só para o import/pack no Craft.
