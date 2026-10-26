---
systemKey: client-area-white-label
slug: dominio-e-marca-proprios-da-area-do-cliente
title: 'Domínio e marca próprios'
summary: 'Em Área do Cliente → Minha Agência → Identidade e login, escolha Personalizar para definir nome, logos e cores, ajuste o login e, em Domínio, configure um domínio personalizado publicando os registros TXT e CNAME e clicando em Verificar DNS.'
categoryKey: area-do-cliente
moduleKey: client-area
productKey: lyra-agency
trailKeys: [area-do-cliente-para-agencias]
order: 4
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 6
tags: [white label, marca própria, domínio personalizado, logo, cores, login, dns, cname, txt]
---

A Área do Cliente pode aparecer com a **marca da sua agência** e, se você quiser, em um **endereço próprio** (por exemplo, `clientes.suaagencia.com.br`). O cliente sente que está no portal da agência.

## Em resumo

- Fica em **Área do Cliente → aba Minha Agência → Identidade e login**.
- Por padrão, a Área do Cliente usa o nome e a logo de **Configurações › Empresa** da agência.
- Com **Personalizar**, você define nome exibido, logos para tema claro e escuro, cores, símbolo e favicon.
- O **domínio personalizado** exige publicar dois registros no DNS (TXT e CNAME) e verificar.

## Identidade

| Opção em **Identidade** | O que acontece |
| --- | --- |
| **Usar identidade da agência** | Nome e logo vêm de **Configurações › Empresa**. Os campos personalizados ficam desabilitados |
| **Personalizar** | Você define **Nome exibido**, **Logo (tema claro)**, **Logo (tema escuro)**, **Cor primária**, **Cor secundária**, **Símbolo claro**, **Símbolo escuro** e **Favicon** |

As logos, símbolos e o favicon são informados por **endereço (URL)** da imagem. O quadro **Aplicado na Área do Cliente** mostra o que está valendo de fato: nome, cor e se há logo definida.

> **Dica:** use logos com fundo transparente e confira os dois temas. Uma logo escura some no tema escuro se você não informar a versão clara.

## Login

| Campo | Para que serve |
| --- | --- |
| **Layout de login** | **Centralizado** ou **Dividido** |
| **Título do login** | O título que o cliente vê ao entrar |
| **Texto do login** | Uma frase de apoio abaixo do título |
| **Fundo do login** | A cor de fundo da tela de entrada |

O endereço de login padrão aparece como **Login público** (`/client-area/login?a=…`). O login só mostra a marca da agência quando o acesso vem pelo endereço da agência ou por um domínio verificado.

## Domínio personalizado

1. Em **Domínio**, troque **URL padrão Lyra** por **Domínio personalizado**.
2. Informe o domínio (por exemplo, `clientes.suaagencia.com.br`) e clique em **Salvar domínio**.
3. No provedor de DNS do seu domínio, publique o registro **TXT** `_lyra-verify.` seguido do seu domínio, com o valor mostrado na tela, e o **CNAME** para o destino informado pela plataforma.
4. Clique em **Verificar DNS**.

| Resultado | Significado |
| --- | --- |
| "Domínio verificado" | O DNS está correto; a ativação final (certificado e servidor) é concluída pela equipe de infraestrutura do Lyra |
| "DNS ainda não confirmado" | Os registros ainda não propagaram ou estão diferentes; confira TXT e CNAME e tente mais tarde |

> **Atenção:** alterações de DNS podem levar algumas horas para propagar. Não apague o registro TXT depois da verificação.

> **Permissão:** só quem administra a Área do Cliente na agência altera identidade, login e domínio.

## Problemas comuns

| O que acontece | Causa provável | O que fazer |
| --- | --- | --- |
| Os campos de marca estão desabilitados | **Identidade** está em **Usar identidade da agência** | Troque para **Personalizar** |
| A logo não aparece | URL inválida ou imagem privada | Use uma URL pública de imagem e confira em **Aplicado na Área do Cliente** |
| **Verificar DNS** desabilitado | O domínio digitado é diferente do salvo | Clique em **Salvar domínio** antes |
| O login continua com a marca Lyra | O cliente entrou pelo endereço padrão sem identificação da agência | Envie o link de **Login público** ou use o domínio verificado |

## Artigos relacionados

- [O que o cliente vê na Área do Cliente](/help/articles/o-que-o-cliente-ve-na-area-do-cliente)
- [Convidar o cliente e definir o Owner](/help/articles/convidar-o-cliente-e-definir-o-responsavel)
