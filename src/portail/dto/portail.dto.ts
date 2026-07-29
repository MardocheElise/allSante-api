// ─────────────────────────────────────────────────────────────────────────────
// Contrats du portail développeur — validation manuelle, dans le même esprit
// que le reste de l'API : aucune dépendance de décorateurs, et une saisie
// fautive est rejetée avant toute écriture.
// ─────────────────────────────────────────────────────────────────────────────

export class PayloadInvalideError extends Error {}

export interface InscriptionDTO {
  email: string;
  motDePasse: string;
  nom: string;
  prenom?: string | null;
  telephone?: string | null;
  fonction?: string | null;
  /** Nom complet de l'établissement — c'est lui qui donne le code. */
  nomEtablissement: string;
  typeEtablissement?: string | null;
  ville?: string | null;
}

export interface ConnexionDTO {
  email: string;
  motDePasse: string;
}

export interface CreerCleDTO {
  libelle: string;
}

/**
 * Systèmes de l'établissement — cibles vers lesquelles All_Santé renvoie les
 * Bundles FHIR de cet établissement.
 */
export interface SystemesDTO {
  dpiUrl?: string | null;
  openelisUrl?: string | null;
  /** Clé qu'All_Santé présentera à ces systèmes. */
  cleSortante?: string | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Longueur minimale du mot de passe.
 *
 * On impose la longueur plutôt qu'un assortiment de caractères spéciaux : une
 * phrase de passe longue résiste mieux qu'un « P@ss1! » que l'utilisateur
 * finira par écrire sur un papier.
 */
const LONGUEUR_MOT_DE_PASSE = 12;

const TYPES_ADMIS = [
  'CHU',
  'CHR',
  'HOPITAL_GENERAL',
  'CENTRE_SANTE',
  'CLINIQUE',
  'LABORATOIRE',
];

function exigerTexte(valeur: unknown, champ: string, min = 1): string {
  if (typeof valeur !== 'string' || valeur.trim().length < min) {
    throw new PayloadInvalideError(
      min > 1
        ? `Champ « ${champ} » : ${min} caractères minimum`
        : `Champ « ${champ} » manquant`,
    );
  }
  return valeur.trim();
}

function texteOuNull(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const t = valeur.trim();
  return t === '' ? null : t;
}

export function validerInscription(brut: unknown): InscriptionDTO {
  if (!brut || typeof brut !== 'object') {
    throw new PayloadInvalideError("Payload d'inscription absent");
  }
  const i = brut as Record<string, unknown>;

  const email = exigerTexte(i.email, 'email').toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    throw new PayloadInvalideError('Adresse e-mail invalide');
  }

  const motDePasse = exigerTexte(
    i.motDePasse,
    'motDePasse',
    LONGUEUR_MOT_DE_PASSE,
  );

  const type = texteOuNull(i.typeEtablissement);
  if (type && !TYPES_ADMIS.includes(type)) {
    throw new PayloadInvalideError(
      `Type d'établissement inconnu (attendu : ${TYPES_ADMIS.join(', ')})`,
    );
  }

  return {
    email,
    motDePasse,
    nom: exigerTexte(i.nom, 'nom'),
    prenom: texteOuNull(i.prenom),
    telephone: texteOuNull(i.telephone),
    fonction: texteOuNull(i.fonction),
    nomEtablissement: exigerTexte(i.nomEtablissement, 'nomEtablissement', 3),
    typeEtablissement: type,
    ville: texteOuNull(i.ville),
  };
}

export function validerConnexion(brut: unknown): ConnexionDTO {
  if (!brut || typeof brut !== 'object') {
    throw new PayloadInvalideError('Payload de connexion absent');
  }
  const c = brut as Record<string, unknown>;
  return {
    email: exigerTexte(c.email, 'email').toLowerCase(),
    motDePasse: exigerTexte(c.motDePasse, 'motDePasse'),
  };
}

export function validerCreerCle(brut: unknown): CreerCleDTO {
  const c = (brut ?? {}) as Record<string, unknown>;
  return {
    libelle: texteOuNull(c.libelle) ?? 'Clé sans libellé',
  };
}

/** Valide une URL de système aval. */
function urlOuNull(valeur: unknown, champ: string): string | null {
  const t = texteOuNull(valeur);
  if (t === null) return null;
  let analysee: URL;
  try {
    analysee = new URL(t);
  } catch {
    throw new PayloadInvalideError(
      `Champ « ${champ} » : URL invalide (attendu http://… ou https://…)`,
    );
  }
  if (!['http:', 'https:'].includes(analysee.protocol)) {
    throw new PayloadInvalideError(
      `Champ « ${champ} » : seuls http et https sont acceptés`,
    );
  }
  // On retire la barre oblique finale : le bus concatène des chemins qui
  // commencent déjà par « / », et « //interop » ne serait pas résolu.
  return t.replace(/\/+$/, '');
}

export function validerSystemes(brut: unknown): SystemesDTO {
  if (!brut || typeof brut !== 'object') {
    throw new PayloadInvalideError('Payload des systèmes absent');
  }
  const s = brut as Record<string, unknown>;
  const cle = texteOuNull(s.cleSortante);
  if (cle !== null && cle.length < 16) {
    throw new PayloadInvalideError(
      'Clé sortante trop courte : 16 caractères minimum',
    );
  }
  return {
    dpiUrl: urlOuNull(s.dpiUrl, 'dpiUrl'),
    openelisUrl: urlOuNull(s.openelisUrl, 'openelisUrl'),
    cleSortante: cle,
  };
}
