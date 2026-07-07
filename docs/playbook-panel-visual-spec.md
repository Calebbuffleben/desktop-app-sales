# Especificação Visual — Painel de Playbook (Dark HUD)

Documento de referência para replicar a aparência do mock de playbook na landing page (`src/components/PlaybooksSection.tsx`) no produto.

Escopo: **apenas visual** — layout, cores, tipografia, espaçamento, estados e motion. Sem conteúdo ou copy.

Referência de implementação: `src/styles.css` (utilitários HUD) + mock em `PlaybooksSection.tsx`.

---

## 1. Paleta

| Nome | OKLCH | Papel |
|------|-------|-------|
| Cyan | `oklch(0.82 0.16 205)` | Acento principal, bordas, passo ativo |
| Violet | `oklch(0.72 0.18 285)` | Gradiente, chip de ação tipo C |
| Emerald | `oklch(0.78 0.18 155)` | Status positivo, badge pill |
| Surface | `oklch(0.06 0.015 245)` | Faixas de header |
| Foreground | `--foreground` | Títulos e valores |
| Muted | `--muted-foreground` | Subtítulos e corpo secundário |

### Gradientes e sombras globais

```css
--gradient-brand: linear-gradient(
  135deg,
  oklch(0.82 0.16 205),
  oklch(0.72 0.18 285) 58%,
  oklch(0.78 0.18 165)
);

--gradient-brand-soft: linear-gradient(
  135deg,
  oklch(0.82 0.16 205 / 0.18),
  oklch(0.72 0.18 285 / 0.14) 58%,
  oklch(0.78 0.18 165 / 0.12)
);

--shadow-glow:
  0 22px 70px -24px oklch(0.82 0.16 205 / 0.7),
  0 0 28px -18px oklch(0.72 0.18 285 / 0.65);
```

---

## 2. Estrutura do painel

Stack vertical de **5 faixas** dentro de um único container.

```
[ Halo blur externo ]
  └─ [ Container principal — border-radius 24px ]
       ├─ Linha topo (1px gradiente)
       ├─ Faixa 1: Header (flex row, space-between)
       ├─ Faixa 2: Metadados (grid 3 colunas ≥ sm)
       ├─ Faixa 3: Bloco descritivo
       ├─ Faixa 4: Lista de cards empilhados
       └─ Faixa 5: Footer (flex row, ícone + texto)
```

---

## 3. Container principal

### Propriedades base

| Propriedade | Valor |
|-------------|-------|
| Utilitários | `hud-corners` + `hud-panel` + `hud-glow` |
| Border radius | `24px` (`rounded-3xl`) |
| Overflow | `hidden` |
| Position | `relative` |

### Background — `hud-panel`

```css
background:
  linear-gradient(180deg, oklch(0.82 0.16 205 / 0.06), oklch(0.06 0.015 245 / 0.65)),
  linear-gradient(135deg, oklch(0.72 0.18 285 / 0.04), transparent 60%);
border: 1px solid oklch(0.82 0.16 205 / 0.14);
box-shadow:
  inset 0 1px 0 oklch(1 0 0 / 0.04),
  0 28px 80px -40px oklch(0.82 0.16 205 / 0.5);
backdrop-filter: blur(20px);
```

### Glow extra — `hud-glow`

```css
box-shadow:
  0 0 0 1px oklch(0.82 0.16 205 / 0.1),
  0 24px 70px -32px oklch(0.82 0.16 205 / 0.55),
  0 0 48px -24px oklch(0.72 0.18 285 / 0.35);
```

### Cantos técnicos — `.hud-corners`

Dois pseudo-elementos decorativos:

| Propriedade | Valor |
|-------------|-------|
| Tamanho | `12×12px` |
| Border color | cyan 45% |
| Border style | solid |
| z-index | `2` |
| pointer-events | `none` |

| Pseudo | Posição | Bordas visíveis |
|--------|---------|-----------------|
| `::before` | top `10px`, left `10px` | top + left |
| `::after` | bottom `10px`, right `10px` | bottom + right |

### Halo externo (atrás do container)

