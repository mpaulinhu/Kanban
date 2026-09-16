# Kanban

Quadro de tarefas para equipes: colunas, cards arrastáveis, etiquetas,
checklists, comentários, anexos e um calendário das entregas.

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
| `/calendario` | Calendário em Mês/Semana/Dia, arrastando tarefa para mudar a data |
| `/templates` | Modelos de checklist reutilizáveis |

## O que já funciona

Arrastar cards e colunas, modal de detalhe, etiquetas nomeadas com escolha de
cor, comentários, anexos, checklist (com modelos aplicáveis a uma tarefa
existente), responsáveis, busca, arquivamento e modo ampliado. Os filtros do
cabeçalho recortam o quadro por etiqueta, responsável e status, e ordenam por
título ou data. Cada coluna tem cor própria, e o nome do quadro é editável.

## Limites da versão atual

**Não há banco de dados nem contas.** Os dados nascem de um conjunto de
exemplo e ficam no `localStorage` do navegador: sobrevivem a um F5, mas não
saem da máquina e não são compartilhados entre pessoas. Quem abrir o app edita
tudo — não existe login nem permissão.

Trocar isso por um backend real é reimplementar os módulos de
`src/features/kanban/api/` mantendo as assinaturas atuais: eles já são a única
fronteira de dados do app, e nenhum componente fala com a persistência
diretamente.

## Estrutura

```
src/
  components/         UserAvatar, UserProfilePopover, Toast, ConfirmDialog
  features/kanban/
    KanbanBoardPage.tsx   o quadro
    pages/                calendário, templates
    api/                  dados (hoje em memória + localStorage)
    components/           card, modal, etiquetas, comentários, anexos, checklist
    types/ utils/ hooks/
  layouts/            casca do app e modo ampliado
  providers/          usuário
  styles/globals.css  tokens
```

## Cores e contraste

Os pares de cor das etiquetas, os fundos de coluna e as cores do cabeçalho
foram escolhidos por medição de contraste — todos os textos ficam em 4,5:1 ou
mais, conforme a WCAG 2.2 AA. Os comentários em `styles/globals.css` registram
cada medição; ao mexer numa cor, refaça a conta em vez de aproximar no olho.
