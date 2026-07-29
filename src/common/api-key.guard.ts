import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { chargerConfig } from "../config/interop.config";

/** Requête enrichie de l'établissement AUTHENTIFIÉ (et non déclaré). */
export interface RequeteAuthentifiee extends Request {
  etablissementAuth?: {
    id: string;
    code: string;
    nom: string;
    cleId: string;
  };
}

/**
 * Garde d'interopérabilité : authentifie les appels serveur-à-serveur entrants
 * par la clé API transmise dans l'en-tête `x-api-key`.
 *
 * ─── Ce qui a changé, et pourquoi cela compte ───
 *
 * La garde comparait autrefois la clé reçue à une clé UNIQUE partagée par tous
 * les établissements. L'en-tête `x-etablissement` était alors purement
 * déclaratif : n'importe quel détenteur de la clé pouvait publier au nom de
 * n'importe quel hôpital, et une ligne de journal affirmant « le CHR de Bouaké
 * a ouvert ce dossier » ne prouvait rien.
 *
 * Désormais la garde hache la clé présentée et résout l'établissement à qui
 * elle appartient. L'appelant ne déclare plus son identité : il la PROUVE.
 * L'établissement résolu est attaché à la requête, et c'est LUI qui est
 * journalisé — pas ce que l'en-tête prétend.
 *
 * La clé partagée reste acceptée en développement, pour ne pas casser les
 * scénarios locaux. Voir INTEROP_ALLOW_LEGACY_KEY.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly cleHeritee = chargerConfig().cleEntrante;

  /**
   * Autorise la clé unique historique. À passer à `false` en production :
   * elle contourne toute l'authentification par établissement.
   */
  private readonly accepteCleHeritee =
    (process.env.INTEROP_ALLOW_LEGACY_KEY ?? "true").toLowerCase() === "true";

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requete = context.switchToHttp().getRequest<RequeteAuthentifiee>();

    const fournie =
      (requete.headers["x-api-key"] as string | undefined) ??
      (requete.headers["X-Api-Key"] as string | undefined);

    if (!fournie) {
      throw new UnauthorizedException("Clé API manquante (en-tête x-api-key)");
    }

    // 1. Clé propre à un établissement — le cas nominal.
    const empreinte = createHash("sha256").update(fournie).digest("hex");
    const cle = await this.prisma.cleApi.findUnique({
      where: { empreinte },
      include: { etablissement: true },
    });

    if (cle) {
      if (cle.revoqueeLe) {
        this.logger.warn(
          `Clé révoquée présentée par ${cle.etablissement.code} (${cle.prefixe}…)`,
        );
        throw new UnauthorizedException("Clé API révoquée");
      }
      if (!cle.etablissement.actif) {
        throw new UnauthorizedException(
          `Établissement ${cle.etablissement.code} désactivé`,
        );
      }

      requete.etablissementAuth = {
        id: cle.etablissement.id,
        code: cle.etablissement.code,
        nom: cle.etablissement.nom,
        cleId: cle.id,
      };

      // Trace de vie de la clé : sert à repérer une clé oubliée, et à
      // vérifier qu'une rotation est achevée avant de révoquer l'ancienne.
      // Best-effort : l'appel métier ne doit pas échouer pour si peu.
      this.prisma.cleApi
        .update({
          where: { id: cle.id },
          data: { dernierUsageLe: new Date() },
        })
        .catch(() => undefined);

      return true;
    }

    // 2. Repli sur la clé unique héritée — développement seulement.
    if (this.accepteCleHeritee && fournie === this.cleHeritee) {
      this.logger.warn(
        "Appel authentifié par la CLÉ PARTAGÉE héritée : l'établissement n'est pas prouvé. " +
          "Passez INTEROP_ALLOW_LEGACY_KEY=false en production.",
      );
      return true;
    }

    throw new UnauthorizedException("Clé API invalide");
  }
}
