import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
// Le type d'action d'audit vient du schéma Prisma, jamais d'une liste
// recopiée à la main : une union locale finirait tôt ou tard désynchronisée
// de l'enum, et le compilateur ne le verrait qu'à l'usage.
import type { ActionNationale } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  PayloadInvalideError,
  PublierConsultationDTO,
  PublierIdentiteDTO,
  normaliserMatricule,
  validerAllergie,
  validerConsultation,
  validerIdentite,
  validerPreferences,
  validerTraitementChronique,
} from "./dto/national.dto";

/** Contexte d'appel, reconstitué depuis les en-têtes HTTP pour la traçabilité. */
export interface ContexteAppel {
  codeEtablissement?: string;
  adresseIp?: string;
  userAgent?: string;
}

/**
 * Dépôt national All_Santé.
 *
 * Second rôle d'All_Santé, à côté du bus FHIR : conserver l'identité pivot et
 * le condensé clinique de chaque patient, pour qu'un établissement puisse
 * reconnaître un patient qu'il n'a jamais vu et lire son historique externe.
 *
 * Deux invariants tenus par ce service :
 *   1. TOUTE opération est journalisée (`journaux_acces_national`), y compris
 *      les recherches infructueuses et les refus.
 *   2. TOUTE écriture est idempotente : republier la même identité ou la même
 *      consultation met à jour, ne duplique jamais.
 */
