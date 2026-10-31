import { e164 } from '@prospeccao/shared/ligacoes';
import { AccessToken, RoomServiceClient, SipClient } from 'livekit-server-sdk';
import { urlDaApi } from '../reuniao/video.js';

/**
 * Telefonia pelo LiveKit: o comercial entra numa sala pelo navegador (fone e microfone) e o LiveKit
 * liga para o número do lead por um tronco SIP do provedor brasileiro (Nvoip, Twilio…), com o
 * número da empresa. O som vai direto entre o navegador, o LiveKit e o provedor; o sistema só abre
 * a sala, dá o acesso e manda discar. Trocar de provedor é trocar o tronco no LiveKit.
 */

export interface ConfigTelefonia {
  /** wss://<projeto>.livekit.cloud (o mesmo das reuniões). */
  url: string;
  apiKey: string;
  apiSecret: string;
  /** Tronco de saída criado no LiveKit (ST_…), com o login do provedor. */
  troncoSaida: string;
}

/** Estado do lado do lead, como o LiveKit conta (atributo sip.callStatus). */
export type EstadoChamada = 'discando' | 'tocando' | 'atendida' | 'encerrada';

export interface ServicoTelefonia {
  readonly urlCliente: string;
  /** Acesso do comercial à sala da ligação (vale 2 horas). */
  acesso(p: { sala: string; identidade: string; nome: string }): Promise<string>;
  /** Cria a sala (fecha sozinha 1 min depois de vazia). */
  abrirSala(sala: string): Promise<void>;
  /** Liga para o lead. Volta logo (não espera atender); o navegador acompanha o estado na sala. */
  discar(p: {
    sala: string;
    /** Número do lead (DDD + número). */
    numero: string;
    /** Número da empresa que aparece para o lead (DDD + número). */
    de: string | null;
    nome: string;
    toqueSegundos: number;
    /** Limite da ligação (segundos). */
    maxSegundos?: number;
  }): Promise<void>;
  /** Encerra a ligação (derruba a sala; o lado do lead desliga). */
  encerrar(sala: string): Promise<void>;
  /** Estado do lado do lead (null: a sala já não existe). */
  estado(sala: string): Promise<EstadoChamada | null>;
  testar(): Promise<string>;
}

export const IDENTIDADE_LEAD = 'lead';

const ESTADOS: Record<string, EstadoChamada> = {
  dialing: 'discando',
  ringing: 'tocando',
  automation: 'tocando',
  active: 'atendida',
  hangup: 'encerrada',
};

export function lerEstado(atributos: Record<string, string> | undefined): EstadoChamada {
  return ESTADOS[atributos?.['sip.callStatus'] ?? ''] ?? 'discando';
}

export function criarServicoTelefonia(cfg: ConfigTelefonia): ServicoTelefonia {
  const host = urlDaApi(cfg.url);
  const salas = new RoomServiceClient(host, cfg.apiKey, cfg.apiSecret);
  const sip = new SipClient(host, cfg.apiKey, cfg.apiSecret);
  const naoAchou = (e: Error) => /not.?found|404/i.test(e.message);
  return {
    urlCliente: cfg.url.replace(/\/+$/, ''),

    async acesso(p) {
      const t = new AccessToken(cfg.apiKey, cfg.apiSecret, {
        identity: p.identidade,
        name: p.nome,
        ttl: '2h',
      });
      t.addGrant({
        roomJoin: true,
        room: p.sala,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
      return t.toJwt();
    },

    async abrirSala(sala) {
      await salas.createRoom({ name: sala, emptyTimeout: 60, departureTimeout: 20, maxParticipants: 4 });
    },

    async discar(p) {
      await sip.createSipParticipant(cfg.troncoSaida, e164(p.numero), p.sala, {
        participantIdentity: IDENTIDADE_LEAD,
        participantName: p.nome,
        ...(p.de ? { fromNumber: e164(p.de) } : {}),
        ringingTimeout: p.toqueSegundos,
        maxCallDuration: p.maxSegundos ?? 2 * 3600,
        // Tira o ruído do lado do lead (rua, loja).
        krispEnabled: true,
        waitUntilAnswered: false,
      });
    },

    async encerrar(sala) {
      await salas.deleteRoom(sala).catch((e: Error) => {
        if (!naoAchou(e)) throw e;
      });
    },

    async estado(sala) {
      try {
        const p = await salas.getParticipant(sala, IDENTIDADE_LEAD);
        return lerEstado(p.attributes);
      } catch (e) {
        if (naoAchou(e as Error)) {
          const existe = await salas.listRooms([sala]).then((r) => r.length > 0);
          return existe ? 'encerrada' : null;
        }
        throw e;
      }
    },

    async testar() {
      const troncos = await sip.listSipOutboundTrunk();
      const meu = troncos.find((t) => t.sipTrunkId === cfg.troncoSaida);
      if (!meu) throw new Error(`O tronco ${cfg.troncoSaida} não existe neste projeto do LiveKit.`);
      return `ok (tronco ${meu.name || meu.sipTrunkId} → ${meu.address})`;
    },
  };
}
export * from './resumo.js';
