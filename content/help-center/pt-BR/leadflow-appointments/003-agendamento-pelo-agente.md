---
systemKey: appointments-agent-scheduling
slug: agendamento-pelo-agente
title: 'Agendamento feito pelo agente'
summary: 'Prepare horário, permissões e dados do contato para que o agente proponha compromissos sem sair das regras da empresa.'
categoryKey: leadflow
moduleKey: leadflow-appointments
productKey: lyra-leadflow
trailKeys: [agenda]
order: 42
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 5
tags: [agenda, agente, agendamento, horários, appointment]
---

Um agente pode ajudar a marcar compromissos quando a capacidade de agendamento está habilitada e a agenda da empresa está pronta.

## Preparar a operação

1. Em **LeadFlow → Agendamentos → Configurações**, publique o horário de atendimento.
2. Em **LeadFlow → Agentes**, abra o agente e confirme que o modelo permite agendar.
3. Ligue o agente aos canais corretos.
4. Garanta que o contato tenha dados suficientes para identificar a pessoa.
5. Teste com um horário dentro da jornada.

## O que o agente respeita

| Regra | Efeito |
| --- | --- |
| Empresa selecionada | O compromisso fica no contexto correto |
| Horário publicado | Bloqueia intervalos fora do atendimento |
| Capacidade do agente | Agentes sem agendamento não criam compromissos |
| Permissão de quem confirma | Uma proposta do Orion só executa se o usuário puder criar |
| Responsável e contato válidos | Evita vínculo com pessoa fora do contexto |

> **Importante:** o agente não deve inventar disponibilidade. Revise a agenda e as configurações sempre que horários ou responsáveis mudarem.

## Conferir depois

Abra **LeadFlow → Agendamentos**, localize o compromisso e revise título, contato, responsável, horário, formato e estado. Ajustes posteriores são feitos pela própria agenda.

## Problemas comuns

| O que acontece | O que fazer |
| --- | --- |
| O agente não oferece agenda | Confira a capacidade do modelo e o canal ligado |
| O horário é recusado | Revise a janela publicada em Configurações |
| O compromisso foi criado sem responsável | Abra e atribua uma pessoa autorizada |
| O contato não foi vinculado | Complete o cadastro e revise o compromisso |
| A proposta do Orion não confirma | Confirme com um usuário que tenha permissão de agenda |

