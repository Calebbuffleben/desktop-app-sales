# Fase 7 - Testes e Critérios de Paridade

## Objetivo

Validar que a versão desktop entrega o mesmo resultado funcional da extensão para:
- protocolo de áudio e feedback em tempo real;
- UX do overlay (TTL, severidade, estabilidade);
- comportamento sob queda de conexão e recuperação.

## Pré-requisitos

- Backend em execução (`http://localhost:3001` por padrão).
- Endpoint sintético habilitado:

```bash
ENABLE_FEEDBACK_TEST_ENDPOINT=true
```

- Desktop app com Node 20 (`nvm use` em `desktop-app`).

## Testes de protocolo

### 1) WS de áudio percorre pipeline

```bash
cd desktop-app
pnpm desktop:validate-protocol
```

Esperado:
- handshake WS em `/egress-audio` com sucesso;
- envio de frame PCM16 binário;
- sem erro de timeout.

### 2) Feedback em tempo real via Socket.IO

```bash
cd desktop-app
pnpm desktop:test:phase7
```

O script executa:
- join em `feedback:<meetingId>`;
- emissão de feedback sintético no backend;
- valida entrega em tempo real via evento `feedback`.

## Testes de UX

## 3) Overlay no contexto da reunião + TTL/severidade

Com o app em `pnpm dev` e reunião ativa:
- overlay deve ficar visível e ancorado ao Meet quando detectado;
- cada item deve desaparecer em ~15s (TTL);
- estilos por severidade:
  - `info` (azul),
  - `warning` (âmbar),
  - `critical` (vermelho).

## 4) Queda de conexão e recuperação

`pnpm desktop:test:phase7` também valida:
- fallback para polling após disconnect de Socket.IO;
- recuperação de eventos após reconnect do socket.

## Critérios de “mesmo resultado”

## Latência fim-a-fim
- `realtimeLatencyMs <= 3500ms` (ajustável por `PARITY_MAX_LATENCY_MS`).

## Recuperação em falha
- `pollingRecoveryMs <= 7000ms` (ajustável por `PARITY_MAX_RECOVERY_MS`).

## Precisão equivalente
- severidade e tipo recebidos no desktop devem corresponder ao emitido no backend.
- mensagem de feedback recebida deve preservar token de correlação do teste.

## Overlay estável
- overlay visível durante chamada, sem flicker perceptível.
- troca entre `meet-window` e `fixed` só quando detecção de janela realmente muda.

## Observação

O script de Fase 7 valida critérios automatizáveis (protocolo/realtime/fallback/recovery/latência).
Estabilidade visual do overlay continua com validação manual guiada por checklist.
