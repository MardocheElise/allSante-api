import { HttpService } from "@nestjs/axios";
import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { firstValueFrom } from "rxjs";
import { AxiosError } from "axios";
import {
  chargerConfig,
  CibleAval,
  InteropConfig,
} from "../config/interop.config";
import { PrismaService } from "../prisma/prisma.service";
import {
  extrairePriseEnCharge,
  BundleInvalideError as PECInvalide,
} from "../fhir/fhir-prise-en-charge";
import {
  extraireResultats,
  BundleInvalideError as ResultatInvalide,
} from "../fhir/fhir-resultat";
import {
  validerDemandeExamen,
  BundleInvalideError as DemandeInvalide,
} from "../fhir/fhir-demande-validation";

/** Établissement authentifié par sa clé, transmis par le contrôleur. */
export interface EtablissementAppelant {
  id: string;
  code: string;
  nom: string;
}

/** Contexte réseau de l'appel, pour la piste d'audit. */
export interface ContexteRoutage {
  adresseIp?: string;
  userAgent?: string;
}

/**
 * Bus d'interopérabilité All_Santé — cœur du HUB.
 *
 * Pour chaque flux FHIR : (1) valide le Bundle via le contrat FHIR pur,
 * (2) journalise un résumé d'audit (matricule CMU = clé pivot), (3) route le
 * Bundle INTÉGRAL vers le système aval concerné avec sa clé API. AllSanté ne
 * possède aucune base : il transporte le contrat FHIR de bout en bout.
 *
 *   SGCH     → /interop/fhir/prise-en-charge → DPI
 *   DPI      → /interop/fhir/demande-examen  → OpenELIS
 *   OpenELIS → /interop/fhir/resultats       → DPI
 *
 * ─── Routage par établissement ───
 *
 * Les cibles étaient autrefois figées dans la configuration : le bus ne savait
 * router que vers UN hôpital. Un Bundle émis par l'hôpital B repartait vers le
 * DPI de l'hôpital A — un patient admis à Bouaké se retrouvait dans la file
 * d'attente d'Abidjan.
 *
 * Depuis que la garde authentifie l'appelant par sa clé, le bus lui renvoie
 * SES propres Bundles : les cibles sont lues sur l'établissement. La
 * configuration globale ne sert plus que de repli, pour les installations qui
 * n'ont pas encore déclaré leurs systèmes.
 */
