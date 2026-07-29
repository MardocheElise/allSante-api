// ─────────────────────────────────────────────────────────────────────────────
// Contrats d'échange du dépôt national All_Santé.
//
// Volontairement en TypeScript pur + validation manuelle, dans le même esprit
// que le contrat FHIR de `src/fhir/` : aucune dépendance de décorateurs, et une
// erreur de saisie est rejetée AVANT toute écriture en base.
// ─────────────────────────────────────────────────────────────────────────────

export type GenreDTO = 'masculin' | 'feminin';

export type StatutConsultationDTO =
  | 'TERMINEE'
  | 'CLOTUREE_ADMINISTRATIVEMENT'
  | 'ANNULEE';

/** Payload de publication d'identité (SGCH → AllSanté). */
export interface PublierIdentiteDTO {
  matricule: string;
  nom: string;
  prenom?: string | null;
  genre: GenreDTO;
  /** ISO 8601 ou yyyy-mm-dd. */
  dateNaissance: string;
  contact?: string | null;
  email?: string | null;
  adresse?: string | null;
  villeCommune?: string | null;
  nationalite?: string | null;
  profession?: string | null;
  situationMatrimoniale?: string | null;
  groupeSanguin?: string | null;
  assuranceNom?: string | null;
  assuranceNumero?: string | null;
}

export interface PrescriptionDTO {
  medicament: string;
  dci?: string | null;
  dosage?: string | null;
  posologie?: string | null;
  voie?: string | null;
  dureeJours?: number | null;
  instructions?: string | null;
}

export interface ResultatExamenDTO {
  libelle: string;
  categorie?: string | null;
  valeur?: string | null;
  unite?: string | null;
  valeurNormale?: string | null;
  interpretation?: string | null;
  anormal?: boolean | null;
  dateResultat?: string | null;
}

export type EtagePartageDTO =
  | 'SOCLE_VITAL'
  | 'EPISODE_SOIN'
  | 'CHARGE_SOCIALE';

export type PorteeConsentementDTO = 'CONSULTATION_UNIQUE' | 'DURABLE';

export type SupportConsentementDTO =
  | 'ORAL_TRACE_DPI'
  | 'FORMULAIRE_PAPIER'
  | 'SMS'
  | 'PORTAIL';

/**
 * Consentement du patient à la publication d'un épisode de soin.
 *
 * Recueilli par le praticien pendant la consultation, sur l'objet que le
 * patient comprend : SA consultation d'aujourd'hui. La traçabilité n'est pas
 * décorative — sans elle, une case cochée dans un DPI ne prouve rien.
 */
export interface ConsentementDTO {
  accorde: boolean;
  /** Professionnel qui a recueilli l'accord. Obligatoire même en cas de refus. */
  recueilliPar: string;
  recueilliLe?: string;
  portee?: PorteeConsentementDTO;
  support?: SupportConsentementDTO;
  /** Étages couverts. Par défaut, l'épisode de soin seul. */
  etages?: EtagePartageDTO[];
  /** Référence de la preuve : formulaire numérisé, identifiant du SMS... */
  preuve?: string | null;
}

/** Payload de publication de consultation (DPI → AllSanté). */
export interface PublierConsultationDTO {
  /** Matricule CMU du patient concerné (doit exister ou être fourni ci-dessous). */
  matricule: string;
  /** Identité minimale, si le patient n'est pas encore connu du national. */
  patient?: PublierIdentiteDTO;
  /** Identifiant de la consultation dans le DPI émetteur (idempotence). */
  referenceLocale: string;

  /**
   * Accord du patient. Sans consentement accordé, AUCUN champ clinique n'est
   * conservé : seul un marqueur d'existence est écrit.
   */
  consentement: ConsentementDTO;

  /** Étage de sensibilité de l'épisode. Par défaut EPISODE_SOIN. */
  etage?: EtagePartageDTO;

  // ── Contenu clinique — ignoré si le consentement n'est pas accordé ────────
  dateConsultation?: string;
  motif?: string;
  professionnel?: string;
  specialite?: string | null;
  typeVisite?: string | null;
  statut?: StatutConsultationDTO;
  diagnosticRetenu?: string | null;
  codeCim10?: string | null;
  syntheseClinique?: string | null;
  conduiteATenir?: string | null;
  prescriptions?: PrescriptionDTO[];
  resultats?: ResultatExamenDTO[];
}

/** Payload de déclaration d'une allergie (socle vital). */
export interface PublierAllergieDTO {
  referenceLocale: string;
  libelle: string;
  type?: string | null;
  severite?: string | null;
  reaction?: string | null;
  active?: boolean;
}