@Injectable()
export class NationalService {
  private readonly logger = new Logger(NationalService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Lecture : identité ────────────────────────────────────────────────────

  /**
   * Recherche un patient par matricule CMU dans le dépôt national.
   * Appelé par SGCH dès que les 13 chiffres sont saisis à l'admission.
   */
  async consulterIdentite(matriculeBrut: string, ctx: ContexteAppel) {
    const matricule = this.matricule(matriculeBrut);
    const etablissement = await this.resoudreEtablissement(ctx);

    const patient = await this.prisma.patientNational.findUnique({
      where: { matricule },
      include: { etablissementOrigine: true },
    });

    await this.journaliser({
      action: "LECTURE_IDENTITE",
      etablissementId: etablissement?.id,
      patientId: patient?.id,
      matricule,
      ressource: `patients/${matricule}`,
      succes: !!patient,
      motifEchec: patient ? undefined : "Matricule inconnu du dépôt national",
      ctx,
    });

    if (!patient) {
      throw new NotFoundException(
        `Aucun patient au matricule ${matricule} dans le dépôt national`,
      );
    }

    this.logger.log(
      `↗ identité servie : ${matricule} → ${ctx.codeEtablissement ?? "établissement inconnu"}`,
    );

    return {
      matricule: patient.matricule,
      nom: patient.nom,
      prenom: patient.prenom,
      genre: patient.genre,
      dateNaissance: patient.dateNaissance.toISOString().slice(0, 10),
      contact: patient.contact,
      email: patient.email,
      adresse: patient.adresse,
      villeCommune: patient.villeCommune,
      nationalite: patient.nationalite,
      profession: patient.profession,
      situationMatrimoniale: patient.situationMatrimoniale,
      groupeSanguin: patient.groupeSanguin,
      assuranceNom: patient.assuranceNom,
      assuranceNumero: patient.assuranceNumero,
      etablissementOrigine: patient.etablissementOrigine
        ? {
            code: patient.etablissementOrigine.code,
            nom: patient.etablissementOrigine.nom,
          }
        : null,

      // Préférences de partage — le DPI les lit pour savoir s'il doit
      // redemander son accord au patient à chaque consultation, ou non.
      partageDurable: patient.partageDurable,
      oppositionSocleVital: patient.oppositionSocleVital,

      misAJourLe: patient.updatedAt.toISOString(),
    };
  }

  // ─── Lecture : historique clinique ─────────────────────────────────────────

  /**
   * Historique consolidé des consultations d'un patient.
   * @param exclureEtablissement code établissement à retirer du résultat — le
   *   DPI appelant l'utilise pour n'obtenir que l'historique EXTERNE, puisqu'il
   *   possède déjà ses propres consultations en local.
   */
  async consulterHistorique(
    matriculeBrut: string,
    options: { limite?: number; exclureEtablissement?: string },
    ctx: ContexteAppel,
  ) {
    const matricule = this.matricule(matriculeBrut);
    const etablissement = await this.resoudreEtablissement(ctx);
    const limite = Math.min(Math.max(options.limite ?? 20, 1), 100);

    const patient = await this.prisma.patientNational.findUnique({
      where: { matricule },
      select: { id: true, matricule: true, nom: true, prenom: true },
    });

    if (!patient) {
      await this.journaliser({
        action: "LECTURE_HISTORIQUE",
        etablissementId: etablissement?.id,
        matricule,
        ressource: `patients/${matricule}/consultations`,
        succes: false,
        motifEchec: "Matricule inconnu du dépôt national",
        ctx,
      });
      throw new NotFoundException(
        `Aucun patient au matricule ${matricule} dans le dépôt national`,
      );
    }

    const filtreEtablissement = options.exclureEtablissement
      ? { etablissementSource: { code: { not: options.exclureEtablissement } } }
      : {};

    const consultations = await this.prisma.consultationNationale.findMany({
      where: {
        patientId: patient.id,
        // Seuls les épisodes consentis sont lisibles. Le reste n'a de toute
        // façon aucun contenu à servir : il n'a jamais été écrit.
        partage: true,
        ...filtreEtablissement,
      },
      orderBy: { dateConsultation: "desc" },
      take: limite,
      include: {
        etablissementSource: { select: { code: true, nom: true, ville: true } },
        prescriptions: true,
        resultats: { orderBy: { dateResultat: "desc" } },
      },
    });

    // Signalement des éléments non partagés — VISIBLE MAIS MUET.
    //
    // Le médecin doit savoir qu'il ne voit pas tout : sans cela il pourrait
    // engager une décision lourde en croyant disposer d'une vue complète.
    // Mais on ne renvoie qu'un BOOLÉEN : ni comptage, ni date, ni
    // établissement, ni nature. Un nombre et une date suffiraient souvent à
    // deviner la pathologie.
    //
    // L'étage CHARGE_SOCIALE est exclu du décompte : pour ces données,
    // l'existence même d'un secret est une information qui ne doit pas fuir.
    const nonPartages = await this.prisma.consultationNationale.count({
      where: {
        patientId: patient.id,
        partage: false,
        etage: { not: "CHARGE_SOCIALE" },
        ...filtreEtablissement,
      },
    });
    const elementsNonPartages = nonPartages > 0;

    await this.journaliser({
      action: "LECTURE_HISTORIQUE",
      etablissementId: etablissement?.id,
      patientId: patient.id,
      matricule,
      ressource: `patients/${matricule}/consultations`,
      succes: true,
      ctx,
    });

    this.logger.log(
      `↗ historique servi : ${matricule} — ${consultations.length} consultation(s) → ${ctx.codeEtablissement ?? "établissement inconnu"}`,
    );

    return {
      matricule: patient.matricule,
      patient: { nom: patient.nom, prenom: patient.prenom },
      nombre: consultations.length,

      /**
       * Vrai s'il existe des épisodes que le patient n'a pas voulu partager.
       * Booléen SEUL, volontairement : le praticien sait qu'il doit interroger
       * son patient, il n'apprend rien du contenu.
       */
      elementsNonPartages,
      messageNonPartages: elementsNonPartages
        ? "Ce patient a choisi de ne pas partager certains éléments de son dossier. Interrogez-le avant toute décision engageante."
        : null,

      consultations: consultations.map((c) => ({
        id: c.id,
        dateConsultation: c.dateConsultation!.toISOString(),
        etablissement: {
          code: c.etablissementSource.code,
          nom: c.etablissementSource.nom,
          ville: c.etablissementSource.ville,
        },
        motif: c.motif,
        professionnel: c.professionnel,
        specialite: c.specialite,
        typeVisite: c.typeVisite,
        statut: c.statut,
        diagnosticRetenu: c.diagnosticRetenu,
        codeCim10: c.codeCim10,
        syntheseClinique: c.syntheseClinique,
        conduiteATenir: c.conduiteATenir,
        prescriptions: c.prescriptions.map((p) => ({
          medicament: p.medicament,
          dci: p.dci,
          dosage: p.dosage,
          posologie: p.posologie,
          voie: p.voie,
          dureeJours: p.dureeJours,
          instructions: p.instructions,
        })),
        resultats: c.resultats.map((r) => ({
          libelle: r.libelle,
          categorie: r.categorie,
          valeur: r.valeur,
          unite: r.unite,
          valeurNormale: r.valeurNormale,
          interpretation: r.interpretation,
          anormal: r.anormal,
          dateResultat: r.dateResultat?.toISOString() ?? null,
        })),
        publieLe: c.publieLe.toISOString(),
      })),
    };
  }

  // ─── Écriture : identité ───────────────────────────────────────────────────

  /** Upsert d'identité par matricule (SGCH → national), idempotent. */
  async publierIdentite(brut: unknown, ctx: ContexteAppel) {
    const dto = this.valider(() => validerIdentite(brut));
    const etablissement = await this.resoudreEtablissement(ctx);

    const donnees = this.versDonneesPatient(dto, etablissement?.id);

    const patient = await this.prisma.patientNational.upsert({
      where: { matricule: dto.matricule },
      create: donnees,
      update: {
        ...donnees,
        // L'établissement d'origine est celui du PREMIER enregistrement :
        // une republication ne le réécrit pas.
        etablissementOrigineId: undefined,
      },
    });

    await this.journaliser({
      action: "PUBLICATION_IDENTITE",
      etablissementId: etablissement?.id,
      patientId: patient.id,
      matricule: patient.matricule,
      ressource: `patients/${patient.matricule}`,
      succes: true!,
      ctx,
    });

    this.logger.log(
      `↘ identité publiée : ${patient.matricule} par ${ctx.codeEtablissement ?? "établissement inconnu"}`,
    );

    return { ok: true, matricule: patient.matricule, id: patient.id };
  }

  // ─── Écriture : consultation ───────────────────────────────────────────────

  /**
   * Upsert d'une consultation par (établissement source, référence locale).
   * Appelé par le DPI à la clôture d'une consultation, diagnostic validé.
   */
  async publierConsultation(brut: unknown, ctx: ContexteAppel) {
    const dto = this.valider(() => validerConsultation(brut));
    const etablissement = await this.resoudreEtablissement(ctx);

    if (!etablissement) {
      throw new BadRequestException(
        "En-tête x-etablissement manquant ou établissement inconnu : impossible de publier une consultation sans source identifiée",
      );
    }

    const patient = await this.trouverOuCreerPatient(dto, etablissement.id);
    const accorde = dto.consentement.accorde;

    // Deux écritures très différentes derrière le même endpoint :
    //   • accord    -> l'épisode complet est conservé ;
    //   • refus     -> un MARQUEUR seul, sans aucun champ clinique. Ce n'est
    //     pas du masquage en lecture : la donnée n'est jamais écrite.
    const donneesConsultation = accorde
      ? {
          patientId: patient.id,
          etablissementSourceId: etablissement.id,
          referenceLocale: dto.referenceLocale,
          partage: true,
          etage: dto.etage ?? "EPISODE_SOIN",
          dateConsultation: new Date(dto.dateConsultation!),
          motif: dto.motif!,
          professionnel: dto.professionnel!,
          specialite: dto.specialite ?? null,
          typeVisite: dto.typeVisite ?? null,
          statut: dto.statut ?? "TERMINEE",
          diagnosticRetenu: dto.diagnosticRetenu ?? null,
          codeCim10: dto.codeCim10 ?? null,
          syntheseClinique: dto.syntheseClinique ?? null,
          conduiteATenir: dto.conduiteATenir ?? null,
          revoqueeLe: null,
          motifRevocation: null,
        }
      : {
          patientId: patient.id,
          etablissementSourceId: etablissement.id,
          referenceLocale: dto.referenceLocale,
          partage: false,
          etage: dto.etage ?? "EPISODE_SOIN",
          // Tout le contenu clinique reste NULL, y compris la date : une date
          // et un établissement suffisent parfois à deviner la pathologie.
          dateConsultation: null,
          motif: null,
          professionnel: null,
          specialite: null,
          typeVisite: null,
          diagnosticRetenu: null,
          codeCim10: null,
          syntheseClinique: null,
          conduiteATenir: null,
        };

    // Transaction : la republication remplace intégralement les lignes filles,
    // ce qui évite les doublons de prescriptions lors d'une correction, et
    // purge le contenu si le patient revient sur son accord.
    const consultation = await this.prisma.$transaction(async (tx) => {
      const cle = {
        etablissementSourceId_referenceLocale: {
          etablissementSourceId: etablissement.id,
          referenceLocale: dto.referenceLocale,
        },
      };

      const existante = await tx.consultationNationale.findUnique({
        where: cle,
        select: { id: true },
      });

      if (existante) {
        await tx.prescriptionNationale.deleteMany({
          where: { consultationId: existante.id },
        });
        await tx.resultatExamenNational.deleteMany({
          where: { consultationId: existante.id },
        });
      }

      const lignesFilles = accorde
        ? {
            prescriptions: { create: this.versPrescriptions(dto) },
            resultats: { create: this.versResultats(dto) },
          }
        : {};

      const enregistree = await tx.consultationNationale.upsert({
        where: cle,
        create: { ...donneesConsultation, ...lignesFilles },
        update: { ...donneesConsultation, ...lignesFilles },
        select: { id: true, referenceLocale: true },
      });

      // La trace du consentement est écrite dans la MÊME transaction que la
      // donnée qu'elle autorise : jamais l'une sans l'autre.
      await tx.consentementPublication.create({
        data: {
          patientId: patient.id,
          consultationId: enregistree.id,
          etablissementId: etablissement.id,
          accorde,
          portee: dto.consentement.portee ?? "CONSULTATION_UNIQUE",
          support: dto.consentement.support ?? "ORAL_TRACE_DPI",
          etages: dto.consentement.etages ?? ["EPISODE_SOIN"],
          recueilliPar: dto.consentement.recueilliPar,
          recueilliLe: new Date(
            dto.consentement.recueilliLe ?? new Date().toISOString(),
          ),
          preuve: dto.consentement.preuve ?? null,
        },
      });

      // Un accord DURABLE évite de reposer la question à chaque passage. Le
      // DPI le lit via l'endpoint d'identité pour savoir s'il doit redemander.
      if (accorde && dto.consentement.portee === "DURABLE") {
        await tx.patientNational.update({
          where: { id: patient.id },
          data: { partageDurable: true, partageDurableDepuis: new Date() },
        });
      }

      return enregistree;
    });

    await this.journaliser({
      action: "PUBLICATION_CONSULTATION",
      etablissementId: etablissement.id,
      patientId: patient.id,
      matricule: dto.matricule,
      ressource: `consultations/${consultation.id}`,
      succes: true,
      motifEchec: accorde ? undefined : "Publication refusée par le patient",
      ctx,
    });

    this.logger.log(
      accorde
        ? `↘ consultation publiée : ${dto.referenceLocale} (patient ${dto.matricule}) par ${etablissement.code}`
        : `↘ marqueur enregistré SANS contenu : ${dto.referenceLocale} — le patient ${dto.matricule} n'a pas consenti`,
    );

    return {
      ok: true,
      id: consultation.id,
      referenceLocale: consultation.referenceLocale,
      matricule: dto.matricule,
      partage: accorde,
      message: accorde
        ? "Épisode de soin publié au dépôt national."
        : "Refus du patient enregistré : aucun contenu clinique n'a été conservé.",
    };
  }

  // ─── Révocation ────────────────────────────────────────────────────────────

  /**
   * Le patient revient sur son accord : le contenu clinique est purgé et la
   * consultation redevient un simple marqueur.
   *
   * On ne peut pas rappeler ce qu'un autre établissement a déjà lu — mais on
   * le consigne, et le journal d'accès permet au patient de savoir qui a vu
   * quoi avant la révocation.
   */
  async revoquerConsultation(
    consultationId: string,
    motif: string | undefined,
    ctx: ContexteAppel,
  ) {
    const etablissement = await this.resoudreEtablissement(ctx);

    const consultation = await this.prisma.consultationNationale.findUnique({
      where: { id: consultationId },
      include: { patient: { select: { id: true, matricule: true } } },
    });

    if (!consultation) {
      throw new NotFoundException(`Consultation ${consultationId} introuvable`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.prescriptionNationale.deleteMany({
        where: { consultationId: consultation.id },
      });
      await tx.resultatExamenNational.deleteMany({
        where: { consultationId: consultation.id },
      });
      await tx.consultationNationale.update({
        where: { id: consultation.id },
        data: {
          partage: false,
          dateConsultation: null,
          motif: null,
          professionnel: null,
          specialite: null,
          typeVisite: null,
          diagnosticRetenu: null,
          codeCim10: null,
          syntheseClinique: null,
          conduiteATenir: null,
          revoqueeLe: new Date(),
          motifRevocation: motif ?? "Révocation à la demande du patient",
        },
      });
      await tx.consentementPublication.updateMany({
        where: { consultationId: consultation.id, revoqueLe: null },
        data: {
          revoqueLe: new Date(),
          revoquePar: ctx.codeEtablissement ?? "inconnu",
        },
      });
    });

    await this.journaliser({
      action: "REVOCATION_CONSULTATION",
      etablissementId: etablissement?.id,
      patientId: consultation.patient.id,
      matricule: consultation.patient.matricule,
      ressource: `consultations/${consultation.id}`,
      succes: true,
      ctx,
    });

    this.logger.log(
      `↘ consultation révoquée : ${consultation.id} (patient ${consultation.patient.matricule})`,
    );

    return {
      ok: true,
      id: consultation.id,
      message:
        "Contenu clinique purgé du dépôt national. Les lectures antérieures restent consultables dans le journal d'accès.",
    };
  }

  // ─── Socle vital ───────────────────────────────────────────────────────────

  /**
   * Le socle vital : ce qui sauve une vie quand le patient ne peut pas parler.
   *
   * Groupe sanguin, allergies, traitements au long cours. Publié par défaut —
   * une allergie à la pénicilline n'a aucune charge sociale, la ranger avec le
   * diagnostic psychiatrique annulerait le bénéfice du dépôt sans protéger
   * personne. Le patient garde le droit de s'y opposer.
   */
  async consulterSocleVital(matriculeBrut: string, ctx: ContexteAppel) {
    const matricule = this.matricule(matriculeBrut);
    const etablissement = await this.resoudreEtablissement(ctx);

    const patient = await this.prisma.patientNational.findUnique({
      where: { matricule },
      include: {
        allergies: { where: { active: true }, orderBy: { declareeLe: "desc" } },
        traitementsChroniques: {
          where: { actif: true },
          orderBy: { declareLe: "desc" },
        },
      },
    });

    await this.journaliser({
      action: "LECTURE_SOCLE_VITAL",
      etablissementId: etablissement?.id,
      patientId: patient?.id,
      matricule,
      ressource: `patients/${matricule}/socle-vital`,
      succes: !!patient,
      motifEchec: patient ? undefined : "Matricule inconnu du dépôt national",
      ctx,
    });

    if (!patient) {
      throw new NotFoundException(
        `Aucun patient au matricule ${matricule} dans le dépôt national`,
      );
    }

    // Opposition du patient : on ne sert rien, et on le dit franchement. Le
    // praticien doit savoir que le silence est un choix, pas une absence de
    // données — la différence est vitale en réanimation.
    if (patient.oppositionSocleVital) {
      return {
        matricule: patient.matricule,
        oppositionPatient: true,
        message:
          "Ce patient s'est opposé au partage de son socle vital. Aucune donnée n'est disponible : interrogez-le ou son entourage.",
        groupeSanguin: null,
        allergies: [],
        traitementsChroniques: [],
      };
    }

    return {
      matricule: patient.matricule,
      patient: {
        nom: patient.nom,
        prenom: patient.prenom,
        genre: patient.genre,
        dateNaissance: patient.dateNaissance.toISOString().slice(0, 10),
        contact: patient.contact,
      },
      oppositionPatient: false,
      groupeSanguin: patient.groupeSanguin,
      allergies: patient.allergies.map((a) => ({
        libelle: a.libelle,
        type: a.type,
        severite: a.severite,
        reaction: a.reaction,
        declareeLe: a.declareeLe.toISOString(),
      })),
      traitementsChroniques: patient.traitementsChroniques.map((t) => ({
        medicament: t.medicament,
        dci: t.dci,
        dosage: t.dosage,
        posologie: t.posologie,
        indication: t.indication,
        debutLe: t.debutLe?.toISOString() ?? null,
      })),
    };
  }

  /** Déclaration d'une allergie (socle vital), idempotente par référence locale. */
  async publierAllergie(
    matriculeBrut: string,
    brut: unknown,
    ctx: ContexteAppel,
  ) {
    const matricule = this.matricule(matriculeBrut);
    const dto = this.valider(() => validerAllergie(brut));
    const etablissement = await this.exigerEtablissement(ctx);
    const patient = await this.exigerPatient(matricule);

    const donnees = {
      patientId: patient.id,
      etablissementSourceId: etablissement.id,
      referenceLocale: dto.referenceLocale,
      libelle: dto.libelle,
      type: dto.type ?? null,
      severite: dto.severite ?? null,
      reaction: dto.reaction ?? null,
      active: dto.active ?? true,
    };

    const allergie = await this.prisma.allergieNationale.upsert({
      where: {
        etablissementSourceId_referenceLocale: {
          etablissementSourceId: etablissement.id,
          referenceLocale: dto.referenceLocale,
        },
      },
      create: donnees,
      update: donnees,
      select: { id: true },
    });

    await this.journaliser({
      action: "PUBLICATION_SOCLE_VITAL",
      etablissementId: etablissement.id,
      patientId: patient.id,
      matricule,
      ressource: `patients/${matricule}/allergies/${allergie.id}`,
      succes: true,
      ctx,
    });

    this.logger.log(
      `↘ allergie publiée : « ${dto.libelle} » pour ${matricule} par ${etablissement.code}`,
    );
    return { ok: true, id: allergie.id, matricule };
  }

  /** Déclaration d'un traitement au long cours (socle vital). */
  async publierTraitementChronique(
    matriculeBrut: string,
    brut: unknown,
    ctx: ContexteAppel,
  ) {
    const matricule = this.matricule(matriculeBrut);
    const dto = this.valider(() => validerTraitementChronique(brut));
    const etablissement = await this.exigerEtablissement(ctx);
    const patient = await this.exigerPatient(matricule);

    const donnees = {
      patientId: patient.id,
      etablissementSourceId: etablissement.id,
      referenceLocale: dto.referenceLocale,
      medicament: dto.medicament,
      dci: dto.dci ?? null,
      dosage: dto.dosage ?? null,
      posologie: dto.posologie ?? null,
      indication: dto.indication ?? null,
      debutLe: dto.debutLe ? new Date(dto.debutLe) : null,
      finLe: dto.finLe ? new Date(dto.finLe) : null,
      actif: dto.actif ?? true,
    };

    const traitement = await this.prisma.traitementChroniqueNational.upsert({
      where: {
        etablissementSourceId_referenceLocale: {
          etablissementSourceId: etablissement.id,
          referenceLocale: dto.referenceLocale,
        },
      },
      create: donnees,
      update: donnees,
      select: { id: true },
    });

    await this.journaliser({
      action: "PUBLICATION_SOCLE_VITAL",
      etablissementId: etablissement.id,
      patientId: patient.id,
      matricule,
      ressource: `patients/${matricule}/traitements-chroniques/${traitement.id}`,
      succes: true,
      ctx,
    });

    this.logger.log(
      `↘ traitement chronique publié : « ${dto.medicament} » pour ${matricule} par ${etablissement.code}`,
    );
    return { ok: true, id: traitement.id, matricule };
  }

  // ─── Préférences de partage ────────────────────────────────────────────────

  /**
   * Met à jour les préférences durables du patient.
   *
   * Appelable par un agent d'accueil ou un praticien, pas seulement par le
   * patient lui-même : concevoir uniquement pour un portail web reviendrait à
   * réserver le droit à la confidentialité à ceux qui ont un smartphone.
   */
  async majPreferences(matriculeBrut: string, brut: unknown, ctx: ContexteAppel) {
    const matricule = this.matricule(matriculeBrut);
    const dto = this.valider(() => validerPreferences(brut));
    const etablissement = await this.resoudreEtablissement(ctx);
    const patient = await this.exigerPatient(matricule);

    const maintenant = new Date();
    const patientMaj = await this.prisma.patientNational.update({
      where: { id: patient.id },
      data: {
        ...(dto.partageDurable !== undefined
          ? {
              partageDurable: dto.partageDurable,
              partageDurableDepuis: dto.partageDurable ? maintenant : null,
            }
          : {}),
        ...(dto.oppositionSocleVital !== undefined
          ? {
              oppositionSocleVital: dto.oppositionSocleVital,
              oppositionSocleVitalLe: dto.oppositionSocleVital
                ? maintenant
                : null,
            }
          : {}),
      },
      select: {
        matricule: true,
        partageDurable: true,
        oppositionSocleVital: true,
      },
    });

    // Une préférence est un consentement comme un autre : elle se trace.
    await this.prisma.consentementPublication.create({
      data: {
        patientId: patient.id,
        etablissementId: etablissement?.id ?? null,
        accorde: dto.partageDurable ?? !dto.oppositionSocleVital,
        portee: "DURABLE",
        support: dto.support ?? "ORAL_TRACE_DPI",
        etages:
          dto.oppositionSocleVital !== undefined
            ? ["SOCLE_VITAL"]
            : ["EPISODE_SOIN"],
        recueilliPar: dto.recueilliPar,
        recueilliLe: maintenant,
        preuve: dto.preuve ?? null,
      },
    });

    await this.journaliser({
      action: "MAJ_PREFERENCES_PARTAGE",
      etablissementId: etablissement?.id,
      patientId: patient.id,
      matricule,
      ressource: `patients/${matricule}/preferences`,
      succes: true,
      ctx,
    });

    return { ok: true, ...patientMaj };
  }

  // ─── Aides internes ────────────────────────────────────────────────────────

  private async exigerEtablissement(ctx: ContexteAppel) {
    const etablissement = await this.resoudreEtablissement(ctx);
    if (!etablissement) {
      throw new BadRequestException(
        "En-tête x-etablissement manquant ou établissement inconnu : toute écriture doit avoir une source identifiée",
      );
    }
    return etablissement;
  }

  private async exigerPatient(matricule: string) {
    const patient = await this.prisma.patientNational.findUnique({
      where: { matricule },
      select: { id: true },
    });
    if (!patient) {
      throw new NotFoundException(
        `Aucun patient au matricule ${matricule} dans le dépôt national`,
      );
    }
    return patient;
  }

  private versPrescriptions(dto: PublierConsultationDTO) {
    return (dto.prescriptions ?? []).map((p) => ({
      medicament: p.medicament,
      dci: p.dci ?? null,
      dosage: p.dosage ?? null,
      posologie: p.posologie ?? null,
      voie: p.voie ?? null,
      dureeJours: p.dureeJours ?? null,
      instructions: p.instructions ?? null,
    }));
  }

  private versResultats(dto: PublierConsultationDTO) {
    return (dto.resultats ?? []).map((r) => ({
      libelle: r.libelle,
      categorie: r.categorie ?? null,
      valeur: r.valeur ?? null,
      unite: r.unite ?? null,
      valeurNormale: r.valeurNormale ?? null,
      interpretation: r.interpretation ?? null,
      anormal: r.anormal ?? null,
      dateResultat: r.dateResultat ? new Date(r.dateResultat) : null,
    }));
  }

  private versDonneesPatient(
    dto: PublierIdentiteDTO,
    etablissementOrigineId?: string,
  ) {
    return {
      matricule: dto.matricule,
      nom: dto.nom,
      prenom: dto.prenom ?? null,
      genre: dto.genre,
      dateNaissance: new Date(dto.dateNaissance),
      contact: dto.contact ?? null,
      email: dto.email ?? null,
      adresse: dto.adresse ?? null,
      villeCommune: dto.villeCommune ?? null,
      nationalite: dto.nationalite ?? null,
      profession: dto.profession ?? null,
      situationMatrimoniale: dto.situationMatrimoniale ?? null,
      groupeSanguin: dto.groupeSanguin ?? null,
      assuranceNom: dto.assuranceNom ?? null,
      assuranceNumero: dto.assuranceNumero ?? null,
      etablissementOrigineId: etablissementOrigineId ?? null,
      versionSource: new Date(),
    };
  }

  /**
   * Le patient doit exister au national avant d'y rattacher une consultation.
   * Si le DPI a joint une identité, on la crée à la volée — sinon on refuse,
   * car une consultation orpheline serait inexploitable.
   */
  private async trouverOuCreerPatient(
    dto: PublierConsultationDTO,
    etablissementId: string,
  ) {
    const existant = await this.prisma.patientNational.findUnique({
      where: { matricule: dto.matricule },
      select: { id: true },
    });
    if (existant) return existant;

    if (!dto.patient) {
      throw new BadRequestException(
        `Patient ${dto.matricule} inconnu du dépôt national : joignez son identité dans le champ « patient » pour publier la consultation`,
      );
    }

    return this.prisma.patientNational.create({
      data: this.versDonneesPatient(dto.patient, etablissementId),
      select: { id: true },
    });
  }

  private matricule(brut: string): string {
    try {
      return normaliserMatricule(brut);
    } catch (err) {
      throw new BadRequestException(
        err instanceof PayloadInvalideError
          ? err.message
          : "Matricule invalide",
      );
    }
  }

  private valider<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof PayloadInvalideError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /** Résout l'établissement appelant depuis l'en-tête `x-etablissement`. */
  private async resoudreEtablissement(ctx: ContexteAppel) {
    if (!ctx.codeEtablissement) return null;
    return this.prisma.etablissementNational.findUnique({
      where: { code: ctx.codeEtablissement },
    });
  }

  /** Écrit une ligne d'audit. Ne doit jamais faire échouer l'appel métier. */
  private async journaliser(entree: {
    action: ActionNationale;
    etablissementId?: string;
    patientId?: string;
    matricule?: string;
    ressource?: string;
    succes: boolean;
    motifEchec?: string;
    ctx: ContexteAppel;
  }) {
    try {
      await this.prisma.journalAccesNational.create({
        data: {
          action: entree.action,
          etablissementId: entree.etablissementId ?? null,
          patientId: entree.patientId ?? null,
          matricule: entree.matricule ?? null,
          ressource: entree.ressource ?? null,
          succes: entree.succes,
          motifEchec: entree.motifEchec ?? null,
          adresseIp: entree.ctx.adresseIp ?? null,
          userAgent: entree.ctx.userAgent ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Journalisation impossible (${entree.action}) : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