| Propriedade | Valor |
|-------------|-------|
| Position | absolute |
| Inset | `-16px` |
| Border radius | `32px` |
| Background | `--gradient-brand` |
| Opacity | `7%` |
| Filter | blur `2xl` |

### Linha no topo (dentro do container)

| Propriedade | Valor |
|-------------|-------|
| Position | absolute, full width, `top: 0` |
| Height | `1px` |
| Background | gradiente horizontal: transparent → cyan 50% → transparent |

---

## 4. Faixa 1 — Header

| Propriedade | Valor |
|-------------|-------|
| Layout | flex, wrap, items-center, justify-between |
| Gap | `12px` |
| Padding | `24px` horizontal, `16px` vertical |
| Background | surface 50% opacity |
| Border bottom | `1px` cyan 12% |

### Bloco esquerdo

Layout: flex row, gap `12px`.

| Elemento | Spec |
|----------|------|
| Caixa de ícone | `36×36px`, `border-radius 8px`, bg `--gradient-brand-soft`, ring `1px white/10%`, ícone `16×16px` |
| Título | sans, `14px`, semibold, foreground |
| Subtítulo | mono, `10px`, muted-foreground |

### Badge pill (direita)

| Propriedade | Valor |
|-------------|-------|
| Shape | `rounded-full` |
| Border | emerald 35% |
| Background | emerald 10% |
| Padding | `10px 10px` |
| Tipografia | mono, `10px`, medium, uppercase, tracking wider |
| Cor do texto | `oklch(0.82 0.17 155)` |

---

## 5. Faixa 2 — Metadados

| Propriedade | Valor |
|-------------|-------|
| Layout | grid, 3 colunas (≥ `sm`) |
| Border bottom | `1px` cyan 10% |

### Célula

| Propriedade | Valor |
|-------------|-------|
| Padding | `24px` horizontal, `12px` vertical |
| Mobile | border-bottom cyan 8% entre células |
| Desktop | border-right cyan 8% entre colunas (última sem border) |

| Elemento | Spec |
|----------|------|
| Label | mono, `9px`, uppercase, tracking wider, cyan 55% |
| Valor | `12px`, medium |
| Valor destaque (coluna 1) | emerald |
| Valor neutro (colunas 2–3) | foreground 90% |
| Espaço label → valor | `2px` |

---

## 6. Faixa 3 — Bloco descritivo

| Propriedade | Valor |
|-------------|-------|
| Padding | `24px` horizontal, `16px` vertical |
| Border bottom | `1px` cyan 10% |

| Elemento | Spec |
|----------|------|
| Label | mono, `9px`, medium, uppercase, tracking wider, cyan 55% |
| Corpo | sans, `14px`, leading relaxed, foreground 85% |
| Espaço label → corpo | `6px` |

---

## 7. Faixa 4 — Lista de cards

| Propriedade | Valor |
|-------------|-------|
| Padding | `16px` (mobile) / `24px` (md+) |
| Gap entre cards | `8px` |

### Card de passo — estado inativo

| Propriedade | Valor |
|-------------|-------|
| Border radius | `16px` |
| Padding | `16px` |
| Border | `--border` 40% |
| Background | white 2% |
| Transition | border + shadow, `200ms` |

#### Linha superior do card

Layout: flex wrap, gap `8px`.

| Elemento | Spec |
|----------|------|
| Índice | mono `10px`, medium, cyan |

#### Linha de chips

Layout: flex wrap, gap `8px`, margin-top `12px`.

| Chip | Inativo |
|------|---------|
| Chip principal | `border-radius 8px`, px `12px` py `6px`, sans `14px` medium, border cyan 15%, bg white 4%, foreground 90%, hover border cyan 30% |
| Chip ação tipo A | pill, border border/50, bg white 4%, muted, ícone `12px` |
| Chip ação tipo B | pill, border cyan 35%, bg cyan 12%, texto cyan claro, ícone `12px` |
| Chip ação tipo C | pill, border violet 35%, bg violet 12%, texto violet claro, ícone `12px` |