@Injectable()
export class InteropService {
  private readonly logger = new Logger(InteropService.name);
  private readonly config: InteropConfig = chargerConfig();

  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
  ) {}

  /** SGCH → AllSanté → DPI : prise en charge réglée (Patient + Invoice). */
  async routerPriseEnCharge(
    bundle: unknown,
    appelant?: EtablissementAppelant,
    ctx: ContexteRoutage = {},
  ): Promise<unknown> {
    let resume;
    try {
      resume = extrairePriseEnCharge(bundle as Record<string, unknown>);
    } catch (err) {
      throw this.bundleInvalide(err, PECInvalide);
    }
    const cible = await this.cibleDpi(appelant);
    this.logger.log(
      `↘ prise-en-charge reçue de ${appelant?.code ?? "appelant non identifié"} ` +
        `(fiche ${resume.fiche.reference}, CMU ${resume.patient.matriculeCMU}) → ${cible.url}`,
    );
    return this.transmettre(
      cible,
      "/interop/fhir/prise-en-charge",
      bundle,
      `prise-en-charge ${resume.fiche.reference}`,
      {
        action: "ROUTAGE_PRISE_EN_CHARGE",
        matricule: resume.patient.matriculeCMU,
        appelant,
        ctx,
      },
    );
  }

  /** DPI → AllSanté → OpenELIS : demande d'examen (Patient + ServiceRequest). */
  async routerDemandeExamen(
    bundle: unknown,
    appelant?: EtablissementAppelant,
    ctx: ContexteRoutage = {},
  ): Promise<unknown> {
    let resume;
    try {
      resume = validerDemandeExamen(bundle as Record<string, unknown>);
    } catch (err) {
      throw this.bundleInvalide(err, DemandeInvalide);
    }
    const cible = await this.cibleOpenelis(appelant);
    this.logger.log(
      `↘ demande-examen reçue de ${appelant?.code ?? "appelant non identifié"} ` +
        `(CMU ${resume.matriculeCMU}, ${resume.numerosDemande.length} examen(s)) → ${cible.url}`,
    );
    return this.transmettre(
      cible,
      "/interop/fhir/demande-examen",
      bundle,
      `demande-examen [${resume.numerosDemande.join(", ")}]`,
      {
        action: "ROUTAGE_DEMANDE_EXAMEN",
        matricule: resume.matriculeCMU,
        appelant,
        ctx,
      },
    );
  }

  /** OpenELIS → AllSanté → DPI : résultats (DiagnosticReport + Observation). */
  async routerResultats(
    bundle: unknown,
    appelant?: EtablissementAppelant,
    ctx: ContexteRoutage = {},
  ): Promise<unknown> {
    let resume;
    try {
      resume = extraireResultats(bundle as Record<string, unknown>);
    } catch (err) {
      throw this.bundleInvalide(err, ResultatInvalide);
    }
    const cible = await this.cibleDpi(appelant);
    this.logger.log(
      `↘ resultats reçus de ${appelant?.code ?? "appelant non identifié"} ` +
        `(demande ${resume.numeroDemande}, ${resume.resultats.length} valeur(s)) → ${cible.url}`,
    );
    return this.transmettre(
      cible,
      "/interop/fhir/resultats",
      bundle,
      `resultats ${resume.numeroDemande}`,
      {
        action: "ROUTAGE_RESULTATS",
        matricule: resume.matriculeCMU,
        appelant,
        ctx,
      },
    );
  }

  // ── Résolution des cibles ─────────────────────────────────────────────────

  /**
   * Systèmes déclarés par l'établissement appelant.
   *
   * Renvoie `null` si l'appelant n'est pas identifié (clé partagée héritée) ou
   * s'il n'a rien déclaré : on retombe alors sur la configuration globale.
   */
  private async systemesDe(appelant?: EtablissementAppelant) {
    if (!appelant) return null;
    return this.prisma.etablissementNational.findUnique({
      where: { id: appelant.id },
      select: { dpiUrl: true, openelisUrl: true, cleSortante: true, code: true },
    });
  }

  private async cibleDpi(appelant?: EtablissementAppelant): Promise<CibleAval> {
    const systemes = await this.systemesDe(appelant);
    if (systemes?.dpiUrl) {
      return {
        url: systemes.dpiUrl,
        cle: systemes.cleSortante ?? this.config.dpi.cle,
      };
    }
    this.avertirRepli(appelant, "DPI");
    return this.config.dpi;
  }

  private async cibleOpenelis(
    appelant?: EtablissementAppelant,
  ): Promise<CibleAval> {
    const systemes = await this.systemesDe(appelant);
    if (systemes?.openelisUrl) {
      return {
        url: systemes.openelisUrl,
        cle: systemes.cleSortante ?? this.config.openelis.cle,
      };
    }
    this.avertirRepli(appelant, "OpenELIS");
    return this.config.openelis;
  }

  /**
   * Le repli global est dangereux dès qu'il y a plus d'un établissement : le
   * Bundle part vers l'hôpital configuré, pas vers l'émetteur. On le signale
   * bruyamment plutôt que de le laisser passer en silence.
   */
  private avertirRepli(
    appelant: EtablissementAppelant | undefined,
    systeme: string,
  ) {
    this.logger.warn(
      appelant
        ? `${appelant.code} n'a pas déclaré son ${systeme} : repli sur la cible globale. ` +
            `Renseignez ses adresses depuis le portail, sinon le Bundle partira vers un AUTRE hôpital.`
        : `Appelant non identifié (clé partagée héritée) : repli sur la cible ${systeme} globale.`,
    );
  }

  // ── Transport ─────────────────────────────────────────────────────────────

  /** POST le Bundle FHIR vers le système aval, avec sa clé API. */
  private async transmettre(
    cible: CibleAval,
    chemin: string,
    bundle: unknown,
    libelle: string,
    audit: {
      action:
        | "ROUTAGE_PRISE_EN_CHARGE"
        | "ROUTAGE_DEMANDE_EXAMEN"
        | "ROUTAGE_RESULTATS";
      matricule: string;
      appelant?: EtablissementAppelant;
      ctx: ContexteRoutage;
    },
  ): Promise<unknown> {
    const url = `${cible.url}${chemin}`;
    try {
      const reponse = await firstValueFrom(
        this.http.post(url, bundle, {
          headers: {
            "Content-Type": "application/fhir+json",
            "x-api-key": cible.cle,
          },
          timeout: this.config.timeoutMs,
        }),
      );
      this.logger.log(
        `↗ ${libelle} transmis à ${url} (HTTP ${reponse.status})`,
      );
      await this.journaliserRoutage(audit, url, true);
      return {
        ok: true,
        route: url,
        statutAval: reponse.status,
        reponseAval: reponse.data,
      };
    } catch (err) {
      const axErr = err as AxiosError;
      const motif = axErr.message ?? "Erreur inconnue";
      this.logger.error(`✗ Échec routage ${libelle} vers ${url} : ${motif}`);
      // Un échec se trace autant qu'un succès : c'est même le cas le plus
      // intéressant six mois plus tard, quand on cherche pourquoi un patient
      // n'est jamais apparu dans la file d'attente.
      await this.journaliserRoutage(audit, url, false, motif);
      // 502 Bad Gateway : AllSanté est joignable, mais le système aval a échoué.
      throw new BadRequestException({
        ok: false,
        route: url,
        motif,
        statutAval: axErr.response?.status ?? null,
      });
    }
  }

  /**
   * Inscrit le routage dans la piste d'audit nationale.
   *
   * Le bus reste sans état — il ne stocke aucune donnée de santé — mais son
   * ACTIVITÉ est tracée. Un journal qui ne consigne que les lectures
   * d'identité ne dit pas si un Bundle a été remis, ni à qui.
   *
   * Best-effort : jamais un échec d'écriture d'audit ne doit faire échouer un
   * routage qui, lui, a réussi.
   */
  private async journaliserRoutage(
    audit: {
      action:
        | "ROUTAGE_PRISE_EN_CHARGE"
        | "ROUTAGE_DEMANDE_EXAMEN"
        | "ROUTAGE_RESULTATS";
      matricule: string;
      appelant?: EtablissementAppelant;
      ctx: ContexteRoutage;
    },
    url: string,
    succes: boolean,
    motifEchec?: string,
  ) {
    try {
      // Rattachement au patient national s'il y est connu. Un Bundle peut
      // concerner un patient jamais publié au dépôt : on garde alors le
      // matricule seul, la trace reste exploitable.
      const patient = await this.prisma.patientNational.findUnique({
        where: { matricule: audit.matricule },
        select: { id: true },
      });

      await this.prisma.journalAccesNational.create({
        data: {
          action: audit.action,
          etablissementId: audit.appelant?.id ?? null,
          patientId: patient?.id ?? null,
          matricule: audit.matricule,
          ressource: url,
          succes,
          motifEchec: motifEchec ?? null,
          adresseIp: audit.ctx.adresseIp ?? null,
          userAgent: audit.ctx.userAgent ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Journalisation du routage impossible : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Transforme une erreur de validation FHIR en 400 explicite. */
  private bundleInvalide(
    err: unknown,
    type: new () => Error,
  ): BadRequestException {
    const estValidation = err instanceof type || err instanceof Error;
    const motif = err instanceof Error ? err.message : "Bundle FHIR invalide";
    this.logger.warn(`Bundle rejeté : ${motif}`);
    return new BadRequestException({
      ok: false,
      motif: estValidation ? motif : "Bundle FHIR invalide",
    });
  }
}
