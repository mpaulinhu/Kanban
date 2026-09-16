# Kanban

Gestão de tarefas estilo Trello, extraída da área de Pedagogia do CoreHub para
rodar como aplicação independente.

## Rodar

```bash
npm install
npm run dev
```

Abre em `http://localhost:5200`.

## Telas

| Rota | O que é |
|---|---|
| `/quadro` | Quadro Kanban — arrastar cards e colunas, modal de detalhe |
| `/grade` | Tabela com filtros (status, prioridade, categoria, responsável, período) e ordenação |
| `/calendario` | Calendário em Mês/Semana/Dia, arrastando tarefa para mudar a data |
| `/templates` | Modelos de checklist reutilizáveis |

## Estado atual

A interface está completa e funcional — arrastar cards e colunas, modal de
detalhe, etiquetas nomeadas com escolha de cor, comentários, anexos,
checklist (com modelos aplicáveis a uma tarefa existente), responsáveis,
filtro por etiqueta, busca, arquivamento e modo ampliado.

**Os dados são de demonstração**, guardados na memória do navegador e
espelhados em `localStorage` (sobrevivem a um F5, não saem da máquina). Não
há banco de dados nem login: qualquer pessoa que abrir edita tudo.

## O que mudou em relação ao CoreHub

O objetivo era extrair a tela sem arrastar a infraestrutura do back-office
inteiro. As camadas acopladas foram substituídas por equivalentes mínimos,
mantendo a mesma superfície para os componentes:

| No CoreHub | Aqui |
|---|---|
| Firestore + Storage | Repositório em memória (`features/kanban/api/store.ts`) |
| Autenticação (OAuth, claims, Cloud Functions) | Usuário fixo (`providers/AuthProvider.tsx`) |
| Controle de acesso por papel, 4 tabelas | Todo usuário edita (`hooks/useRole.ts`) |
| Trilha de auditoria no banco | `console.debug` (`features/kanban/hooks/usePmAudit.ts`) |
| `@grupo-elo-editorial/shared-ui-react` | Botão local no `ConfirmDialog` |
| `@eloeditorial/*` (pacotes do monorepo) | Removidos |

Cada um desses é um ponto de extensão isolado: ligar um banco de verdade, por
exemplo, é reimplementar os módulos de `features/kanban/api/` mantendo as
assinaturas — nenhum componente precisa mudar.

### Correção herdada

As classes `bg-primary`, `ring-ring`, `border-input` e `text-destructive`,
usadas no modal de detalhe, não têm cor definida no CoreHub — nem no CSS dele,
nem no pacote de design tokens — e por isso renderizam sem efeito lá. Aqui
elas são definidas em `styles/globals.css`, apontando para a paleta `--eh-*`.

### Valores medidos

Os tokens `--eh-pm-*` (gradiente do quadro, cinza das colunas, cor do texto,
opacidade do cabeçalho) foram amostrados pixel a pixel de capturas do Trello
real, e os pares de cor das etiquetas foram escolhidos por medição individual
de contraste (todos ⩾4,5:1). Os comentários em `globals.css` registram cada
medição — não substitua esses valores por aproximações.

## Estrutura

```
src/
  components/         UserAvatar, UserProfilePopover, Toast, ConfirmDialog
  features/kanban/
    KanbanBoardPage.tsx   o quadro
    pages/                grade, calendário, templates
    api/                  dados (hoje em memória)
    components/           card, modal, etiquetas, comentários, anexos, checklist
    types/ utils/ hooks/
  layouts/            casca do app e modo ampliado
  providers/          usuário
  styles/globals.css  tokens
```
