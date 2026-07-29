import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiKeyGuard, RequeteAuthentifiee } from "../common/api-key.guard";
import { ContexteRoutage, InteropService } from "./interop.service";

/**
 * Points d'entrée du bus d'interopérabilité All_Santé.
 *
 * Tous les appels sont serveur-à-serveur et authentifiés par ApiKeyGuard
 * (en-tête x-api-key). Les chemins reprennent EXACTEMENT ceux documentés sur le
 * site vitrine et déjà attendus par le DPI et OpenELIS, afin qu'AllSanté puisse
 * s'intercaler sans modifier les systèmes existants.
 *
 * L'établissement AUTHENTIFIÉ est transmis au service : c'est lui qui
 * détermine vers quels systèmes le Bundle repart, et c'est lui qui apparaît
 * dans la piste d'audit. Sans cela, un Bundle émis par l'hôpital B serait
 * routé vers le DPI de l'hôpital A.
 */
@Controller("interop/fhir")
@UseGuards(ApiKeyGuard)
export class InteropController {
  constructor(private readonly interop: InteropService) {}

  /** SGCH → AllSanté → DPI. Bundle Patient + Invoice. */
  @Post("prise-en-charge")
  @HttpCode(200)
  priseEnCharge(@Body() bundle: unknown, @Req() req: RequeteAuthentifiee) {
    return this.interop.routerPriseEnCharge(
      bundle,
      req.etablissementAuth,
      this.contexte(req),
    );
  }

  /** DPI → AllSanté → OpenELIS. Bundle Patient + ServiceRequest. */
  @Post("demande-examen")
  @HttpCode(200)
  demandeExamen(@Body() bundle: unknown, @Req() req: RequeteAuthentifiee) {
    return this.interop.routerDemandeExamen(
      bundle,
      req.etablissementAuth,
      this.contexte(req),
    );
  }

  /** OpenELIS → AllSanté → DPI. Bundle DiagnosticReport + Observation. */
  @Post("resultats")
  @HttpCode(200)
  resultats(@Body() bundle: unknown, @Req() req: RequeteAuthentifiee) {
    return this.interop.routerResultats(
      bundle,
      req.etablissementAuth,
      this.contexte(req),
    );
  }

  /** Origine réseau de l'appel, reportée dans la piste d'audit. */
  private contexte(req: RequeteAuthentifiee): ContexteRoutage {
    return {
      adresseIp: req.ip ?? req.socket?.remoteAddress ?? undefined,
      userAgent: (req.headers["user-agent"] as string) || undefined,
    };
  }
}
