import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),

  whatsapp: {
    clientsPhoneNumberId: optional("WHATSAPP_CLIENTS_PHONE_NUMBER_ID"),
    opsPhoneNumberId: optional("WHATSAPP_OPS_PHONE_NUMBER_ID"),
    accessToken: optional("WHATSAPP_ACCESS_TOKEN"),
    verifyTokenClients: optional("WHATSAPP_VERIFY_TOKEN_CLIENTS"),
    verifyTokenOps: optional("WHATSAPP_VERIFY_TOKEN_OPS"),
    appSecret: optional("WHATSAPP_APP_SECRET"),
    apiBase: "https://graph.facebook.com/v20.0",
  },

  openai: {
    apiKey: optional("OPENAI_API_KEY"),
    model: optional("OPENAI_MODEL", "gpt-4.1-mini"),
  },

  podio: {
    clientId: optional("PODIO_CLIENT_ID"),
    clientSecret: optional("PODIO_CLIENT_SECRET"),
    appIdFranqueadora: optional("PODIO_APP_ID_FRANQUEADORA"),
  },

  admin: {
    user: optional("ADMIN_USER", "admin"),
    pass: optional("ADMIN_PASS", "change_me"),
    jwtSecret: optional("JWT_SECRET", "change_me"),
  },
};