/** Payload de déclaration d'un traitement au long cours (socle vital). */
export interface PublierTraitementChroniqueDTO {
  referenceLocale: string;
  medicament: string;
  dci?: string | null;
  dosage?: string | null;
  posologie?: string | null;
  indication?: string | null;
  debutLe?: string | null;
  finLe?: string | null;
  actif?: boolean;
}

/** Payload de mise à jour des préférences de partage du patient. */
export interface PreferencesPartageDTO {
  partageDurable?: boolean;
  oppositionSocleVital?: boolean;
  recueilliPar: string;
  support?: SupportConsentementDTO;
  preuve?: string | null;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export class PayloadInvalideError extends Error {}

const MATRICULE_REGEX = /^\d{13}$/;

/** Normalise et valide un matricule CMU (13 chiffres, sans séparateurs). */
export function normaliserMatricule(valeur: unknown): string {
  const brut = typeof valeur === 'string' ? valeur.replace(/\D/g, '') : '';
  if (!MATRICULE_REGEX.test(brut)) {
    throw new PayloadInvalideError(
      'Matricule CMU invalide : 13 chiffres exactement sont attendus',
    );
  }
  return brut;
}

function exigerTexte(valeur: unknown, champ: string): string {
  if (typeof valeur !== 'string' || valeur.trim() === '') {
    throw new PayloadInvalideError(`Champ « ${champ} » manquant ou vide`);
  }
  return valeur.trim();
}

/** Convertit une date ISO / yyyy-mm-dd en Date, ou lève une erreur explicite. */
export function exigerDate(valeur: unknown, champ: string): Date {
  const texte = exigerTexte(valeur, champ);
  const date = new Date(texte);
  if (Number.isNaN(date.getTime())) {
    throw new PayloadInvalideError(`Champ « ${champ} » : date invalide`);
  }
  return date;
}

export function texteOuNull(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const t = valeur.trim();
  return t === '' ? null : t;
}

/** Valide un payload d'identité et le renvoie normalisé. */
export function validerIdentite(brut: unknown): PublierIdentiteDTO {
  if (!brut || typeof brut !== 'object') {
    throw new PayloadInvalideError('Payload d’identité absent');
  }
  const p = brut as Record<string, unknown>;
  const genre = p.genre;
  if (genre !== 'masculin' && genre !== 'feminin') {
    throw new PayloadInvalideError(
      'Champ « genre » invalide : « masculin » ou « feminin » attendu',
    );
  }
  return {
    matricule: normaliserMatricule(p.matricule),
    nom: exigerTexte(p.nom, 'nom'),
    prenom: texteOuNull(p.prenom),
    genre,
    dateNaissance: exigerDate(p.dateNaissance, 'dateNaissance').toISOString(),
    contact: texteOuNull(p.contact),
    email: texteOuNull(p.email),
    adresse: texteOuNull(p.adresse),
    villeCommune: texteOuNull(p.villeCommune),
    nationalite: texteOuNull(p.nationalite),
    profession: texteOuNull(p.profession),
    situationMatrimoniale: texteOuNull(p.situationMatrimoniale),
    groupeSanguin: texteOuNull(p.groupeSanguin),
    assuranceNom: texteOuNull(p.assuranceNom),
    assuranceNumero: texteOuNull(p.assuranceNumero),
  };
}

/** Valide un payload de consultation et le renvoie normalisé. */
export function validerConsultation(brut: unknown): PublierConsultationDTO {
  if (!brut || typeof brut !== 'object') {
    throw new PayloadInvalideError('Payload de consultation absent');
  }
  const c = brut as Record<string, unknown>;

  const statutsAdmis: StatutConsultationDTO[] = [
    'TERMINEE',
    'CLOTUREE_ADMINISTRATIVEMENT',
    'ANNULEE',
  ];
  const statut = (c.statut as StatutConsultationDTO) ?? 'TERMINEE';
  if (!statutsAdmis.includes(statut)) {
    throw new PayloadInvalideError(
      `Statut « ${String(c.statut)} » non admis au national (attendu : ${statutsAdmis.join(', ')})`,
    );
  }

  const prescriptions = Array.isArray(c.prescriptions)
    ? c.prescriptions.map((brute, i) => {
        const p = (brute ?? {}) as Record<string, unknown>;
        return {
          medicament: exigerTexte(p.medicament, `prescriptions[${i}].medicament`),
          dci: texteOuNull(p.dci),
          dosage: texteOuNull(p.dosage),
          posologie: texteOuNull(p.posologie),
          voie: texteOuNull(p.voie),
          dureeJours:
            typeof p.dureeJours === 'number' ? Math.trunc(p.dureeJours) : null,
          instructions: texteOuNull(p.instructions),
        } satisfies PrescriptionDTO;
      })
    : [];

  const resultats = Array.isArray(c.resultats)
    ? c.resultats.map((brute, i) => {
        const r = (brute ?? {}) as Record<string, unknown>;
        return {
          libelle: exigerTexte(r.libelle, `resultats[${i}].libelle`),
          categorie: texteOuNull(r.categorie),
          valeur: texteOuNull(r.valeur),
          unite: texteOuNull(r.unite),
          valeurNormale: texteOuNull(r.valeurNormale),
          interpretation: texteOuNull(r.interpretation),
          anormal: typeof r.anormal === 'boolean' ? r.anormal : null,
          dateResultat:
            r.dateResultat != null
              ? exigerDate(r.dateResultat, `resultats[${i}].dateResultat`).toISOString()
              : null,
        } satisfies ResultatExamenDTO;
      })
    : [];

  const consentement = validerConsentement(c.consentement);
  const etage = validerEtage(c.etage ?? 'EPISODE_SOIN');

  // Consentement RENFORCÉ pour l'étage à forte charge sociale : un accord
  // générique « je partage ma consultation » ne suffit pas à publier un
  // diagnostic VIH ou psychiatrique. Le patient doit l'avoir visé nommément.
  if (etage === 'CHARGE_SOCIALE' && consentement.accorde) {
    if (!consentement.etages?.includes('CHARGE_SOCIALE')) {
      throw new PayloadInvalideError(
        'Étage CHARGE_SOCIALE : le consentement doit viser explicitement cet étage (consentement.etages)',
      );
    }
  }

  // Refus du patient : le contenu clinique ne doit MÊME PAS transiter.
  // On rejette au lieu d'ignorer silencieusement — l'objectif est que la
  // donnée ne quitte jamais l'hôpital, pas qu'elle arrive puis soit écartée.
  if (!consentement.accorde) {
    const champsCliniques = [
      'dateConsultation',
      'motif',
      'professionnel',
      'specialite',
      'typeVisite',
      'diagnosticRetenu',
      'codeCim10',
      'syntheseClinique',
      'conduiteATenir',
    ];
    const presents = champsCliniques.filter(
      (champ) => c[champ] !== undefined && c[champ] !== null && c[champ] !== '',
    );
    if (Array.isArray(c.prescriptions) && c.prescriptions.length > 0) {
      presents.push('prescriptions');
    }
    if (Array.isArray(c.resultats) && c.resultats.length > 0) {
      presents.push('resultats');
    }
    if (presents.length > 0) {
      throw new PayloadInvalideError(
        `Le patient n’a pas consenti au partage : aucun contenu clinique ne doit être transmis (reçu : ${presents.join(', ')})`,
      );
    }

    return {
      matricule: normaliserMatricule(c.matricule),
      patient: c.patient ? validerIdentite(c.patient) : undefined,
      referenceLocale: exigerTexte(c.referenceLocale, 'referenceLocale'),
      consentement,
      etage,
      prescriptions: [],
      resultats: [],
    };
  }

  return {
    matricule: normaliserMatricule(c.matricule),
    patient: c.patient ? validerIdentite(c.patient) : undefined,
    referenceLocale: exigerTexte(c.referenceLocale, 'referenceLocale'),
    consentement,
    etage,
    dateConsultation: exigerDate(
      c.dateConsultation,
      'dateConsultation',
    ).toISOString(),
    motif: exigerTexte(c.motif, 'motif'),
    professionnel: exigerTexte(c.professionnel, 'professionnel'),
    specialite: texteOuNull(c.specialite),
    typeVisite: texteOuNull(c.typeVisite),
    statut,
    diagnosticRetenu: texteOuNull(c.diagnosticRetenu),
    codeCim10: texteOuNull(c.codeCim10),
    syntheseClinique: texteOuNull(c.syntheseClinique),
    conduiteATenir: texteOuNull(c.conduiteATenir),
    prescriptions,
    resultats,
  };
}

// ─── Consentement ────────────────────────────────────────────────────────────

const ETAGES: EtagePartageDTO[] = [
  'SOCLE_VITAL',
  'EPISODE_SOIN',
  'CHARGE_SOCIALE',
];

export function validerEtage(valeur: unknown): EtagePartageDTO {
  if (!ETAGES.includes(valeur as EtagePartageDTO)) {
    throw new PayloadInvalideError(
      `Étage « ${String(valeur)} » inconnu (attendu : ${ETAGES.join(', ')})`,
    );
  }
  return valeur as EtagePartageDTO;
}

/**
 * Valide le bloc de consentement.
 *
 * Le champ `recueilliPar` est exigé MÊME EN CAS DE REFUS : un refus non
 * attribué ne se distingue pas d'un oubli du logiciel émetteur, et c'est
 * précisément ce qu'il faut pouvoir prouver.
 */
export function validerConsentement(brut: unknown): ConsentementDTO {
  if (!brut || typeof brut !== 'object') {
    throw new PayloadInvalideError(
      'Bloc « consentement » absent : aucune publication clinique n’est possible sans accord tracé du patient',
    );
  }
  const c = brut as Record<string, unknown>;

  if (typeof c.accorde !== 'boolean') {
    throw new PayloadInvalideError(
      'Champ « consentement.accorde » manquant : true ou false attendu',
    );
  }

  const portees: PorteeConsentementDTO[] = ['CONSULTATION_UNIQUE', 'DURABLE'];
  const portee = (c.portee as PorteeConsentementDTO) ?? 'CONSULTATION_UNIQUE';
  if (!portees.includes(portee)) {
    throw new PayloadInvalideError(
      `Portée « ${String(c.portee)} » inconnue (attendu : ${portees.join(', ')})`,
    );
  }

  const supports: SupportConsentementDTO[] = [
    'ORAL_TRACE_DPI',
    'FORMULAIRE_PAPIER',
    'SMS',
    'PORTAIL',
  ];
  const support = (c.support as SupportConsentementDTO) ?? 'ORAL_TRACE_DPI';
  if (!supports.includes(support)) {
    throw new PayloadInvalideError(
      `Support « ${String(c.support)} » inconnu (attendu : ${supports.join(', ')})`,
    );
  }

  const etages = Array.isArray(c.etages)
    ? c.etages.map((e) => validerEtage(e))
    : (['EPISODE_SOIN'] as EtagePartageDTO[]);

  return {
    accorde: c.accorde,
    recueilliPar: exigerTexte(c.recueilliPar, 'consentement.recueilliPar'),
    recueilliLe: c.recueilliLe
      ? exigerDate(c.recueilliLe, 'consentement.recueilliLe').toISOString()
      : new Date().toISOString(),
    portee,
    support,
    etages,
    preuve: texteOuNull(c.preuve),
  };
}

// ─── Socle vital ─────────────────────────────────────────────────────────────

export function validerAllergie(brut: unknown): PublierAllergieDTO {
  if (!brut || typeof brut !== 'object') {
    throw new PayloadInvalideError('Payload d’allergie absent');
  }
  const a = brut as Record<string, unknown>;
  return {
    referenceLocale: exigerTexte(a.referenceLocale, 'referenceLocale'),
    libelle: exigerTexte(a.libelle, 'libelle'),
    type: texteOuNull(a.type),
    severite: texteOuNull(a.severite),
    reaction: texteOuNull(a.reaction),
    active: typeof a.active === 'boolean' ? a.active : true,
  };
}

export function validerTraitementChronique(
  brut: unknown,
): PublierTraitementChroniqueDTO {
  if (!brut || typeof brut !== 'object') {
    throw new PayloadInvalideError('Payload de traitement chronique absent');
  }
  const t = brut as Record<string, unknown>;
  return {
    referenceLocale: exigerTexte(t.referenceLocale, 'referenceLocale'),
    medicament: exigerTexte(t.medicament, 'medicament'),
    dci: texteOuNull(t.dci),
    dosage: texteOuNull(t.dosage),
    posologie: texteOuNull(t.posologie),
    indication: texteOuNull(t.indication),
    debutLe: t.debutLe
      ? exigerDate(t.debutLe, 'debutLe').toISOString()
      : null,
    finLe: t.finLe ? exigerDate(t.finLe, 'finLe').toISOString() : null,
    actif: typeof t.actif === 'boolean' ? t.actif : true,
  };
}

export function validerPreferences(brut: unknown): PreferencesPartageDTO {
  if (!brut || typeof brut !== 'object') {
    throw new PayloadInvalideError('Payload de préférences absent');
  }
  const p = brut as Record<string, unknown>;
  if (
    typeof p.partageDurable !== 'boolean' &&
    typeof p.oppositionSocleVital !== 'boolean'
  ) {
    throw new PayloadInvalideError(
      'Aucune préférence fournie : « partageDurable » ou « oppositionSocleVital » attendu',
    );
  }
  const supports: SupportConsentementDTO[] = [
    'ORAL_TRACE_DPI',
    'FORMULAIRE_PAPIER',
    'SMS',
    'PORTAIL',
  ];
  const support = (p.support as SupportConsentementDTO) ?? 'ORAL_TRACE_DPI';
  if (!supports.includes(support)) {
    throw new PayloadInvalideError(`Support « ${String(p.support)} » inconnu`);
  }
  return {
    partageDurable:
      typeof p.partageDurable === 'boolean' ? p.partageDurable : undefined,
    oppositionSocleVital:
      typeof p.oppositionSocleVital === 'boolean'
        ? p.oppositionSocleVital
        : undefined,
    recueilliPar: exigerTexte(p.recueilliPar, 'recueilliPar'),
    support,
    preuve: texteOuNull(p.preuve),
  };
}
