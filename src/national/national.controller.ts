import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard, RequeteAuthentifiee } from '../common/api-key.guard';
import { ContexteAppel, NationalService } from './national.service';

/**
 * Dépôt national All_Santé — API d'identité et d'historique partagé.
 *
 * Authentification serveur-à-serveur par `x-api-key`. La clé identifie
 * l'établissement appelant : il n'a plus à se déclarer, il est reconnu. Le
 * code résolu alimente la piste d'audit et le filtrage de l'historique externe.
 *
 *   GET  /national/patients/:matricule                → identité pivot (SGCH)
 *   GET  /national/patients/:matricule/consultations  → historique (DPI)
 *   POST /national/patients                           → publication d'identité (SGCH)
 *   POST /national/consultations                      → publication clinique (DPI)
 */
@Controller('national')
@UseGuards(ApiKeyGuard)
export class NationalController {
  constructor(private readonly national: NationalService) {}

  /** SGCH : recherche d'identité dès la saisie des 13 chiffres du matricule. */
  @Get('patients/:matricule')
  consulterIdentite(
    @Param('matricule') matricule: string,
    @Req() req: RequeteAuthentifiee,
  ) {
    return this.national.consulterIdentite(matricule, this.contexte(req));
  }

  /** DPI : historique clinique consolidé, hors établissement appelant. */
  @Get('patients/:matricule/consultations')
  consulterHistorique(
    @Param('matricule') matricule: string,
    @Query('limite') limite: string | undefined,
    @Query('exclureEtablissement') exclureEtablissement: string | undefined,
    @Req() req: RequeteAuthentifiee,
  ) {
    return this.national.consulterHistorique(
      matricule,
      {
        limite: limite ? Number.parseInt(limite, 10) : undefined,
        exclureEtablissement: exclureEtablissement || undefined,
      },
      this.contexte(req),
    );
  }

  /** SGCH : publication (upsert) de l'identité après création du patient. */
  @Post('patients')
  @HttpCode(200)
  publierIdentite(@Body() payload: unknown, @Req() req: RequeteAuthentifiee) {
    return this.national.publierIdentite(payload, this.contexte(req));
  }

  /**
   * DPI : publication (upsert) d'une consultation clôturée.
   *
   * Le bloc `consentement` est OBLIGATOIRE. Sans accord du patient, l'API
   * refuse tout contenu clinique (400) et n'enregistre qu'un marqueur.
   */
  @Post('consultations')
  @HttpCode(200)
  publierConsultation(@Body() payload: unknown, @Req() req: RequeteAuthentifiee) {
    return this.national.publierConsultation(payload, this.contexte(req));
  }

  /** Le patient revient sur son accord : purge du contenu clinique. */
  @Delete('consultations/:id')
  @HttpCode(200)
  revoquerConsultation(
    @Param('id') id: string,
    @Query('motif') motif: string | undefined,
    @Req() req: RequeteAuthentifiee,
  ) {
    return this.national.revoquerConsultation(id, motif, this.contexte(req));
  }

  // ─── Socle vital ───────────────────────────────────────────────────────────

  /** Urgences : groupe sanguin, allergies, traitements au long cours. */
  @Get('patients/:matricule/socle-vital')
  consulterSocleVital(
    @Param('matricule') matricule: string,
    @Req() req: RequeteAuthentifiee,
  ) {
    return this.national.consulterSocleVital(matricule, this.contexte(req));
  }

  @Post('patients/:matricule/allergies')
  @HttpCode(200)
  publierAllergie(
    @Param('matricule') matricule: string,
    @Body() payload: unknown,
    @Req() req: RequeteAuthentifiee,
  ) {
    return this.national.publierAllergie(
      matricule,
      payload,
      this.contexte(req),
    );
  }

  @Post('patients/:matricule/traitements-chroniques')
  @HttpCode(200)
  publierTraitementChronique(
    @Param('matricule') matricule: string,
    @Body() payload: unknown,
    @Req() req: RequeteAuthentifiee,
  ) {
    return this.national.publierTraitementChronique(
      matricule,
      payload,
      this.contexte(req),
    );
  }

  // ─── Préférences de partage du patient ─────────────────────────────────────

  /**
   * Accord durable, ou opposition au socle vital.
   *
   * Appelable par un agent d'accueil comme par un praticien : le canal
   * principal reste le formulaire papier saisi au guichet, pas un portail web.
   */
  @Put('patients/:matricule/preferences')
  @HttpCode(200)
  majPreferences(
    @Param('matricule') matricule: string,
    @Body() payload: unknown,
    @Req() req: RequeteAuthentifiee,
  ) {
    return this.national.majPreferences(matricule, payload, this.contexte(req));
  }

  /**
   * Reconstitue le contexte d'appel pour la piste d'audit.
   *
   * L'établissement AUTHENTIFIÉ par la clé prime toujours sur l'en-tête
   * `x-etablissement`, qui n'est qu'une déclaration de l'appelant. C'est ce
   * qui rend le journal d'accès opposable : on trace qui a prouvé son
   * identité, pas qui prétend l'avoir.
   */
  private contexte(req: RequeteAuthentifiee): ContexteAppel {
    const declare = (req.headers['x-etablissement'] as string) || undefined;
    return {
      // L'identité prouvée par la clé d'abord ; l'en-tête n'est qu'un repli
      // pour les scénarios locaux encore sur la clé partagée héritée.
      codeEtablissement: req.etablissementAuth?.code ?? declare,
      adresseIp: req.ip ?? req.socket?.remoteAddress ?? undefined,
      userAgent: (req.headers['user-agent'] as string) || undefined,
    };
  }
}
