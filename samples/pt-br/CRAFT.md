# Import no Craft Global

O Craft trata o caminho depois de `/tree/` como **um único git ref**.
Por isso esta URL **falha**:

```text
https://github.com/pedrobastosribeiro/Rokid_AIUI/tree/main/samples/pt-br
```

Erro típico: `GitHub ref not found: main/samples/pt-br`.

Cole **esta** URL (o agente está na raiz do branch `pt-br`):

```text
https://github.com/pedrobastosribeiro/Rokid_AIUI/tree/pt-br
```

No celular, selecione tudo no campo, cole, e arraste o texto até confirmar que termina em `/tree/pt-br` — sem `main` e sem `samples`.

Não faça merge do branch `pt-br` na `main`. Ele existe só para o import/pack no Craft.

## Studio: por que o agente fica em rascunho

O selo **rascunho** é do AIUI Studio, não do Git. Merge na `main` não publica o agente.

Para **usar nos seus óculos** (sem loja):

1. Studio Global: [https://aiui-global.rokid.com/](https://aiui-global.rokid.com/) — não use o site da China.
2. Feche o aviso de load failure do agente novo; isso é esperado antes de vincular o projeto.
3. No Craft, **vincule** este projeto ao agente **Óculos Rokid**, depois **Pack** e faça upload do `.aix`.
4. Troque o **ícone padrão** (planeta azul). O guia oficial recusa o ícone default na revisão.
5. Nos óculos: **Settings → Developer → AIUI → Update Glasses Resource Package**.
6. Acorde o assistente e fale o nome **Óculos Rokid**.

O `AGENTS.md` precisa ser `# Agent Manifest` + `## Identity` + **Name** — é o formato que o Studio valida no pacote. `# Agent: …` no título não basta.

Sair de rascunho (loja Hi Rokid) exige **Submit for Review**, ícone próprio e termos. Não é necessário para debug nos óculos.

