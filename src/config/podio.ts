// src/config/podio.ts
export const PODIO_CONFIG = {
  appId: 10094649,

  fields: {
    idExterno: "id-externo",
    nome: "title",
    email: "e-mail",
    telefone: "telefone",

    status: "status",
    areaFranquia: "area-da-franquia",
    encaminhado: "encaminhado",

    cidade: "cidade",
    codigoIbge: "codigo-ibge-2",
    estado: "categoria",

    dataContato: "data-do-contato",
    dataEvento: "data-do-evento",

    solicitacao: "solicitacao",
    historico: "historico",

    tipoEvento: "tipo-de-evento",
    perfilEvento: "perfil-do-evento-2",
    publicoQtde: "publico-do-evento-qtde-pessoas-2",
    origemContato: "origem-do-contrato",
  },

  statusValues: {
    novo: "Novo",
    encaminhado: "Encaminhado",
    incompleto: "Incompleto",
    erroTecnico: "Erro Técnico",
    abandonado: "Abandonado",
  },

  areaFranquiaValues: {
    campinas: "Franquia Campinas",
    litoralNorte: "Franquia Litoral Norte",
    rioBh: "Franquia Rio de Janeiro e BH",
  },

  origemContatoValues: {
    whatsapp: "WhatsApp",
  },
};