Todos os chips de ação: px `8px` py `2px`, sans `10px` medium, cursor pointer, hover opacity 80%.

#### Linha de detalhe (opcional)

| Propriedade | Valor |
|-------------|-------|
| Margin-top | `10px` |
| Tipografia | sans `12px`, leading relaxed, muted |
| Prefixo | foreground 60%, medium |

### Card de passo — estado ativo

Substitui os estilos do card inativo:

| Propriedade | Valor |
|-------------|-------|
| Border | cyan 45% |
| Background | cyan 10% |
| Shadow | `0 0 40px -12px` cyan 52% |

#### Indicador live (somente no ativo)

| Propriedade | Valor |
|-------------|-------|
| Layout | flex row, gap `4px` |
| Tipografia | mono `10px` medium, cyan |
| Dot | `6×6px`, cyan, com `animate-ping` no mesmo tamanho, opacity 75% |

#### Chip principal (ativo)

| Propriedade | Valor |
|-------------|-------|
| Background | `--gradient-brand` |
| Texto | branco |
| Shadow | `--shadow-glow` |
| Hover | opacity 90% |

---

## 8. Faixa 5 — Footer

| Propriedade | Valor |
|-------------|-------|
| Layout | flex row, items-center, gap `8px` |
| Padding | `24px` horizontal, `12px` vertical |
| Border top | border/50 |
| Background | white 2% |
| Texto | sans `12px`, muted |
| Ícone | `14×14px`, cyan, shrink-0 |

---

## 9. Tipografia — resumo

| Papel | Fonte | Tamanho | Peso | Extra |
|-------|-------|---------|------|-------|
| Título header | Geist Sans | 14px | 600 | — |
| Código / labels de metadados | Geist Mono | 9–10px | 400–500 | uppercase, tracking wider |
| Valores metadados | Geist Sans | 12px | 500 | — |
| Corpo descritivo | Geist Sans | 14px | 400 | leading relaxed |
| Chip principal | Geist Sans | 14px | 500 | — |
| Chip ação | Geist Sans | 10px | 500 | — |
| Detalhe | Geist Sans | 12px | 400 | — |
| Footer | Geist Sans | 12px | 400 | — |

---

## 10. Motion

| Elemento | Animação |
|----------|----------|
| Painel (entrada) | opacity 0→1, translateX -24→0, 600ms |
| Cada card (entrada) | opacity 0→1, translateY 12→0, 450ms, delay escalonado `0.1 + índice × 0.08` |
| Dot ativo | ping contínuo |
| Chips | transition opacity/border, 200ms |

---

## 11. Utilitários CSS reutilizáveis

Mapeamento direto dos tokens usados na landing:

| Utilitário | Uso no painel |
|------------|---------------|
| `hud-panel` | Superfície principal do container |
| `hud-glow` | Glow externo cyan/violet |
| `hud-corners` | Cantos técnicos decorativos |
| `bg-gradient-brand` | Chip principal ativo |
| `bg-gradient-brand-soft` | Caixa de ícone no header |
| `--shadow-glow` | Sombra do chip ativo |

---

## 12. Checklist de fidelidade visual

- [ ] Container `rounded-3xl` com cantos técnicos + glow
- [ ] Halo brand blur atrás do painel
- [ ] Linha gradiente no topo
- [ ] 5 faixas com divisórias cyan sutis
- [ ] Header com caixa de ícone gradient-soft + badge emerald pill
- [ ] Grid 3 colunas de metadados com labels mono 9px
- [ ] Cards empilhados com gap 8px
- [ ] Exatamente um card com glow cyan + chip gradient + dot ping
- [ ] Chips de ação em 3 variantes de cor (neutral / cyan / violet)
- [ ] Footer com ícone cyan + texto muted 12px

---

## 13. Referências no repositório

| Arquivo | O que contém |
|---------|--------------|
| `src/components/PlaybooksSection.tsx` | Implementação de referência do mock |
| `src/styles.css` | Tokens e utilitários HUD (`hud-panel`, `hud-glow`, `hud-corners`) |
| `openmemory.md` | Índice da identidade visual Dark HUD do projeto |
