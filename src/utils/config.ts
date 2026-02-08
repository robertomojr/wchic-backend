import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),

  whatsapp: {
    clientsPhoneNumberId: required('WHATSAPP_CLIENTS_PHONE_NUMBER_ID'),
    opsPhoneNumberId: required('WHATSAPP_OPS_PHONE_NUMBER_ID'),
    accessToken: required('WHATSAPP_ACCESS_TOKEN'),
    verifyTokenClients: required('WHATSAPP_VERIFY_TOKEN_CLIENTS'),
    verifyTokenOps: required('WHATSAPP_VERIFY_TOKEN_OPS'),
    appSecret: process.env.WHATSAPP_APP_SECRET ?? '',
    apiBase: 'https://graph.facebook.com/v20.0'
  },

  openai: {
    apiKey: required('OPENAI_API_KEY'),
    model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'
  },

  podio: {
    clientId: required('PODIO_CLIENT_ID'),
    clientSecret: required('PODIO_CLIENT_SECRET'),
    appIdFranqueadora: required('PODIO_APP_ID_FRANQUEADORA')
  },

  admin: {
    user: required('ADMIN_USER'),
    pass: required('ADMIN_PASS'),
    jwtSecret: process.env.JWT_SECRET ?? 'change_me'
  }
};
