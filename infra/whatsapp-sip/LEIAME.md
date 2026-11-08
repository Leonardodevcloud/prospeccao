# Ponte do WhatsApp (Z-API) ↔ telefonia do Prospect Team

A Z-API entrega as ligações do WhatsApp por SIP e o “telefone” precisa se **registrar** nela
(`sip.z-api.io`, UDP). O LiveKit (a telefonia do CRM) não se registra em ninguém, e o Railway não
tem UDP. Por isso existe esta ponte: um Asterisk numa VPS em São Paulo que fica registrado na Z-API
e repassa as ligações:

```
WhatsApp do cliente ──► Z-API ──SIP──► ponte (Asterisk, VPS) ──SIP──► LiveKit ──► CRM (menu de voz, grupos, gravação)
CRM “Ligar pelo WhatsApp” ──► LiveKit (tronco do WhatsApp) ──► ponte ──► Z-API ──► WhatsApp do lead
```

Uma ponte por número de WhatsApp (uma instância da Z-API).

## O que você precisa

- **Z-API:** a função de chamadas contratada na instância. No painel da instância, em Chamadas › SIP,
  gere a senha SIP. Ela aparece **uma vez só**; se perder, gere outra (a antiga para de valer).
  O usuário é o ID da instância.
- **VPS em São Paulo** (Vultr, AWS Lightsail, Magalu Cloud…): 1 vCPU e 1 GB bastam (US$ 5 a 12 por mês),
  Ubuntu 24.04, com IP público fixo. Ficar no Brasil importa: longe, a voz atrasa.
- **Firewall da VPS:** liberar a entrada **UDP 5060** (SIP) e **UDP 10000 a 10200** (o áudio).

## Subir a ponte

1. Instale o Docker na VPS: `curl -fsSL https://get.docker.com | sh`
2. Copie esta pasta (`infra/whatsapp-sip`) para a VPS.
3. `cp exemplo.env .env` e preencha:
   - `ZAPI_INSTANCIA` e `ZAPI_SIP_TOKEN`: o ID da instância e a senha SIP da Z-API.
   - `NUMERO_WHATSAPP`: o número do WhatsApp da instância, com DDD.
   - `LIVEKIT_SIP_HOST`: o “SIP URI” do projeto no LiveKit Cloud › Telephony, sem o `sip:`.
   - `IP_PUBLICO`: o IP da VPS.
   - `SAIDA_USUARIO` e `SAIDA_SENHA`: invente (o LiveKit usa para ligar pela ponte).
4. `docker compose up -d --build`
5. Confira o registro na Z-API:
   `docker compose exec ponte asterisk -rx "pjsip show registrations"` → tem que aparecer **Registered**.
   Se aparecer *Rejected*, a senha SIP ou o ID da instância estão errados.

## No LiveKit (cloud.livekit.io › projeto › Telephony)

1. **Tronco de entrada (Inbound trunk)** do WhatsApp: número `+55…` do WhatsApp; em *Allowed addresses*,
   o IP da VPS. Na **regra de despacho** (Dispatch rule) que já existe, do tipo Individual com o prefixo
   `lig-in-`, inclua este tronco (ou crie uma igual para ele).
2. **Tronco de saída (Outbound trunk)** do WhatsApp: endereço = IP da VPS (porta 5060, UDP); número =
   o `+55…` do WhatsApp; usuário e senha = `SAIDA_USUARIO` e `SAIDA_SENHA`. Copie o ID (`ST_…`).

## No Prospect Team

1. Railway › api › Variables: `TELEFONIA_TRONCO_WHATSAPP` = o `ST_…` do tronco de saída do WhatsApp.
   Redeploy da api.
2. Painel master › Clientes › a conta › Telefonia: cadastre o número com o tipo **WhatsApp (ponte Z-API)**.
   A aba mostra o teste dos dois troncos.
3. Teste:
   - **Recebida:** ligue pelo WhatsApp de outro celular para o número da loja com o CRM aberto: aparece
     “Ligação de WhatsApp” (com o menu de voz, se estiver ligado).
   - **Feita:** na ficha de um lead, no número de celular, o botão do WhatsApp (balão) liga pelo WhatsApp.

## Se algo não funcionar

- Ver o que acontece: `docker compose logs -f ponte`
- Sem áudio de um lado: confira o `IP_PUBLICO` e as portas UDP 10000–10200 no firewall da VPS.
- A tecla do menu de voz não chega: a Z-API pode não repassar as teclas (DTMF) da ligação de WhatsApp.
  Nesse caso, desligue o menu de voz na conta (a ligação toca para todos) e avise o Claude para fazer o
  menu por voz (“diga o nome da loja”).
- Limite da Z-API: até 3 ligações ao mesmo tempo por número.
- O número do lead vai para a Z-API como `55` + DDD + número. Se a Z-API pedir outro formato, ajuste o
  `Set(DESTINO=…)` em `modelos/extensions.conf`.
