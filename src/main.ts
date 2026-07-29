import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { json } from 'express';
import { AppModule } from './app.module';
import { chargerConfig } from './config/interop.config';

async function bootstrap() {
  // bodyParser désactivé : on installe un parser JSON qui accepte AUSSI le
  // media-type FHIR (application/fhir+json) émis par les systèmes partenaires.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ type: ['application/json', 'application/fhir+json'] }));

  // CORS pour le PORTAIL uniquement : le site vitrine est un navigateur, donc
  // soumis à la politique d'origine. Les appels au dépôt national viennent de
  // serveurs hospitaliers, qui ne sont pas concernés par le CORS.
  //
  // En production, renseigner SITE_URL avec l'URL réelle du site : laisser
  // une liste ouverte reviendrait à autoriser n'importe quelle page web à
  // solliciter le portail avec les jetons de session de vos utilisateurs.
  const originesAutorisees = (
    process.env.SITE_URL ?? 'http://localhost:3030'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: originesAutorisees,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const config = chargerConfig();
  await app.listen(config.port, '0.0.0.0');

  const logger = new Logger('AllSanté');
  logger.log(`All_Santé à l'écoute sur le port ${config.port}`);
  logger.log(`DPI aval        : ${config.dpi.url}`);
  logger.log(`OpenELIS aval   : ${config.openelis.url}`);
  logger.log(`Portail (CORS)  : ${originesAutorisees.join(', ')}`);

  if ((process.env.INTEROP_ALLOW_LEGACY_KEY ?? 'true').toLowerCase() === 'true') {
    logger.warn(
      "Clé partagée héritée ACCEPTÉE : l'établissement appelant n'est pas prouvé. " +
        'Passez INTEROP_ALLOW_LEGACY_KEY=false avant toute mise en ligne.',
    );
  }
}
void bootstrap();
