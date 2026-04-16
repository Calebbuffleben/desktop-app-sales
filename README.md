# Desktop App (Electron + Next.js)

Base desktop client para substituir a `chrome-extension`, mantendo compatibilidade de protocolo com o backend.

## Fase 2 implementada

Esta fase cobre compatibilidade com `EgressAudioGateway` sem alterar backend:

- Reuso da mesma composição de URL/query da extensão para `/egress-audio`
- Normalização de protocolo `ws/wss` em função compartilhada
- Contrato de query com:
  - `room`
  - `meetingId`
  - `participant`
  - `track`
  - `sampleRate`
  - `channels`
- Validação de handshake WebSocket e envio de payload binário PCM16

## Arquivos principais

- `src/shared/egress-audio-protocol.ts`: utilitários de protocolo (normalização + URL + frame PCM)
- `electron/main.ts`: handlers IPC para preview/validação de protocolo
- `src/app/page.tsx`: UI de controle para gerar URL e validar handshake/payload
- `scripts/validate-egress-protocol.ts`: validação CLI de protocolo

## Comandos

## Runtime recomendado

Use Node LTS 20.x neste workspace (`.nvmrc`), pois o fluxo de empacotamento com `electron-builder` pode falhar com OOM em Node 24.

```bash
nvm use
```

```bash
pnpm dev
```

Sobe Next.js + Electron.

```bash
pnpm desktop:validate-protocol
```

Executa validação CLI de handshake e envio de frame PCM16 para `/egress-audio`.

Variáveis opcionais no comando CLI:

- `MEET_URL`
- `MEETING_ID`
- `PARTICIPANT`
- `TRACK`
- `SAMPLE_RATE`
- `CHANNELS`

## Fase 3 implementada

Captura de áudio desktop com envio PCM em tempo real:

- Serviço: `src/shared/audio-capture-service.ts`
- Fluxo:
  - captura (`getUserMedia` para microfone / `getDisplayMedia` para sistema quando disponível),
  - downmix para mono,
  - resample para `16000`,
  - framing em `20ms`,
  - conversão para `Int16 PCM`,
  - envio binário via WebSocket para `/egress-audio`.

### Matriz MVP cross-platform

- **macOS**: prioridade microfone; loopback opcional com dispositivo virtual (BlackHole/Loopback).
- **Windows**: prioridade loopback/WASAPI quando disponível (`getDisplayMedia` com áudio), fallback para microfone.
- **Linux**: prioridade captura de sistema via PulseAudio/PipeWire (`getDisplayMedia` com áudio), fallback para microfone.

### Integração Electron para áudio de sistema

No processo principal (`electron/main.ts`) o `setDisplayMediaRequestHandler` foi configurado para permitir captura de tela/janela com `audio: \"loopback\"`, habilitando tentativa de system audio no renderer.

## Fase 4 implementada

Feedback em tempo real no overlay com paridade funcional da extensão:

- Cliente de feedback no renderer: `src/shared/feedback-client.ts`
  - Socket.IO (`join-room`, `room-joined`, `feedback`)
  - fallback polling REST em `/feedback/metrics/:meetingId`
  - deduplicação por `id`
- Overlay (`src/app/overlay/page.tsx`) com:
  - lista temporária (TTL de 15s)
  - severidade visual (`info`, `warning`, `critical`)
  - render de metadata/tips
  - badge SPIN (`Risco SPIN` / `Fase: ...`) via `conversationStateJson` ou `spinPhase`/`spinRisk`
- Controle de contexto do feedback:
  - IPC `desktop:set-feedback-context`
  - preload `onFeedbackContextUpdated`
  - meetingId/base HTTP sincronizados entre janela de controle e overlay

### Ancoragem do overlay ao Meet (Chrome externo)

Implementada no processo principal (`electron/main.ts`):

- detecção periódica da janela ativa do Meet
- sincronização da posição do overlay no canto superior direito da janela detectada
- fallback automático para posição fixa de tela quando a detecção falha

Estratégia de detecção:

- macOS: tentativa de AppleScript no Google Chrome (URL de aba ativa + bounds)
- fallback cross-platform: biblioteca `active-win` (janela ativa com title/owner/bounds)

### Ajustes pós-revisão da Fase 4

- Correção de tipagem/build com `active-win` no Electron main process.
- Atualização em tempo real de `anchorMode` na janela de controle via evento IPC `desktop:anchor-mode-updated`.
- Robustez de deduplicação no feedback fallback (eventos sem `id` também deduplicados por chave temporal/tipo/mensagem).
- Runtime fix no bootstrap Electron em dev:
  - novo runner `scripts/run-electron.sh`
  - execução com `env -u ELECTRON_RUN_AS_NODE` para evitar modo Node acidental
  - scripts `dev:electron` e `desktop:start` atualizados para usar o runner.

## Fase 6 implementada

Hardening, empacotamento/distribuição e política de permissões:

- Hardening Electron:
  - `contextIsolation: true` + `nodeIntegration: false` + `sandbox: true` nas janelas
  - bloqueio de `window.open`, `webview` e navegação para URLs não confiáveis
  - permission handlers restritivos (`media` apenas)
  - preload com IPC estrito (allowlist de canais invoke/listen + validação de payload)
- Auto-update:
  - `electron-updater` no main process
  - eventos de update expostos ao renderer (`desktop:update-status`)
  - ações de controle (`check`, `download`, `install`) via IPC
  - provider configurado no `electron-builder.yml` (`AUTO_UPDATE_FEED_URL`)
- Empacotamento e distribuição:
  - `electron-builder` configurado com targets macOS (dmg/zip) e Windows (nsis)
  - build pipeline separado: `build:web` (Next export estático) + `build:electron` (TS para `dist-electron`)
  - scripts: `pack`, `dist:mac`, `dist:win`, `dist`
  - entitlements macOS em `build/entitlements.mac.plist`

### Comandos de distribuição

```bash
pnpm pack
pnpm dist:mac
pnpm dist:win
pnpm dist
```

### Signing e auto-update (variáveis esperadas)

- macOS signing/notarization (Electron Builder padrão):
  - `CSC_LINK`, `CSC_KEY_PASSWORD`
  - (opcional para notarization) `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- Auto-update feed genérico:
  - `AUTO_UPDATE_FEED_URL`

## Fase 7 implementada

Testes de protocolo, UX e paridade funcional:

- Script automatizado de paridade: `scripts/phase7-parity-check.ts`
  - valida handshake WS + envio PCM16 (`/egress-audio`);
  - valida entrega de feedback via Socket.IO em tempo real;
  - força queda de socket, valida fallback polling e valida recuperação do socket.
- Comando:

```bash
ENABLE_FEEDBACK_TEST_ENDPOINT=true pnpm desktop:test:phase7
```

- Critérios e checklist completos em:
  - `docs/phase7-parity-criteria.md`

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
